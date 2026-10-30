import type { Badge, FitBand, ScoreComponent } from './scoring';
import type {
  EngagementType,
  HiringSignalType,
  PipelineStage,
  RemoteEligibility,
  Restriction,
  SkillCode,
  SubscriptionStatus,
  WorkArrangement,
} from './constants';
import type { Preferences } from './schemas';

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; details?: unknown };
}

export interface MeResponse {
  user: { id: string; email: string | null };
  profile: { displayName: string; country: string; timezone: string; onboardingCompleted: boolean } | null;
  preferences: Preferences | null;
  isAdmin: boolean;
  appMode: { demoMode: boolean; liveSourcesActive: number; environment: string; authMode: string };
}

export interface SourceAttribution {
  providerName: string;
  attributionText: string;
  isDemo: boolean;
}

export interface OpportunityListItem {
  id: string;
  companyName: string;
  title: string;
  industry: string;
  country: string;
  workArrangement: WorkArrangement;
  remoteEligibility: RemoteEligibility;
  engagementType: EngagementType;
  explicitRestrictions: Restriction[];
  skills: SkillCode[];
  hiringSignals: { type: HiringSignalType; note: string }[];
  publishedAt: string;
  lastVerifiedAt: string | null;
  expiresAt: string | null;
  qualityStatus: string;
  isDemo: boolean;
  source: SourceAttribution;
  score: number;
  band: FitBand;
  bandLabel: string;
  badges: Badge[];
  components: ScoreComponent[];
  excluded: boolean;
  exclusionReasons: string[];
  penalties: string[];
  viewed: boolean;
  saved: boolean;
  dismissed: boolean;
  unlocked: boolean;
}

export interface OpportunityDetail extends OpportunityListItem {
  /** Present only when unlocked. */
  full: null | {
    companySite: string | null;
    originalSummary: string;
    outsourcingEvidence: string;
    contactRoute: string | null;
    sourceUrl: string;
    sourcePostedAt: string | null;
    observedAt: string;
  };
  savedProspect: SavedProspect | null;
  draft: { templateCode: string; body: string; updatedAt: string } | null;
}

export interface OpportunityListResponse {
  items: OpportunityListItem[];
  page: number;
  pageSize: number;
  total: number;
  hiddenCount: number;
  lastRefreshAt: string | null;
}

export interface SavedProspect {
  id: string;
  opportunityId: string;
  stage: PipelineStage;
  notes: string;
  followUpAt: string | null;
  savedAt: string;
  updatedAt: string;
  companyName?: string;
  title?: string;
  isDemo?: boolean;
}

export interface UsageResponse {
  planCode: string;
  planName: string;
  periodKey: string;
  unlocksUsed: number;
  unlockLimit: number;
  remaining: number;
  resetsAt: string;
  exportPermission: boolean;
  liveDataAccess: boolean;
}

export interface SubscriptionResponse {
  planCode: string;
  subscription: null | {
    id: string;
    planCode: string;
    status: SubscriptionStatus;
    provider: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelledAt: string | null;
    pastDueSince: string | null;
  };
  graceDays: number;
  billing: { mode: 'disabled' | 'mock' | 'test' | 'live'; checkoutEnabled: boolean; message: string };
  plans: PlanDto[];
}

export interface PlanDto {
  code: string;
  name: string;
  phpAmount: number;
  monthlyUnlockLimit: number;
  exportPermission: boolean;
  digestFrequency: string;
  liveDataAccess: boolean;
  description: string;
  available: boolean;
}

export interface DashboardResponse {
  greetingName: string;
  newSinceLastVisit: number;
  savedCount: number;
  unreviewedHighFit: number;
  contactedCount: number;
  followUpsDue: number;
  lastRefreshAt: string | null;
  topMatches: OpportunityListItem[];
}
