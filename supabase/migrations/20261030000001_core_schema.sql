-- VA LeadFinder core schema. Additive and non-destructive.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- settings
create table public.app_settings (
  id smallint primary key default 1 check (id = 1),
  demo_mode_enabled boolean not null default true,
  founding_member_enabled boolean not null default false,
  founding_member_cap integer not null default 100 check (founding_member_cap >= 0),
  founding_promo_months integer not null default 3 check (founding_promo_months between 1 and 24),
  grace_days integer not null default 3 check (grace_days between 0 and 14),
  checkout_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- plans
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z_]+$'),
  name text not null,
  description text not null default '',
  php_amount integer not null check (php_amount >= 0),          -- whole PHP per month
  monthly_unlock_limit integer not null check (monthly_unlock_limit >= 0),
  export_permission boolean not null default false,
  digest_frequency text not null default 'off' check (digest_frequency in ('off','weekly','daily')),
  enrichment_credit_limit integer not null default 0 check (enrichment_credit_limit >= 0),
  live_data_access boolean not null default false,
  promo_months integer check (promo_months is null or promo_months > 0),
  provider_plan_id_test text,
  provider_plan_id_live text,
  sort_order integer not null default 0,
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plans_updated before update on public.plans for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- users
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  country text not null default 'PH' check (char_length(country) = 2),
  timezone text not null default 'Asia/Manila',
  onboarding_completed boolean not null default false,
  last_seen_at timestamptz,
  previous_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  skills text[] not null default '{}',
  other_skill text not null default '',
  industries text[] not null default '{}',
  excluded_industries text[] not null default '{}',
  markets text[] not null default '{US}',
  us_timezones text[] not null default '{}',
  work_types text[] not null default '{part_time,contract}',
  require_remote boolean not null default true,
  exclude_region_restricted boolean not null default true,
  responsibilities text not null default '' check (char_length(responsibilities) <= 500),
  alert_frequency text not null default 'weekly' check (alert_frequency in ('off','weekly','daily')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (skills <@ array['general_va','executive_assistant','ghl_crm','automation','email_marketing','social_media','website_seo','customer_support','ecommerce','other']::text[]),
  check (work_types <@ array['part_time','contract','freelance','full_time']::text[])
);
create trigger user_preferences_updated before update on public.user_preferences for each row execute function public.set_updated_at();

create table public.email_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  digest_frequency text not null default 'weekly' check (digest_frequency in ('off','weekly','daily')),
  transactional_opt_in boolean not null default true,
  unsubscribe_token_hash text unique,
  last_digest_sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create trigger email_preferences_updated before update on public.email_preferences for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- billing
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  provider text not null check (provider in ('paymongo','mock')),
  provider_mode text not null check (provider_mode in ('mock','test','live')),
  provider_customer_id text,
  provider_subscription_id text unique,
  provider_payment_intent_id text,
  status text not null check (status in ('incomplete','incomplete_cancelled','active','past_due','unpaid','cancelled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  past_due_since timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  promo_ends_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_user_idx on public.subscriptions(user_id);
-- At most one open (non-terminal) subscription per user.
create unique index subscriptions_one_open_per_user on public.subscriptions(user_id)
  where status in ('incomplete','active','past_due','unpaid');
create trigger subscriptions_updated before update on public.subscriptions for each row execute function public.set_updated_at();

create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'paymongo',
  provider_event_id text not null unique,
  type text not null,
  livemode boolean not null default false,
  event_created_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received' check (status in ('received','processed','ignored','failed')),
  safe_error_message text,
  payload jsonb not null default '{}'::jsonb
);
create index billing_webhook_events_received_idx on public.billing_webhook_events(received_at desc);

-- ---------------------------------------------------------------- sources & licensing
create table public.source_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  homepage_url text not null,
  api_identifier text not null unique check (api_identifier ~ '^[a-z0-9_-]+$'),
  provider_kind text not null check (provider_kind in ('synthetic_demo','manual','licensed_api')),
  data_type text not null default '',
  license_status text not null default 'draft'
    check (license_status in ('draft','pending_review','approved','rejected','expired','revoked')),
  commercial_use_approved boolean not null default false,
  redistribution_approved boolean not null default false,
  digest_allowed boolean not null default false,
  allowed_usage text not null default '',
  approved_scope text not null default '',
  attribution_text text not null default '',
  approval_reference text not null default '',
  license_evidence_url text not null default '',
  approval_date date,
  approved_by uuid references auth.users(id) on delete set null,
  compliance_checklist jsonb not null default '{}'::jsonb,
  retention_days integer not null default 90 check (retention_days between 1 and 3650),
  enabled boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FAIL CLOSED: a non-demo provider can only be enabled after a documented compliance approval.
  constraint source_enable_requires_approval check (
    not enabled
    or provider_kind = 'synthetic_demo'
    or (
      license_status = 'approved'
      and commercial_use_approved
      and redistribution_approved
      and approval_reference <> ''
      and approval_date is not null
      and approved_by is not null
      and coalesce((compliance_checklist ->> 'termsReviewed')::boolean, false)
      and coalesce((compliance_checklist ->> 'personalDataReviewed')::boolean, false)
    )
  )
);
create trigger source_providers_updated before update on public.source_providers for each row execute function public.set_updated_at();

create table public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.source_providers(id) on delete cascade,
  triggered_by text not null default 'system',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','partial','failed','blocked')),
  fetched_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_message text,
  rejection_samples jsonb not null default '[]'::jsonb
);
create index ingestion_runs_provider_idx on public.ingestion_runs(provider_id, started_at desc);

create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.source_providers(id) on delete cascade,
  ingestion_run_id uuid references public.ingestion_runs(id) on delete set null,
  external_id text,
  dedupe_key text not null,
  original_url text not null,
  observed_at timestamptz not null default now(),
  source_posted_at timestamptz,
  raw_reference_hash text not null,
  allowed_usage text not null default '',
  license_snapshot jsonb not null default '{}'::jsonb,
  processing_state text not null default 'accepted' check (processing_state in ('accepted','rejected','duplicate','purged')),
  retain_until timestamptz,
  created_at timestamptz not null default now(),
  unique (dedupe_key)
);
create unique index source_records_provider_external on public.source_records(provider_id, external_id) where external_id is not null;
create index source_records_provider_idx on public.source_records(provider_id);

-- ---------------------------------------------------------------- opportunities
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null unique references public.source_records(id) on delete cascade,
  provider_id uuid not null references public.source_providers(id) on delete cascade,
  company_name text not null check (char_length(company_name) between 2 and 160),
  company_site text,
  title text not null check (char_length(title) between 3 and 200),
  original_summary text not null check (char_length(original_summary) <= 2000),
  industry text not null,
  country text not null default 'US',
  work_arrangement text not null default 'unknown' check (work_arrangement in ('remote','hybrid','onsite','unknown')),
  remote_eligibility text not null default 'unknown'
    check (remote_eligibility in ('worldwide','philippines_ok','unknown','us_only','other_restricted')),
  contract_suitability text not null default 'unknown'
    check (contract_suitability in ('contract','freelance','part_time','full_time','unknown')),
  explicit_restrictions text[] not null default '{}',
  hiring_signals jsonb not null default '[]'::jsonb,
  outsourcing_evidence text not null default '',
  contact_route text,
  published_at timestamptz not null default now(),
  last_verified_at timestamptz,
  expires_at timestamptz,
  quality_status text not null default 'needs_review'
    check (quality_status in ('needs_review','published','rejected','expired','taken_down')),
  is_demo boolean not null default false,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(company_name,'') || ' ' || coalesce(title,'') || ' ' || coalesce(industry,''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index opportunities_published_idx on public.opportunities(published_at desc);
create index opportunities_expires_idx on public.opportunities(expires_at);
create index opportunities_provider_idx on public.opportunities(provider_id);
create index opportunities_quality_idx on public.opportunities(quality_status);
create index opportunities_search_idx on public.opportunities using gin(search_vector);
create trigger opportunities_updated before update on public.opportunities for each row execute function public.set_updated_at();

create table public.opportunity_skill_tags (
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  skill_code text not null check (skill_code in ('general_va','executive_assistant','ghl_crm','automation','email_marketing','social_media','website_seo','customer_support','ecommerce','other')),
  primary key (opportunity_id, skill_code)
);
create index opportunity_skill_tags_skill_idx on public.opportunity_skill_tags(skill_code);

-- ---------------------------------------------------------------- per-user activity
create table public.opportunity_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  primary key (user_id, opportunity_id)
);

create table public.opportunity_dismissals (
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, opportunity_id)
);

create table public.opportunity_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  period_key text not null check (period_key ~ '^\d{4}-\d{2}$'),
  plan_code text not null,
  created_at timestamptz not null default now(),
  unique (user_id, opportunity_id, period_key)
);
create index opportunity_unlocks_user_period_idx on public.opportunity_unlocks(user_id, period_key);

create table public.saved_prospects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  stage text not null default 'saved'
    check (stage in ('saved','researching','contacted','follow_up_due','replied','qualified','not_a_fit')),
  notes text not null default '' check (char_length(notes) <= 5000),
  follow_up_at timestamptz,
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, opportunity_id)
);
create index saved_prospects_user_idx on public.saved_prospects(user_id, updated_at desc);
create trigger saved_prospects_updated before update on public.saved_prospects for each row execute function public.set_updated_at();

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  amount integer not null default 1,
  period_key text not null,
  related_record_id uuid,
  created_at timestamptz not null default now()
);
create index usage_events_user_period_idx on public.usage_events(user_id, period_key);

create table public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  template_code text not null check (template_code in ('general_admin','ghl_crm','marketing_social')),
  draft_body text not null check (char_length(draft_body) <= 8000),
  updated_at timestamptz not null default now(),
  unique (user_id, opportunity_id)
);
create trigger outreach_drafts_updated before update on public.outreach_drafts for each row execute function public.set_updated_at();

create table public.opportunity_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  reason text not null check (reason in ('inaccurate','expired','not_outsourcing','region_restricted','personal_data','takedown_request','other')),
  details text not null default '' check (char_length(details) <= 2000),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index opportunity_feedback_status_idx on public.opportunity_feedback(status, created_at desc);

create table public.product_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  event text not null check (event in ('signup_completed','onboarding_completed','search_performed','opportunity_opened','opportunity_saved','source_link_clicked','outreach_draft_copied','first_3_prospects_saved','subscription_started','subscription_cancelled')),
  related_id uuid,
  created_at timestamptz not null default now()
);
create index product_events_event_idx on public.product_events(event, created_at desc);

create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('export','delete')),
  status text not null default 'pending' check (status in ('pending','completed','rejected')),
  note text not null default '',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_log_created_idx on public.admin_audit_log(created_at desc);

-- ---------------------------------------------------------------- new-user bootstrap
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(user_id, display_name)
    values (new.id, coalesce(left(new.raw_user_meta_data ->> 'display_name', 80), ''))
    on conflict do nothing;
  insert into public.email_preferences(user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
