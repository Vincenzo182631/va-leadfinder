import {
  BLOCKING_RESTRICTIONS,
  HIRING_SIGNAL_LABELS,
  type EngagementType,
  type HiringSignalType,
  type RemoteEligibility,
  type Restriction,
  type SkillCode,
  type WorkArrangement,
  type WorkType,
  skillLabel,
  RESTRICTION_LABELS,
} from '../constants';

/**
 * Deterministic 0–100 match score. Per-user: never store one universal score.
 *   Skill relevance        up to 35
 *   Hiring / need evidence up to 30
 *   Remote + contract fit  up to 20
 *   Freshness              up to 15
 */
export const SCORE_WEIGHTS = { skills: 35, need: 30, remoteContract: 20, freshness: 15 } as const;
export const HIGH_FIT_MIN = 75;
export const POTENTIAL_FIT_MIN = 50;
export const STALE_AFTER_DAYS = 30;
export const NEW_WITHIN_DAYS = 7;
/** Score cap applied when a hard restriction applies but the user chose not to hide such roles. */
export const RESTRICTED_SCORE_CAP = 40;

export const SIGNAL_POINTS: Record<HiringSignalType, number> = {
  active_posting: 15,
  outsourcing_language: 10,
  multiple_roles: 5,
  growth_signal: 5,
  tool_stack_match: 5,
};

export interface ScorableOpportunity {
  skills: SkillCode[];
  hiringSignals: { type: HiringSignalType; note: string }[];
  workArrangement: WorkArrangement;
  remoteEligibility: RemoteEligibility;
  engagementType: EngagementType;
  explicitRestrictions: Restriction[];
  outsourcingEvidence: string;
  publishedAt: string | Date;
  lastVerifiedAt: string | Date | null;
  expiresAt: string | Date | null;
  qualityStatus: string;
  isDemo: boolean;
}

export interface ScoringPreferences {
  skills: SkillCode[];
  workTypes: WorkType[];
  requireRemote: boolean;
  excludeRegionRestricted: boolean;
}

export type FitBand = 'high' | 'potential' | 'low';
export type Badge = 'New' | 'Likely fit' | 'Needs review' | 'Region restricted' | 'Stale' | 'Demo';

export interface ScoreComponent {
  key: keyof typeof SCORE_WEIGHTS;
  label: string;
  points: number;
  max: number;
  reasons: string[];
}

export interface ScoreResult {
  score: number;
  band: FitBand;
  bandLabel: string;
  components: ScoreComponent[];
  /** Hidden/excluded from default results, with reasons. */
  excluded: boolean;
  exclusionReasons: string[];
  penalties: string[];
  badges: Badge[];
  matchedSkills: SkillCode[];
}

const DAY = 86_400_000;
const toDate = (d: string | Date) => (d instanceof Date ? d : new Date(d));

export function daysBetween(from: string | Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - toDate(from).getTime()) / DAY));
}

export function isExpired(expiresAt: string | Date | null, now: Date): boolean {
  return expiresAt !== null && toDate(expiresAt).getTime() <= now.getTime();
}

export function isStale(lastVerifiedAt: string | Date | null, publishedAt: string | Date, now: Date): boolean {
  return daysBetween(lastVerifiedAt ?? publishedAt, now) > STALE_AFTER_DAYS;
}

export function freshnessPoints(ageDays: number): number {
  if (ageDays <= 7) return 15;
  if (ageDays <= 14) return 11;
  if (ageDays <= 30) return 7;
  if (ageDays <= 60) return 3;
  return 0;
}

export function bandFor(score: number): FitBand {
  if (score >= HIGH_FIT_MIN) return 'high';
  if (score >= POTENTIAL_FIT_MIN) return 'potential';
  return 'low';
}
export const BAND_LABELS: Record<FitBand, string> = {
  high: 'High fit',
  potential: 'Potential fit',
  low: 'Low fit',
};

/** True when nothing in the source says a Philippines-based contractor is excluded. */
export function hasBlockingRestriction(o: Pick<ScorableOpportunity, 'remoteEligibility' | 'explicitRestrictions'>) {
  return (
    o.remoteEligibility === 'us_only' ||
    o.remoteEligibility === 'other_restricted' ||
    o.explicitRestrictions.some((r) => BLOCKING_RESTRICTIONS.includes(r))
  );
}

export function scoreOpportunity(
  o: ScorableOpportunity,
  prefs: ScoringPreferences,
  now: Date = new Date(),
  opts: { viewed?: boolean } = {},
): ScoreResult {
  const exclusionReasons: string[] = [];
  const penalties: string[] = [];

  // --- Skills (35) ---
  const matchedSkills = o.skills.filter((s) => prefs.skills.includes(s));
  const skillReasons: string[] = [];
  let skillPts = 0;
  if (o.skills.length === 0) {
    skillReasons.push('No skills listed for this opportunity');
  } else if (matchedSkills.length === 0) {
    skillReasons.push(`Needs ${o.skills.map(skillLabel).join(', ')} — outside your selected skills`);
    penalties.push('Role is outside your selected skills');
  } else {
    skillPts = Math.round(20 + 15 * (matchedSkills.length / o.skills.length));
    skillReasons.push(`Matches your skills: ${matchedSkills.map(skillLabel).join(', ')}`);
    const missing = o.skills.filter((s) => !matchedSkills.includes(s));
    if (missing.length) skillReasons.push(`Also asks for: ${missing.map(skillLabel).join(', ')}`);
  }

  // --- Need / hiring evidence (30) ---
  const needReasons: string[] = [];
  let needPts = 0;
  const seen = new Set<HiringSignalType>();
  for (const s of o.hiringSignals) {
    if (seen.has(s.type)) continue;
    seen.add(s.type);
    needPts += SIGNAL_POINTS[s.type];
    needReasons.push(`${HIRING_SIGNAL_LABELS[s.type]}: ${s.note}`);
  }
  needPts = Math.min(needPts, SCORE_WEIGHTS.need);
  if (needReasons.length === 0) needReasons.push('No documented hiring signal');

  // --- Remote & contract suitability (20) ---
  const rcReasons: string[] = [];
  let rcPts = 0;
  const blocking = hasBlockingRestriction(o);
  if (o.workArrangement === 'remote') {
    if (blocking) {
      rcReasons.push('Remote, but the source restricts who can apply');
    } else if (o.remoteEligibility === 'worldwide' || o.remoteEligibility === 'philippines_ok') {
      rcPts += 12;
      rcReasons.push('Remote and open to Philippines-based contractors');
    } else {
      rcPts += 6;
      rcReasons.push('Remote, but location eligibility is not stated — verify before applying');
    }
  } else if (o.workArrangement === 'unknown') {
    rcPts += 3;
    rcReasons.push('Work arrangement not stated');
  } else {
    rcReasons.push(o.workArrangement === 'onsite' ? 'On-site role' : 'Hybrid role');
  }

  const hasOutsourcingEvidence =
    o.outsourcingEvidence.trim().length > 0 || o.hiringSignals.some((s) => s.type === 'outsourcing_language');
  const engagementAsWorkType: Partial<Record<EngagementType, WorkType>> = {
    contract: 'contract',
    freelance: 'freelance',
    part_time: 'part_time',
    full_time: 'full_time',
  };
  if (o.engagementType === 'contract' || o.engagementType === 'freelance' || o.engagementType === 'part_time') {
    rcPts += 8;
    rcReasons.push(`${o.engagementType.replace('_', '-')} engagement suits independent VAs`);
  } else if (o.engagementType === 'full_time') {
    if (hasOutsourcingEvidence) {
      rcPts += 4;
      rcReasons.push('Full-time, but the source mentions contractors or outsourcing');
    } else {
      rcReasons.push('Full-time employee role with no outsourcing evidence');
      penalties.push('Generic full-time employee role');
    }
  } else {
    rcPts += 2;
    rcReasons.push('Engagement type not stated');
  }
  const wt = engagementAsWorkType[o.engagementType];
  if (wt && prefs.workTypes.length && !prefs.workTypes.includes(wt)) {
    penalties.push(`Engagement (${wt.replace('_', '-')}) is not in your preferred work types`);
    rcPts = Math.max(0, rcPts - 4);
  }

  // --- Freshness (15) ---
  const ageDays = daysBetween(o.publishedAt, now);
  const freshPts = freshnessPoints(ageDays);
  const freshReasons = [ageDays === 0 ? 'Published today' : `Published ${ageDays} day${ageDays === 1 ? '' : 's'} ago`];
  const stale = isStale(o.lastVerifiedAt, o.publishedAt, now);
  if (stale) freshReasons.push(`Not verified in the last ${STALE_AFTER_DAYS} days`);

  // --- Exclusions ---
  const expired = isExpired(o.expiresAt, now) || o.qualityStatus === 'expired';
  if (expired) exclusionReasons.push('Opportunity has expired');
  if (prefs.requireRemote && (o.workArrangement === 'onsite' || o.workArrangement === 'hybrid')) {
    exclusionReasons.push('Requires on-site presence and you require remote work');
  }
  if (o.explicitRestrictions.includes('onsite_required') && prefs.requireRemote) {
    if (!exclusionReasons.some((r) => r.startsWith('Requires on-site'))) {
      exclusionReasons.push('Requires on-site presence and you require remote work');
    }
  }
  const restrictionNotes = o.explicitRestrictions
    .filter((r) => BLOCKING_RESTRICTIONS.includes(r))
    .map((r) => RESTRICTION_LABELS[r]);
  if (o.remoteEligibility === 'us_only' && !restrictionNotes.includes('US residents only')) {
    restrictionNotes.push('US residents only');
  }
  if (o.remoteEligibility === 'other_restricted') restrictionNotes.push('Restricted to another region');
  if (blocking) {
    if (prefs.excludeRegionRestricted) exclusionReasons.push(`Not open to Philippines-based contractors (${restrictionNotes.join('; ')})`);
    else penalties.push(`Region restriction: ${restrictionNotes.join('; ')}`);
  }

  let score = skillPts + needPts + rcPts + freshPts;
  if (matchedSkills.length === 0) score = Math.min(score, POTENTIAL_FIT_MIN - 1);
  if (blocking) score = Math.min(score, RESTRICTED_SCORE_CAP);
  if (expired) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const band = bandFor(score);
  const badges: Badge[] = [];
  if (o.isDemo) badges.push('Demo');
  if (ageDays <= NEW_WITHIN_DAYS && !opts.viewed) badges.push('New');
  if (band === 'high' && exclusionReasons.length === 0) badges.push('Likely fit');
  if (o.qualityStatus === 'needs_review' || o.remoteEligibility === 'unknown') badges.push('Needs review');
  if (blocking) badges.push('Region restricted');
  if (stale) badges.push('Stale');

  return {
    score,
    band,
    bandLabel: BAND_LABELS[band],
    components: [
      { key: 'skills', label: 'Skill relevance', points: skillPts, max: SCORE_WEIGHTS.skills, reasons: skillReasons },
      { key: 'need', label: 'Hiring signal', points: needPts, max: SCORE_WEIGHTS.need, reasons: needReasons },
      {
        key: 'remoteContract',
        label: 'Remote & contract fit',
        points: rcPts,
        max: SCORE_WEIGHTS.remoteContract,
        reasons: rcReasons,
      },
      { key: 'freshness', label: 'Freshness', points: freshPts, max: SCORE_WEIGHTS.freshness, reasons: freshReasons },
    ],
    excluded: exclusionReasons.length > 0,
    exclusionReasons,
    penalties,
    badges,
    matchedSkills,
  };
}
