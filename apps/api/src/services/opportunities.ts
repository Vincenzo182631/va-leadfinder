import {
  preferencesSchema,
  scoreOpportunity,
  type OpportunityListItem,
  type OpportunitySearch,
  type Preferences,
  type ScoringPreferences,
} from '@vlf/shared';
import type { Tx } from '../db';

/** Max candidates scored per request. Bounded to prevent enumeration/abuse. */
export const CANDIDATE_LIMIT = 500;

const DEFAULT_PREFS: Preferences = preferencesSchema.parse({ skills: ['general_va'] });

export async function loadPreferences(tx: Tx, userId: string): Promise<Preferences | null> {
  const [p] = await tx`select * from user_preferences where user_id = ${userId}`;
  if (!p) return null;
  return {
    skills: p.skills,
    otherSkill: p.other_skill,
    industries: p.industries,
    excludedIndustries: p.excluded_industries,
    markets: p.markets,
    usTimezones: p.us_timezones,
    workTypes: p.work_types,
    requireRemote: p.require_remote,
    excludeRegionRestricted: p.exclude_region_restricted,
    responsibilities: p.responsibilities,
    alertFrequency: p.alert_frequency,
  } as Preferences;
}

const toScoringPrefs = (p: Preferences): ScoringPreferences => ({
  skills: p.skills,
  workTypes: p.workTypes,
  requireRemote: p.requireRemote,
  excludeRegionRestricted: p.excludeRegionRestricted,
});

type Row = Record<string, any>;

/** Teaser query, executed AS THE USER (RLS limits rows to servable opportunities). */
async function queryCandidates(tx: Tx, userId: string, f: Partial<OpportunitySearch> & { ids?: string[]; excludedIndustries?: string[] }) {
  const q = (f.query ?? '').trim();
  const days = ({ '7d': 7, '14d': 14, '30d': 30 } as Record<string, number>)[f.date ?? 'any'];
  return tx<Row[]>`
    select o.id, o.company_name, o.title, o.industry, o.country, o.work_arrangement, o.remote_eligibility,
      o.contract_suitability, o.explicit_restrictions, o.hiring_signals, o.published_at, o.last_verified_at,
      o.expires_at, o.quality_status, o.is_demo, o.provider_id,
      p.name as provider_name, p.attribution_text, p.provider_kind,
      coalesce((select array_agg(t.skill_code order by t.skill_code) from opportunity_skill_tags t where t.opportunity_id = o.id), '{}') as skills,
      exists(select 1 from opportunity_views v where v.opportunity_id = o.id and v.user_id = ${userId}) as viewed,
      exists(select 1 from opportunity_dismissals d where d.opportunity_id = o.id and d.user_id = ${userId}) as dismissed,
      exists(select 1 from saved_prospects s where s.opportunity_id = o.id and s.user_id = ${userId}) as saved,
      (exists(select 1 from opportunity_unlocks u where u.opportunity_id = o.id and u.user_id = ${userId} and u.period_key = current_period_key())
        or exists(select 1 from saved_prospects s2 where s2.opportunity_id = o.id and s2.user_id = ${userId})) as unlocked
    from opportunities o
    join source_providers p on p.id = o.provider_id
    where true
      ${f.ids ? tx`and o.id = any(${f.ids}::uuid[])` : tx``}
      ${q ? tx`and (o.search_vector @@ websearch_to_tsquery('english', ${q}) or o.company_name ilike ${'%' + q.replace(/[%_\\]/g, '\\$&') + '%'} or o.title ilike ${'%' + q.replace(/[%_\\]/g, '\\$&') + '%'})` : tx``}
      ${f.skill?.length ? tx`and exists(select 1 from opportunity_skill_tags t where t.opportunity_id = o.id and t.skill_code = any(${f.skill}))` : tx``}
      ${f.industry?.length ? tx`and o.industry = any(${f.industry})` : tx``}
      ${f.excludedIndustries?.length ? tx`and not (o.industry = any(${f.excludedIndustries}))` : tx``}
      ${f.country ? tx`and o.country = ${f.country}` : tx``}
      ${days ? tx`and o.published_at >= now() - make_interval(days => ${days})` : tx``}
      ${f.source ? tx`and o.provider_id::text = ${f.source}` : tx``}
      ${f.remote === 'remote_eligible' ? tx`and o.work_arrangement = 'remote' and o.remote_eligibility in ('worldwide','philippines_ok')` : tx``}
      ${f.remote === 'contract' ? tx`and o.contract_suitability in ('contract','freelance','part_time')` : tx``}
    order by o.published_at desc, o.id
    limit ${CANDIDATE_LIMIT}`;
}

function toItem(r: Row, prefs: Preferences, now: Date): OpportunityListItem {
  const scorable = {
    skills: r.skills,
    hiringSignals: r.hiring_signals ?? [],
    workArrangement: r.work_arrangement,
    remoteEligibility: r.remote_eligibility,
    engagementType: r.contract_suitability,
    explicitRestrictions: r.explicit_restrictions ?? [],
    outsourcingEvidence: '', // gated column; outsourcing language still counts via signals
    publishedAt: r.published_at,
    lastVerifiedAt: r.last_verified_at,
    expiresAt: r.expires_at,
    qualityStatus: r.quality_status,
    isDemo: r.is_demo,
  };
  const s = scoreOpportunity(scorable, toScoringPrefs(prefs), now, { viewed: r.viewed });
  return {
    id: r.id,
    companyName: r.company_name,
    title: r.title,
    industry: r.industry,
    country: r.country,
    workArrangement: r.work_arrangement,
    remoteEligibility: r.remote_eligibility,
    engagementType: r.contract_suitability,
    explicitRestrictions: scorable.explicitRestrictions,
    skills: r.skills,
    hiringSignals: scorable.hiringSignals,
    publishedAt: r.published_at,
    lastVerifiedAt: r.last_verified_at,
    expiresAt: r.expires_at,
    qualityStatus: r.quality_status,
    isDemo: r.is_demo,
    source: { providerName: r.provider_name, attributionText: r.attribution_text, isDemo: r.provider_kind === 'synthetic_demo' },
    score: s.score,
    band: s.band,
    bandLabel: s.bandLabel,
    badges: s.badges,
    components: s.components,
    excluded: s.excluded,
    exclusionReasons: s.exclusionReasons,
    penalties: s.penalties,
    viewed: r.viewed,
    saved: r.saved,
    dismissed: r.dismissed,
    unlocked: r.unlocked,
  };
}

export async function searchOpportunities(tx: Tx, userId: string, f: OpportunitySearch, now: Date) {
  const prefs = (await loadPreferences(tx, userId)) ?? DEFAULT_PREFS;
  const rows = await queryCandidates(tx, userId, { ...f, excludedIndustries: prefs.excludedIndustries });
  let items = rows.map((r) => toItem(r, prefs, now));
  if (f.seen === 'new') items = items.filter((i) => !i.viewed);
  if (f.seen === 'viewed') items = items.filter((i) => i.viewed);
  const visible = items.filter(
    (i) => (f.includeHidden || (!i.excluded && !i.dismissed)) && i.score >= f.minScore && i.score <= f.maxScore,
  );
  const hiddenCount = items.length - visible.length;
  visible.sort((a, b) => b.score - a.score || b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
  const start = (f.page - 1) * f.pageSize;
  return { items: visible.slice(start, start + f.pageSize), total: visible.length, hiddenCount, prefs };
}

export async function getOpportunityItem(tx: Tx, userId: string, id: string, now: Date) {
  const prefs = (await loadPreferences(tx, userId)) ?? DEFAULT_PREFS;
  const [row] = await queryCandidates(tx, userId, { ids: [id] });
  return row ? { item: toItem(row, prefs, now), prefs } : null;
}

export async function lastRefreshAt(tx: Tx): Promise<string | null> {
  const [r] = await tx`select max(last_verified_at) as t from opportunities`;
  return r?.t ?? null;
}
