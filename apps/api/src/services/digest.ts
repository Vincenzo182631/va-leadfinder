import { opportunitySearchSchema } from '@vlf/shared';
import { withUser, type Sql } from '../db';
import { randomToken, sha256Hex } from '../lib/crypto';
import type { Deps } from '../types';
import { searchOpportunities } from './opportunities';

const RANK = { off: 0, weekly: 1, daily: 2 } as const;
type Freq = keyof typeof RANK;

/** Effective frequency = the less frequent of the user's choice and the plan's allowance. */
export const effectiveFrequency = (user: Freq, plan: Freq): Freq => (RANK[user] <= RANK[plan] ? user : plan);

export function isDue(freq: Freq, lastSent: Date | null, now: Date): boolean {
  if (freq === 'off') return false;
  if (!lastSent) return true;
  const hours = (now.getTime() - lastSent.getTime()) / 3_600_000;
  return freq === 'daily' ? hours >= 23 : hours >= 24 * 7 - 1;
}

/**
 * Sends digests to opted-in users. Only genuinely new, eligible opportunities from sources whose
 * licence allows digests; demo data only outside production and always labelled.
 */
export async function runDigests(deps: Deps, opts: { limitUsers?: number } = {}) {
  const { sql, config, email } = deps;
  const now = deps.now();
  if (!email.configured) return { sent: 0, skipped: 0, reason: 'email_not_configured' };
  const users = await sql`select u.id, u.email, ep.digest_frequency, ep.last_digest_sent_at, pl.digest_frequency as plan_freq
    from auth.users u join email_preferences ep on ep.user_id = u.id
    join plans pl on pl.code = current_plan_code(u.id)
    where ep.digest_frequency <> 'off' and u.email is not null limit ${opts.limitUsers ?? 1000}`;
  let sent = 0;
  let skipped = 0;
  for (const u of users) {
    const freq = effectiveFrequency(u.digest_frequency, u.plan_freq);
    const last = u.last_digest_sent_at ? new Date(u.last_digest_sent_at) : null;
    if (!isDue(freq, last, now)) { skipped++; continue; }
    const since = last ?? new Date(now.getTime() - 7 * 86_400_000);
    const items = await withUser(sql, { sub: u.id, email: u.email, role: 'authenticated' }, async (tx) => {
      const r = await searchOpportunities(tx, u.id, opportunitySearchSchema.parse({ pageSize: 50 }), now);
      return r.items.filter((i) => new Date(i.publishedAt) > since && !i.viewed);
    });
    const digestOk = await digestAllowedProviders(sql);
    const eligible = items.filter((i) => (i.isDemo ? !config.isProduction : digestOk.has(i.source.providerName))).slice(0, 10);
    if (eligible.length === 0) { skipped++; continue; }
    const token = randomToken(24);
    await sql`update email_preferences set unsubscribe_token_hash = ${await sha256Hex(token)} where user_id = ${u.id}`;
    const demo = eligible.some((i) => i.isDemo);
    const lines = eligible.map((i) => `• ${i.title} — ${i.companyName}\n  ${i.bandLabel} (${i.score}/100) · Source: ${i.source.providerName}${i.isDemo ? ' · DEMO' : ''}\n  ${config.APP_BASE_URL}/app/opportunities/${i.id}`);
    const res = await email.send({
      to: u.email,
      tag: 'digest',
      subject: `${demo ? '[DEMO] ' : ''}${eligible.length} new opportunit${eligible.length === 1 ? 'y' : 'ies'} matching your VA skills`,
      text: [
        demo ? 'DEMO DATA — NOT REAL LEADS. These examples are fictional.\n' : '',
        'New opportunities since your last digest:', '', ...lines, '',
        'Scores are estimates. Always verify eligibility and requirements on the original source before reaching out. No opportunity is a guaranteed client.',
        '', `Manage email preferences: ${config.APP_BASE_URL}/app/account`,
        `Unsubscribe from digests: ${config.APP_BASE_URL}/api/email/unsubscribe?token=${token}`,
      ].join('\n'),
    });
    if (res.ok) {
      await sql`update email_preferences set last_digest_sent_at = ${now.toISOString()} where user_id = ${u.id}`;
      sent++;
    }
  }
  return { sent, skipped };
}

async function digestAllowedProviders(sql: Sql) {
  const rows = await sql`select name from source_providers where enabled and digest_allowed and license_status = 'approved'`;
  return new Set(rows.map((r) => r.name as string));
}
