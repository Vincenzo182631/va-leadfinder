import { Hono } from 'hono';
import {
  feedbackSchema,
  generateOutreachDraft,
  nextResetDate,
  onboardingSchema,
  opportunitySearchSchema,
  outreachDraftRequestSchema,
  preferencesSchema,
  productEventSchema,
  profileUpdateSchema,
  saveProspectSchema,
  toCsv,
  updateProspectSchema,
  type DashboardResponse,
  type MeResponse,
  type OpportunityDetail,
  type SavedProspect,
  type UsageResponse,
} from '@vlf/shared';
import type { Tx } from '../db';
import { ApiError, notFound } from '../lib/errors';
import { isAdmin, jsonBody, requireAuth, userTx, uuidParam } from '../middleware/core';
import { rateLimit } from '../middleware/rate-limit';
import { getOpportunityItem, lastRefreshAt, loadPreferences, searchOpportunities } from '../services/opportunities';
import type { AppEnv } from '../types';

export const userRoutes = new Hono<AppEnv>();
userRoutes.use('*', requireAuth);

async function track(tx: Tx, userId: string, event: string, relatedId?: string) {
  await tx`insert into product_events (user_id, event, related_id) values (${userId}, ${event}, ${relatedId ?? null})`;
}

async function usage(tx: Tx, now: Date): Promise<UsageResponse> {
  const [r] = await tx`select my_usage() as u`;
  return { ...(r!.u as Omit<UsageResponse, 'resetsAt'>), resetsAt: nextResetDate(now).toISOString() };
}

const mapSaved = (r: Record<string, any>): SavedProspect => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  stage: r.stage,
  notes: r.notes,
  followUpAt: r.follow_up_at,
  savedAt: r.saved_at,
  updatedAt: r.updated_at,
  companyName: r.company_name,
  title: r.title,
  isDemo: r.is_demo,
});

// ------------------------------------------------------------------ me / profile
userRoutes.get('/me', async (c) => {
  const deps = c.get('deps');
  const claims = c.get('claims')!;
  const body = await userTx(c, async (tx, uid) => {
    const [profile] = await tx`select * from profiles where user_id = ${uid}`;
    if (profile) {
      // previous_seen_at powers "new since last visit"; only roll it forward after 30 minutes away.
      await tx`update profiles set
        previous_seen_at = case when last_seen_at is null or last_seen_at < now() - interval '30 minutes' then coalesce(last_seen_at, now()) else previous_seen_at end,
        last_seen_at = now() where user_id = ${uid}`;
    }
    const prefs = await loadPreferences(tx, uid);
    const [s] = await tx`select demo_mode_enabled from app_settings where id = 1`;
    const [live] = await tx`select count(*)::int as n from source_providers where enabled and provider_kind <> 'synthetic_demo'`;
    const res: MeResponse = {
      user: { id: uid, email: claims.email ?? null },
      profile: profile
        ? { displayName: profile.display_name, country: profile.country, timezone: profile.timezone, onboardingCompleted: profile.onboarding_completed }
        : null,
      preferences: prefs,
      isAdmin: isAdmin(c),
      appMode: { demoMode: Boolean(s?.demo_mode_enabled), liveSourcesActive: live?.n ?? 0, environment: deps.config.APP_ENV, authMode: deps.config.AUTH_MODE },
    };
    return res;
  });
  return c.json(body);
});

userRoutes.patch('/profile', async (c) => {
  const p = await jsonBody(c, profileUpdateSchema);
  await userTx(c, (tx, uid) => tx`insert into profiles (user_id, display_name, country, timezone) values (${uid}, ${p.displayName}, ${p.country}, ${p.timezone})
    on conflict (user_id) do update set display_name = excluded.display_name, country = excluded.country, timezone = excluded.timezone`);
  return c.json({ ok: true });
});

async function upsertPrefs(tx: Tx, uid: string, p: ReturnType<typeof preferencesSchema.parse>) {
  await tx`insert into user_preferences (user_id, skills, other_skill, industries, excluded_industries, markets, us_timezones, work_types,
      require_remote, exclude_region_restricted, responsibilities, alert_frequency)
    values (${uid}, ${p.skills}, ${p.otherSkill}, ${p.industries}, ${p.excludedIndustries}, ${p.markets}, ${p.usTimezones}, ${p.workTypes},
      ${p.requireRemote}, ${p.excludeRegionRestricted}, ${p.responsibilities}, ${p.alertFrequency})
    on conflict (user_id) do update set skills = excluded.skills, other_skill = excluded.other_skill, industries = excluded.industries,
      excluded_industries = excluded.excluded_industries, markets = excluded.markets, us_timezones = excluded.us_timezones,
      work_types = excluded.work_types, require_remote = excluded.require_remote, exclude_region_restricted = excluded.exclude_region_restricted,
      responsibilities = excluded.responsibilities, alert_frequency = excluded.alert_frequency`;
  await tx`update email_preferences set digest_frequency = ${p.alertFrequency} where user_id = ${uid}`;
}

userRoutes.get('/preferences', async (c) => c.json({ preferences: await userTx(c, (tx, uid) => loadPreferences(tx, uid)) }));
userRoutes.patch('/preferences', async (c) => {
  const p = await jsonBody(c, preferencesSchema);
  await userTx(c, (tx, uid) => upsertPrefs(tx, uid, p));
  return c.json({ ok: true, preferences: p });
});

userRoutes.post('/onboarding', async (c) => {
  const { profile, preferences } = await jsonBody(c, onboardingSchema);
  await userTx(c, async (tx, uid) => {
    await tx`insert into profiles (user_id, display_name, country, timezone, onboarding_completed)
      values (${uid}, ${profile.displayName}, ${profile.country}, ${profile.timezone}, true)
      on conflict (user_id) do update set display_name = excluded.display_name, country = excluded.country,
        timezone = excluded.timezone, onboarding_completed = true`;
    await upsertPrefs(tx, uid, preferences);
    await track(tx, uid, 'onboarding_completed');
  });
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ dashboard
userRoutes.get('/dashboard', async (c) => {
  const now = c.get('deps').now();
  const body = await userTx(c, async (tx, uid) => {
    const [profile] = await tx`select display_name, previous_seen_at from profiles where user_id = ${uid}`;
    const all = await searchOpportunities(tx, uid, opportunitySearchSchema.parse({ minScore: 0, pageSize: 50 }), now);
    const since = profile?.previous_seen_at ? new Date(profile.previous_seen_at).getTime() : 0;
    const visible = all.items.filter((i) => i.score >= 50);
    const [counts] = await tx`select
        count(*)::int as saved,
        count(*) filter (where stage = 'contacted')::int as contacted,
        count(*) filter (where follow_up_at is not null and follow_up_at <= now() and stage not in ('not_a_fit','qualified'))::int as due
      from saved_prospects where user_id = ${uid}`;
    const res: DashboardResponse = {
      greetingName: profile?.display_name || 'there',
      newSinceLastVisit: visible.filter((i) => new Date(i.publishedAt).getTime() > since && !i.viewed).length,
      savedCount: counts?.saved ?? 0,
      unreviewedHighFit: visible.filter((i) => i.band === 'high' && !i.viewed && !i.saved).length,
      contactedCount: counts?.contacted ?? 0,
      followUpsDue: counts?.due ?? 0,
      lastRefreshAt: await lastRefreshAt(tx),
      topMatches: visible.slice(0, 5),
    };
    return res;
  });
  return c.json(body);
});

// ------------------------------------------------------------------ opportunities
userRoutes.get('/sources', async (c) =>
  c.json({ sources: await userTx(c, (tx) => tx`select id, name, provider_kind as kind, attribution_text as attribution from source_providers where enabled order by name`) }),
);

userRoutes.get('/opportunities', rateLimit('search', 120, 60_000), async (c) => {
  const url = new URL(c.req.url);
  const raw: Record<string, string | string[]> = {};
  for (const k of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(k);
    raw[k] = all.length > 1 ? all : all[0]!;
  }
  const f = opportunitySearchSchema.parse(raw);
  const now = c.get('deps').now();
  const body = await userTx(c, async (tx, uid) => {
    const r = await searchOpportunities(tx, uid, f, now);
    if (f.query || f.skill.length || f.industry.length) await track(tx, uid, 'search_performed');
    return { items: r.items, page: f.page, pageSize: f.pageSize, total: r.total, hiddenCount: r.hiddenCount, lastRefreshAt: await lastRefreshAt(tx) };
  });
  return c.json(body);
});

async function loadDetail(tx: Tx, uid: string, id: string, now: Date): Promise<OpportunityDetail | null> {
  const found = await getOpportunityItem(tx, uid, id, now);
  if (!found) return null;
  const [full] = await tx`select * from get_opportunity_full(${id})`;
  const [sp] = await tx`select * from saved_prospects where user_id = ${uid} and opportunity_id = ${id}`;
  const [draft] = await tx`select template_code, draft_body, updated_at from outreach_drafts where user_id = ${uid} and opportunity_id = ${id}`;
  return {
    ...found.item,
    full: full
      ? {
          companySite: full.company_site,
          originalSummary: full.original_summary,
          outsourcingEvidence: full.outsourcing_evidence,
          contactRoute: full.contact_route,
          sourceUrl: full.source_url,
          sourcePostedAt: full.source_posted_at,
          observedAt: full.observed_at,
        }
      : null,
    savedProspect: sp ? mapSaved(sp) : null,
    draft: draft ? { templateCode: draft.template_code, body: draft.draft_body, updatedAt: draft.updated_at } : null,
  };
}

userRoutes.get('/opportunities/:id', rateLimit('detail', 120, 60_000), async (c) => {
  const id = uuidParam(c);
  const now = c.get('deps').now();
  const body = await userTx(c, async (tx, uid) => {
    const d = await loadDetail(tx, uid, id, now);
    if (!d) return null;
    const v = await tx`insert into opportunity_views (user_id, opportunity_id) values (${uid}, ${id}) on conflict do nothing returning user_id`;
    if (v.length) await track(tx, uid, 'opportunity_opened', id);
    return d;
  });
  if (!body) throw notFound('Opportunity');
  return c.json(body);
});

userRoutes.post('/opportunities/:id/unlock', rateLimit('unlock', 30, 60_000), async (c) => {
  const id = uuidParam(c);
  const now = c.get('deps').now();
  const r = await userTx(c, async (tx) => {
    const [row] = await tx`select unlock_opportunity(${id}) as r`;
    return row!.r as Record<string, unknown>;
  });
  const status = r.status as string;
  if (status === 'not_found') throw notFound('Opportunity');
  const usageInfo = { ...r, resetsAt: nextResetDate(now).toISOString() };
  delete (usageInfo as Record<string, unknown>).status;
  if (status === 'plan_limit_reached')
    throw new ApiError(402, 'plan_limit_reached', `You have used all ${r.unlockLimit} unlocks for this month. Your allowance resets on ${nextResetDate(now).toDateString()}.`, usageInfo);
  if (status === 'live_data_requires_paid_plan')
    throw new ApiError(402, 'live_data_requires_paid_plan', 'Licensed live opportunities require a paid plan.', usageInfo);
  return c.json({ status, usage: usageInfo });
});

userRoutes.post('/opportunities/:id/dismiss', async (c) => {
  const id = uuidParam(c);
  await userTx(c, (tx, uid) => tx`insert into opportunity_dismissals (user_id, opportunity_id) values (${uid}, ${id}) on conflict do nothing`);
  return c.json({ ok: true });
});
userRoutes.delete('/opportunities/:id/dismiss', async (c) => {
  const id = uuidParam(c);
  await userTx(c, (tx, uid) => tx`delete from opportunity_dismissals where user_id = ${uid} and opportunity_id = ${id}`);
  return c.json({ ok: true });
});

userRoutes.post('/opportunities/:id/feedback', rateLimit('feedback', 10, 60_000), async (c) => {
  const id = uuidParam(c);
  const f = await jsonBody(c, feedbackSchema);
  await userTx(c, (tx, uid) => tx`insert into opportunity_feedback (user_id, opportunity_id, reason, details) values (${uid}, ${id}, ${f.reason}, ${f.details})`);
  return c.json({ ok: true }, 201);
});

// ------------------------------------------------------------------ saved pipeline
userRoutes.get('/saved', async (c) => {
  const q = (c.req.query('query') ?? '').slice(0, 100);
  const rows = await userTx(c, (tx, uid) => tx`
    select sp.*, o.company_name, o.title, o.is_demo from saved_prospects sp
    join opportunities o on o.id = sp.opportunity_id
    where sp.user_id = ${uid}
      ${q ? tx`and (o.company_name ilike ${'%' + q + '%'} or o.title ilike ${'%' + q + '%'} or sp.notes ilike ${'%' + q + '%'})` : tx``}
    order by sp.updated_at desc limit 500`);
  return c.json({ items: rows.map(mapSaved) });
});

userRoutes.post('/saved', async (c) => {
  const { opportunityId } = await jsonBody(c, saveProspectSchema);
  const row = await userTx(c, async (tx, uid) => {
    const [unlocked] = await tx`select exists(select 1 from opportunity_unlocks where user_id = ${uid} and opportunity_id = ${opportunityId}) as ok`;
    if (!unlocked?.ok) throw new ApiError(403, 'unlock_required', 'Unlock this opportunity before saving it.');
    const [r] = await tx`insert into saved_prospects (user_id, opportunity_id) values (${uid}, ${opportunityId})
      on conflict (user_id, opportunity_id) do update set updated_at = saved_prospects.updated_at returning *`;
    await track(tx, uid, 'opportunity_saved', opportunityId);
    const [n] = await tx`select count(*)::int as n from saved_prospects where user_id = ${uid}`;
    if (n?.n === 3) await track(tx, uid, 'first_3_prospects_saved');
    return r!;
  });
  return c.json(mapSaved(row), 201);
});

userRoutes.patch('/saved/:id', async (c) => {
  const id = uuidParam(c);
  const p = await jsonBody(c, updateProspectSchema);
  const row = await userTx(c, async (tx, uid) => {
    const [r] = await tx`update saved_prospects set
        stage = coalesce(${p.stage ?? null}, stage),
        notes = coalesce(${p.notes ?? null}, notes),
        follow_up_at = ${p.followUpAt === undefined ? tx`follow_up_at` : p.followUpAt}
      where id = ${id} and user_id = ${uid} returning *`;
    return r;
  });
  if (!row) throw notFound('Saved prospect');
  return c.json(mapSaved(row));
});

userRoutes.delete('/saved/:id', async (c) => {
  const id = uuidParam(c);
  const r = await userTx(c, (tx, uid) => tx`delete from saved_prospects where id = ${id} and user_id = ${uid} returning id`);
  if (!r.length) throw notFound('Saved prospect');
  return c.json({ ok: true });
});

userRoutes.get('/export', rateLimit('export', 10, 60_000), async (c) => {
  const csv = await userTx(c, async (tx, uid) => {
    const u = await usage(tx, c.get('deps').now());
    if (!u.exportPermission) throw new ApiError(403, 'plan_feature_unavailable', 'CSV export is available on the Pro plan.');
    const rows = await tx`select o.company_name, o.title, o.industry, sp.stage, sp.notes, sp.follow_up_at, sp.saved_at, o.is_demo, p.name as source
      from saved_prospects sp join opportunities o on o.id = sp.opportunity_id join source_providers p on p.id = o.provider_id
      where sp.user_id = ${uid} order by sp.saved_at desc`;
    return toCsv(
      ['Company', 'Role / need', 'Industry', 'Stage', 'Notes', 'Follow-up', 'Saved at', 'Demo data', 'Source'],
      rows.map((r) => [r.company_name, r.title, r.industry, r.stage, r.notes, r.follow_up_at, r.saved_at, r.is_demo ? 'DEMO — NOT A REAL LEAD' : 'no', r.source]),
    );
  });
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="va-leadfinder-prospects.csv"', 'Cache-Control': 'no-store' });
});

// ------------------------------------------------------------------ outreach
userRoutes.post('/outreach/draft', rateLimit('draft', 30, 60_000), async (c) => {
  const req = await jsonBody(c, outreachDraftRequestSchema);
  const now = c.get('deps').now();
  const out = await userTx(c, async (tx, uid) => {
    const d = await loadDetail(tx, uid, req.opportunityId, now);
    if (!d) throw notFound('Opportunity');
    if (!d.full) throw new ApiError(403, 'unlock_required', 'Unlock this opportunity to prepare outreach.');
    let body = req.body;
    let subject: string | undefined;
    if (!body) {
      const [profile] = await tx`select display_name from profiles where user_id = ${uid}`;
      const prefs = await loadPreferences(tx, uid);
      const need = [d.full.originalSummary.replace(/^\[DEMO\]\s*/, '').split(/(?<=\.)\s/)[0] ?? ''].join(' ').slice(0, 240);
      const g = generateOutreachDraft(req.templateCode, {
        companyName: d.companyName,
        roleTitle: d.title,
        confirmedNeed: need,
        userName: profile?.display_name ?? '',
        userSkills: prefs?.skills ?? [],
      });
      body = `Subject: ${g.subject}\n\n${g.body}`;
      subject = g.subject;
    }
    const [r] = await tx`insert into outreach_drafts (user_id, opportunity_id, template_code, draft_body)
      values (${uid}, ${req.opportunityId}, ${req.templateCode}, ${body})
      on conflict (user_id, opportunity_id) do update set template_code = excluded.template_code, draft_body = excluded.draft_body
      returning template_code, draft_body, updated_at`;
    return { templateCode: r!.template_code, body: r!.draft_body, updatedAt: r!.updated_at, subject };
  });
  return c.json(out);
});

// ------------------------------------------------------------------ usage / events / account
userRoutes.get('/usage', async (c) => c.json(await userTx(c, (tx) => usage(tx, c.get('deps').now()))));

userRoutes.post('/events', rateLimit('events', 60, 60_000), async (c) => {
  const e = await jsonBody(c, productEventSchema);
  // Only client-observable events; server-side events (subscription_*) are recorded by the server.
  if (!['outreach_draft_copied', 'source_link_clicked', 'signup_completed'].includes(e.event))
    throw new ApiError(400, 'validation_error', 'Event not accepted from clients');
  await userTx(c, (tx, uid) => track(tx, uid, e.event, e.relatedId));
  return c.json({ ok: true }, 202);
});

userRoutes.post('/account/export-request', rateLimit('account-export', 5, 3_600_000), async (c) => {
  const data = await userTx(c, async (tx, uid) => {
    const [profile] = await tx`select display_name, country, timezone, onboarding_completed, created_at from profiles where user_id = ${uid}`;
    const prefs = await loadPreferences(tx, uid);
    const saved = await tx`select sp.stage, sp.notes, sp.follow_up_at, sp.saved_at, o.company_name, o.title from saved_prospects sp join opportunities o on o.id = sp.opportunity_id where sp.user_id = ${uid}`;
    const drafts = await tx`select d.template_code, d.draft_body, d.updated_at, o.company_name from outreach_drafts d join opportunities o on o.id = d.opportunity_id where d.user_id = ${uid}`;
    const feedback = await tx`select reason, details, status, created_at from opportunity_feedback where user_id = ${uid}`;
    const subs = await tx`select status, current_period_start, current_period_end, cancelled_at, created_at from subscriptions where user_id = ${uid}`;
    const unlocks = await tx`select opportunity_id, period_key, created_at from opportunity_unlocks where user_id = ${uid}`;
    await tx`insert into data_requests (user_id, kind, status, completed_at) values (${uid}, 'export', 'completed', now())`;
    return { exportedAt: new Date().toISOString(), profile, preferences: prefs, savedProspects: saved, outreachDrafts: drafts, feedback, subscriptions: subs, unlocks };
  });
  return c.json(data, 200, { 'Content-Disposition': 'attachment; filename="va-leadfinder-my-data.json"', 'Cache-Control': 'no-store' });
});

userRoutes.post('/account/delete-request', rateLimit('account-delete', 3, 3_600_000), async (c) => {
  const r = await userTx(c, async (tx, uid) => {
    const [existing] = await tx`select id from data_requests where user_id = ${uid} and kind = 'delete' and status = 'pending'`;
    if (existing) return { id: existing.id, alreadyPending: true };
    const [row] = await tx`insert into data_requests (user_id, kind) values (${uid}, 'delete') returning id`;
    return { id: row!.id, alreadyPending: false };
  });
  return c.json({ ...r, message: 'Your deletion request was received. We will confirm by email once it is completed (target: within 15 days).' }, 202);
});

userRoutes.get('/account/requests', async (c) =>
  c.json({ items: await userTx(c, (tx) => tx`select id, kind, status, created_at, completed_at from data_requests order by created_at desc limit 20`) }),
);
