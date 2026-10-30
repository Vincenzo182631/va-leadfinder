import { z } from 'zod';
import {
  ALERT_FREQUENCIES,
  ENGAGEMENT_TYPES,
  FEEDBACK_REASONS,
  HIRING_SIGNAL_TYPES,
  INDUSTRIES,
  LICENSE_STATUSES,
  PIPELINE_STAGE_CODES,
  PRODUCT_EVENTS,
  QUALITY_STATUSES,
  REMOTE_ELIGIBILITY,
  RESTRICTIONS,
  SKILL_CODES,
  TEMPLATE_CODES,
  WORK_ARRANGEMENTS,
  WORK_TYPES,
} from '../constants';

/** Only http(s) URLs; rejects javascript:, data:, etc. */
export const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Must be a valid http(s) URL');

const shortText = (max: number) => z.string().trim().max(max);
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Must be a valid date');

// ---------- Profile & preferences ----------
export const profileUpdateSchema = z.object({
  displayName: shortText(80).min(1, 'Name is required'),
  country: shortText(2).default('PH'),
  timezone: shortText(64).default('Asia/Manila'),
});

export const preferencesSchema = z.object({
  skills: z.array(z.enum(SKILL_CODES)).min(1, 'Choose at least one skill').max(10),
  otherSkill: shortText(80).optional().default(''),
  industries: z.array(z.enum(INDUSTRIES)).max(INDUSTRIES.length).default([]),
  excludedIndustries: z.array(z.enum(INDUSTRIES)).max(INDUSTRIES.length).default([]),
  markets: z.array(z.literal('US')).min(1).default(['US']),
  usTimezones: z.array(shortText(64)).max(4).default([]),
  workTypes: z.array(z.enum(WORK_TYPES)).min(1, 'Choose at least one work type').default(['part_time', 'contract']),
  requireRemote: z.boolean().default(true),
  excludeRegionRestricted: z.boolean().default(true),
  responsibilities: shortText(500).optional().default(''),
  alertFrequency: z.enum(ALERT_FREQUENCIES).default('weekly'),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const onboardingSchema = z.object({
  profile: profileUpdateSchema,
  preferences: preferencesSchema,
});

// ---------- Opportunity search ----------
const csvList = <T extends z.ZodType<string, string>>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : v.split(',').filter(Boolean)))
    .pipe(z.array(item).max(20));

export const opportunitySearchSchema = z.object({
  query: shortText(100).optional().default(''),
  skill: csvList(z.enum(SKILL_CODES)),
  industry: csvList(z.enum(INDUSTRIES)),
  country: shortText(2).optional(),
  remote: z.enum(['any', 'remote_eligible', 'contract']).optional().default('any'),
  date: z.enum(['any', '7d', '14d', '30d']).optional().default('any'),
  minScore: z.coerce.number().int().min(0).max(100).optional().default(50),
  maxScore: z.coerce.number().int().min(0).max(100).optional().default(100),
  source: shortText(64).optional(),
  seen: z.enum(['all', 'new', 'viewed']).optional().default('all'),
  includeHidden: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).max(50).optional().default(1),
  pageSize: z.coerce.number().int().min(5).max(50).optional().default(20),
});
export type OpportunitySearch = z.infer<typeof opportunitySearchSchema>;

// ---------- Saved pipeline ----------
export const saveProspectSchema = z.object({ opportunityId: z.uuid() });
export const updateProspectSchema = z
  .object({
    stage: z.enum(PIPELINE_STAGE_CODES).optional(),
    notes: shortText(5000).optional(),
    followUpAt: isoDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const feedbackSchema = z.object({
  reason: z.enum(FEEDBACK_REASONS),
  details: shortText(2000).optional().default(''),
});

export const outreachDraftRequestSchema = z.object({
  opportunityId: z.uuid(),
  templateCode: z.enum(TEMPLATE_CODES),
  body: shortText(8000).optional(),
});

export const productEventSchema = z.object({
  event: z.enum(PRODUCT_EVENTS),
  relatedId: z.uuid().optional(),
});

// ---------- Billing ----------
export const checkoutSchema = z.object({ planCode: z.enum(['solo', 'pro', 'founding']) });
export const cancelSchema = z.object({
  reason: z.enum(['too_expensive', 'missing_features', 'switched_service', 'unused', 'other']).default('other'),
});
export const attachPaymentSchema = z.object({ paymentMethodId: shortText(80).min(5) });

// ---------- Admin: sources ----------
export const sourceProviderSchema = z.object({
  name: shortText(120).min(2),
  homepageUrl: httpUrl,
  apiIdentifier: shortText(64).regex(/^[a-z0-9_-]+$/, 'lowercase letters, numbers, - and _ only'),
  dataType: shortText(200).min(2),
  allowedUsage: shortText(2000).default(''),
  approvedScope: shortText(2000).default(''),
  attributionText: shortText(500).default(''),
  approvalReference: shortText(500).default(''),
  licenseEvidenceUrl: httpUrl.optional().or(z.literal('')).default(''),
  approvalDate: isoDate.nullable().optional(),
  retentionDays: z.coerce.number().int().min(1).max(3650).default(90),
  commercialUseApproved: z.boolean().default(false),
  redistributionApproved: z.boolean().default(false),
  digestAllowed: z.boolean().default(false),
  notes: shortText(2000).default(''),
});
export const sourceProviderPatchSchema = sourceProviderSchema.partial().extend({
  licenseStatus: z.enum(LICENSE_STATUSES).optional(),
  enabled: z.boolean().optional(),
  complianceChecklist: z
    .object({
      termsReviewed: z.boolean(),
      commercialUseConfirmed: z.boolean(),
      redistributionConfirmed: z.boolean(),
      attributionConfigured: z.boolean(),
      retentionConfigured: z.boolean(),
      personalDataReviewed: z.boolean(),
    })
    .optional(),
});

// ---------- Admin / import: opportunities ----------
export const hiringSignalSchema = z.object({
  type: z.enum(HIRING_SIGNAL_TYPES),
  note: shortText(300).min(3),
});

export const opportunityInputSchema = z.object({
  companyName: shortText(160).min(2),
  companySite: httpUrl.optional().or(z.literal('')).default(''),
  title: shortText(200).min(3),
  originalSummary: shortText(2000).min(20, 'Write an original summary (20+ characters)'),
  industry: z.enum(INDUSTRIES),
  country: shortText(2).default('US'),
  workArrangement: z.enum(WORK_ARRANGEMENTS).default('unknown'),
  remoteEligibility: z.enum(REMOTE_ELIGIBILITY).default('unknown'),
  engagementType: z.enum(ENGAGEMENT_TYPES).default('unknown'),
  explicitRestrictions: z.array(z.enum(RESTRICTIONS)).default([]),
  hiringSignals: z.array(hiringSignalSchema).max(8).default([]),
  outsourcingEvidence: shortText(500).default(''),
  skills: z.array(z.enum(SKILL_CODES)).min(1).max(10),
  contactRoute: shortText(300).default(''),
  sourceUrl: httpUrl,
  externalId: shortText(200).optional(),
  sourcePostedAt: isoDate.nullable().optional(),
  expiresAt: isoDate.nullable().optional(),
});
export type OpportunityInput = z.infer<typeof opportunityInputSchema>;

export const adminOpportunityCreateSchema = opportunityInputSchema.extend({
  providerId: z.uuid(),
  lawfulBasisConfirmed: z.literal(true, 'Confirm the source and lawful basis before saving'),
});

export const adminOpportunityPatchSchema = z.object({
  qualityStatus: z.enum(QUALITY_STATUSES).optional(),
  lastVerifiedAt: isoDate.optional(),
  expiresAt: isoDate.nullable().optional(),
  reason: shortText(500).optional(),
});

export const importSchema = z.object({
  providerId: z.uuid(),
  csv: z.string().max(2_000_000),
  lawfulBasisConfirmed: z.literal(true, 'Confirm the source and lawful basis before importing'),
});

export const adminSettingsPatchSchema = z.object({
  demoModeEnabled: z.boolean().optional(),
  foundingMemberEnabled: z.boolean().optional(),
  foundingMemberCap: z.number().int().min(0).max(100000).optional(),
  foundingPromoMonths: z.number().int().min(1).max(24).optional(),
  graceDays: z.number().int().min(0).max(14).optional(),
  checkoutEnabled: z.boolean().optional(),
});

export const planPatchSchema = z.object({
  monthlyUnlockLimit: z.number().int().min(0).max(100000).optional(),
  exportPermission: z.boolean().optional(),
  active: z.boolean().optional(),
});

export const feedbackPatchSchema = z.object({
  status: z.enum(['open', 'resolved', 'dismissed']),
  resolutionNote: shortText(1000).optional(),
  takeDown: z.boolean().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
