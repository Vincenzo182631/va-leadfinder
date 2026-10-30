// Canonical enums shared by web, api and database (keep in sync with SQL check constraints).

export const SKILLS = [
  { code: 'general_va', label: 'General VA' },
  { code: 'executive_assistant', label: 'Executive Assistant' },
  { code: 'ghl_crm', label: 'GoHighLevel / CRM' },
  { code: 'automation', label: 'Automation' },
  { code: 'email_marketing', label: 'Email Marketing' },
  { code: 'social_media', label: 'Social Media' },
  { code: 'website_seo', label: 'Website / SEO' },
  { code: 'customer_support', label: 'Customer Support' },
  { code: 'ecommerce', label: 'E-commerce' },
  { code: 'other', label: 'Other' },
] as const;
export type SkillCode = (typeof SKILLS)[number]['code'];
export const SKILL_CODES = SKILLS.map((s) => s.code) as [SkillCode, ...SkillCode[]];
export const skillLabel = (code: string) => SKILLS.find((s) => s.code === code)?.label ?? code;

export const INDUSTRIES = [
  'Marketing agency',
  'Real estate',
  'E-commerce',
  'Professional services',
  'Health & wellness',
  'Coaching & education',
  'Software / SaaS',
  'Home services',
  'Hospitality & travel',
  'Nonprofit',
  'Finance & insurance',
  'Other',
] as const;

export const MARKETS = ['US'] as const;

export const US_TIMEZONES = [
  { code: 'America/New_York', label: 'Eastern (ET)' },
  { code: 'America/Chicago', label: 'Central (CT)' },
  { code: 'America/Denver', label: 'Mountain (MT)' },
  { code: 'America/Los_Angeles', label: 'Pacific (PT)' },
] as const;

export const WORK_TYPES = ['part_time', 'contract', 'freelance', 'full_time'] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  part_time: 'Part-time',
  contract: 'Contract',
  freelance: 'Freelance',
  full_time: 'Full-time',
};

/** Who may work on this opportunity, as stated by the source. Never infer "worldwide" from "remote". */
export const REMOTE_ELIGIBILITY = ['worldwide', 'philippines_ok', 'unknown', 'us_only', 'other_restricted'] as const;
export type RemoteEligibility = (typeof REMOTE_ELIGIBILITY)[number];
export const REMOTE_ELIGIBILITY_LABELS: Record<RemoteEligibility, string> = {
  worldwide: 'Open worldwide',
  philippines_ok: 'Philippines-based OK',
  unknown: 'Eligibility not stated',
  us_only: 'US residents only',
  other_restricted: 'Other region restriction',
};

export const WORK_ARRANGEMENTS = ['remote', 'hybrid', 'onsite', 'unknown'] as const;
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];

export const ENGAGEMENT_TYPES = ['contract', 'freelance', 'part_time', 'full_time', 'unknown'] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

export const RESTRICTIONS = [
  'us_residents_only',
  'us_work_authorization',
  'onsite_required',
  'other_country_only',
  'timezone_overlap_required',
] as const;
export type Restriction = (typeof RESTRICTIONS)[number];
export const RESTRICTION_LABELS: Record<Restriction, string> = {
  us_residents_only: 'US residents only',
  us_work_authorization: 'US work authorization required',
  onsite_required: 'On-site attendance required',
  other_country_only: 'Restricted to another country',
  timezone_overlap_required: 'Requires US time-zone overlap',
};
/** Restrictions that are incompatible with a Philippines-based contractor. */
export const BLOCKING_RESTRICTIONS: Restriction[] = ['us_residents_only', 'us_work_authorization', 'other_country_only'];

export const HIRING_SIGNAL_TYPES = [
  'active_posting',
  'outsourcing_language',
  'multiple_roles',
  'growth_signal',
  'tool_stack_match',
] as const;
export type HiringSignalType = (typeof HIRING_SIGNAL_TYPES)[number];
export const HIRING_SIGNAL_LABELS: Record<HiringSignalType, string> = {
  active_posting: 'Active role posting',
  outsourcing_language: 'Mentions contractors / outsourcing',
  multiple_roles: 'Several related roles open',
  growth_signal: 'Public growth signal',
  tool_stack_match: 'Uses tools you listed',
};

export const PIPELINE_STAGES = [
  { code: 'saved', label: 'Saved' },
  { code: 'researching', label: 'Researching' },
  { code: 'contacted', label: 'Contacted' },
  { code: 'follow_up_due', label: 'Follow-up due' },
  { code: 'replied', label: 'Replied' },
  { code: 'qualified', label: 'Qualified' },
  { code: 'not_a_fit', label: 'Not a fit' },
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number]['code'];
export const PIPELINE_STAGE_CODES = PIPELINE_STAGES.map((s) => s.code) as [PipelineStage, ...PipelineStage[]];

export const ALERT_FREQUENCIES = ['off', 'weekly', 'daily'] as const;
export type AlertFrequency = (typeof ALERT_FREQUENCIES)[number];

export const QUALITY_STATUSES = ['needs_review', 'published', 'rejected', 'expired', 'taken_down'] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

export const LICENSE_STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'expired', 'revoked'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_cancelled',
  'active',
  'past_due',
  'unpaid',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const FEEDBACK_REASONS = [
  'inaccurate',
  'expired',
  'not_outsourcing',
  'region_restricted',
  'personal_data',
  'takedown_request',
  'other',
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const TEMPLATE_CODES = ['general_admin', 'ghl_crm', 'marketing_social'] as const;
export type TemplateCode = (typeof TEMPLATE_CODES)[number];

export const PRODUCT_EVENTS = [
  'signup_completed',
  'onboarding_completed',
  'search_performed',
  'opportunity_opened',
  'opportunity_saved',
  'source_link_clicked',
  'outreach_draft_copied',
  'first_3_prospects_saved',
  'subscription_started',
  'subscription_cancelled',
] as const;
export type ProductEvent = (typeof PRODUCT_EVENTS)[number];

export const DEMO_BANNER_TEXT = 'DEMO DATA — NOT REAL LEADS';
