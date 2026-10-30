import { describe, expect, it } from 'vitest';
import { bandFor, freshnessPoints, isExpired, isStale, scoreOpportunity, type ScorableOpportunity, type ScoringPreferences } from '../src';

const now = new Date('2026-10-30T00:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

const base: ScorableOpportunity = {
  skills: ['ghl_crm', 'automation'],
  hiringSignals: [
    { type: 'active_posting', note: 'Role posted on company careers page' },
    { type: 'outsourcing_language', note: 'Mentions contractors welcome' },
    { type: 'multiple_roles', note: 'Two ops roles open' },
  ],
  workArrangement: 'remote',
  remoteEligibility: 'worldwide',
  engagementType: 'contract',
  explicitRestrictions: [],
  outsourcingEvidence: 'Contract role',
  publishedAt: daysAgo(2),
  lastVerifiedAt: daysAgo(1),
  expiresAt: null,
  qualityStatus: 'published',
  isDemo: false,
};
const prefs: ScoringPreferences = { skills: ['ghl_crm', 'automation'], workTypes: ['contract', 'part_time'], requireRemote: true, excludeRegionRestricted: true };

describe('scoreOpportunity', () => {
  it('scores a perfect match at 100 with high fit', () => {
    const r = scoreOpportunity(base, prefs, now);
    expect(r.score).toBe(100);
    expect(r.band).toBe('high');
    expect(r.badges).toContain('Likely fit');
    expect(r.badges).toContain('New');
    expect(r.excluded).toBe(false);
    expect(r.components.map((c) => c.points)).toEqual([35, 30, 20, 15]);
  });

  it('gives partial skill credit and explains missing skills', () => {
    const r = scoreOpportunity(base, { ...prefs, skills: ['ghl_crm'] }, now);
    const skills = r.components.find((c) => c.key === 'skills')!;
    expect(skills.points).toBe(28); // 20 + 15 * 1/2 rounded
    expect(skills.reasons.join(' ')).toMatch(/Also asks for: Automation/);
  });

  it('caps roles outside selected skills below potential fit', () => {
    const r = scoreOpportunity(base, { ...prefs, skills: ['ecommerce'] }, now);
    expect(r.score).toBeLessThan(50);
    expect(r.penalties).toContain('Role is outside your selected skills');
  });

  it('excludes explicit US-only roles when the user hides region-restricted roles', () => {
    const r = scoreOpportunity({ ...base, remoteEligibility: 'us_only' }, prefs, now);
    expect(r.excluded).toBe(true);
    expect(r.badges).toContain('Region restricted');
    expect(r.score).toBeLessThanOrEqual(40);
  });

  it('penalises but keeps US work authorization roles when user opts to see them', () => {
    const r = scoreOpportunity({ ...base, explicitRestrictions: ['us_work_authorization'] }, { ...prefs, excludeRegionRestricted: false }, now);
    expect(r.excluded).toBe(false);
    expect(r.score).toBe(40);
    expect(r.penalties.join()).toMatch(/US work authorization required/);
  });

  it('does not treat "remote" with unknown eligibility as Philippines-eligible', () => {
    const r = scoreOpportunity({ ...base, remoteEligibility: 'unknown' }, prefs, now);
    const rc = r.components.find((c) => c.key === 'remoteContract')!;
    expect(rc.points).toBe(14); // 6 + 8
    expect(r.badges).toContain('Needs review');
    expect(rc.reasons.join()).toMatch(/not stated/);
  });

  it('worldwide remote is not region restricted', () => {
    expect(scoreOpportunity(base, prefs, now).badges).not.toContain('Region restricted');
  });

  it('excludes on-site roles when remote is required', () => {
    const r = scoreOpportunity({ ...base, workArrangement: 'onsite' }, prefs, now);
    expect(r.excluded).toBe(true);
    expect(r.exclusionReasons[0]).toMatch(/on-site/);
  });

  it('shows on-site roles when remote is not required', () => {
    const r = scoreOpportunity({ ...base, workArrangement: 'onsite' }, { ...prefs, requireRemote: false }, now);
    expect(r.excluded).toBe(false);
  });

  it('expired opportunities score 0 and are excluded', () => {
    const r = scoreOpportunity({ ...base, expiresAt: daysAgo(1) }, prefs, now);
    expect(r.score).toBe(0);
    expect(r.excluded).toBe(true);
  });

  it('penalises generic full-time roles without outsourcing evidence', () => {
    const r = scoreOpportunity({ ...base, engagementType: 'full_time', outsourcingEvidence: '', hiringSignals: [{ type: 'active_posting', note: 'Posted' }] }, { ...prefs, workTypes: ['full_time'] }, now);
    expect(r.penalties).toContain('Generic full-time employee role');
  });

  it('marks unverified records stale after 30 days', () => {
    const r = scoreOpportunity({ ...base, publishedAt: daysAgo(40), lastVerifiedAt: daysAgo(31) }, prefs, now);
    expect(r.badges).toContain('Stale');
    expect(r.badges).not.toContain('New');
  });

  it('does not mark viewed records as New', () => {
    expect(scoreOpportunity(base, prefs, now, { viewed: true }).badges).not.toContain('New');
  });

  it('does not count duplicate signal types twice and caps need at 30', () => {
    const r = scoreOpportunity({ ...base, hiringSignals: [...base.hiringSignals, { type: 'active_posting', note: 'dup' }, { type: 'growth_signal', note: 'x' }, { type: 'tool_stack_match', note: 'y' }] }, prefs, now);
    expect(r.components.find((c) => c.key === 'need')!.points).toBe(30);
  });

  it('labels demo records', () => {
    expect(scoreOpportunity({ ...base, isDemo: true }, prefs, now).badges[0]).toBe('Demo');
  });
});

describe('thresholds', () => {
  it.each([
    [100, 'high'], [75, 'high'], [74, 'potential'], [50, 'potential'], [49, 'low'], [0, 'low'],
  ])('score %i → %s', (s, b) => expect(bandFor(s)).toBe(b));

  it.each([[0, 15], [7, 15], [8, 11], [14, 11], [15, 7], [30, 7], [31, 3], [60, 3], [61, 0]])('freshness %i days → %i', (d, p) =>
    expect(freshnessPoints(d)).toBe(p));

  it('expiry boundary is inclusive of the instant', () => {
    expect(isExpired(now, now)).toBe(true);
    expect(isExpired(new Date(now.getTime() + 1), now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
  });

  it('stale boundary at 30 days', () => {
    expect(isStale(daysAgo(30), daysAgo(30), now)).toBe(false);
    expect(isStale(daysAgo(31), daysAgo(31), now)).toBe(true);
  });
});
