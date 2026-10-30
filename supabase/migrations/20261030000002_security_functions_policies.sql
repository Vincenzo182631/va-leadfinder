-- Row Level Security, column grants and server-enforced quota functions.
-- Principle: the browser never gets more than teaser columns. Full opportunity detail,
-- unlock quotas and admin data go through SECURITY DEFINER functions or the trusted API.

-- ---------------------------------------------------------------- helpers
create or replace function public.current_period_key() returns text
language sql stable as $$ select to_char(now() at time zone 'Asia/Manila', 'YYYY-MM') $$;

create or replace function public.opportunity_is_servable(p_opportunity_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from opportunities o
    join source_providers p on p.id = o.provider_id
    cross join app_settings s
    where o.id = p_opportunity_id
      and o.quality_status = 'published'
      and (o.expires_at is null or o.expires_at > now())
      and p.enabled
      and (
        (o.is_demo and p.provider_kind = 'synthetic_demo' and s.demo_mode_enabled)
        or (
          not o.is_demo
          and p.provider_kind <> 'synthetic_demo'
          and p.license_status = 'approved'
          and p.commercial_use_approved
          and p.redistribution_approved
        )
      )
  )
$$;

-- Plan currently in force for a user (falls back to 'free'). Mirrors shared/entitlements.resolvePlanCode.
create or replace function public.current_plan_code(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select pl.code
    from subscriptions sub
    join plans pl on pl.id = sub.plan_id
    cross join app_settings s
    where sub.user_id = p_user
      and (
        sub.status = 'active'
        or (sub.status = 'past_due' and now() < coalesce(sub.past_due_since, now()) + make_interval(days => s.grace_days))
        or (sub.status = 'cancelled' and sub.current_period_end is not null and now() < sub.current_period_end)
      )
    order by (sub.status = 'active') desc, sub.current_period_end desc nulls last
    limit 1
  ), 'free')
$$;

create or replace function public.my_usage() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_plan plans;
  v_used integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into v_plan from plans where code = current_plan_code(v_uid);
  select count(*) into v_used from opportunity_unlocks where user_id = v_uid and period_key = current_period_key();
  return jsonb_build_object(
    'planCode', v_plan.code, 'planName', v_plan.name, 'periodKey', current_period_key(),
    'unlocksUsed', v_used, 'unlockLimit', v_plan.monthly_unlock_limit,
    'remaining', greatest(v_plan.monthly_unlock_limit - v_used, 0),
    'exportPermission', v_plan.export_permission, 'liveDataAccess', v_plan.live_data_access
  );
end $$;

create or replace function public.has_detail_access(p_user uuid, p_opportunity_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from opportunity_unlocks u where u.user_id = p_user and u.opportunity_id = p_opportunity_id and u.period_key = current_period_key())
      or exists (select 1 from saved_prospects sp where sp.user_id = p_user and sp.opportunity_id = p_opportunity_id)
$$;

-- Concurrency-safe unlock. Charges at most once per user/opportunity/period.
create or replace function public.unlock_opportunity(p_opportunity_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_period text := current_period_key();
  v_plan plans;
  v_is_demo boolean;
  v_used integer;
  v_inserted uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  -- Serialise unlocks per user so parallel requests cannot exceed the quota.
  perform pg_advisory_xact_lock(hashtextextended('unlock:' || v_uid::text, 0));

  if not opportunity_is_servable(p_opportunity_id) then
    return jsonb_build_object('status', 'not_found');
  end if;

  if has_detail_access(v_uid, p_opportunity_id) then
    return jsonb_build_object('status', 'already_unlocked') || my_usage();
  end if;

  select * into v_plan from plans where code = current_plan_code(v_uid);
  select is_demo into v_is_demo from opportunities where id = p_opportunity_id;

  if not v_is_demo and not v_plan.live_data_access then
    return jsonb_build_object('status', 'live_data_requires_paid_plan') || my_usage();
  end if;

  select count(*) into v_used from opportunity_unlocks where user_id = v_uid and period_key = v_period;
  if v_used >= v_plan.monthly_unlock_limit then
    return jsonb_build_object('status', 'plan_limit_reached') || my_usage();
  end if;

  insert into opportunity_unlocks(user_id, opportunity_id, period_key, plan_code)
    values (v_uid, p_opportunity_id, v_period, v_plan.code)
    on conflict (user_id, opportunity_id, period_key) do nothing
    returning id into v_inserted;

  if v_inserted is not null then
    insert into usage_events(user_id, event_type, amount, period_key, related_record_id)
      values (v_uid, 'opportunity_unlock', 1, v_period, p_opportunity_id);
  end if;

  return jsonb_build_object('status', 'unlocked') || my_usage();
end $$;

-- Full detail, only after unlock (or while saved in the pipeline).
create or replace function public.get_opportunity_full(p_opportunity_id uuid)
returns table (
  id uuid, company_site text, original_summary text, outsourcing_evidence text,
  contact_route text, source_url text, source_posted_at timestamptz, observed_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select o.id, o.company_site, o.original_summary, o.outsourcing_evidence, o.contact_route,
         r.original_url, r.source_posted_at, r.observed_at
  from opportunities o
  join source_records r on r.id = o.source_record_id
  where o.id = p_opportunity_id
    and auth.uid() is not null
    and opportunity_is_servable(o.id)
    and has_detail_access(auth.uid(), o.id)
$$;

-- Saving requires the user to have unlocked the opportunity first.
create or replace function public.saved_prospect_insert_allowed(p_opportunity_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and opportunity_is_servable(p_opportunity_id)
     and exists (select 1 from opportunity_unlocks u where u.user_id = auth.uid() and u.opportunity_id = p_opportunity_id)
$$;

create or replace function public.i_have_detail_access(p_opportunity_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and has_detail_access(auth.uid(), p_opportunity_id)
$$;
revoke execute on function public.i_have_detail_access(uuid) from public, anon;
grant execute on function public.i_have_detail_access(uuid) to authenticated;

-- ---------------------------------------------------------------- grants
-- Supabase grants everything to anon/authenticated by default; start from zero.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.unlock_opportunity(uuid) to authenticated;
grant execute on function public.get_opportunity_full(uuid) to authenticated;
grant execute on function public.my_usage() to authenticated;
grant execute on function public.current_period_key() to authenticated;
grant execute on function public.opportunity_is_servable(uuid) to authenticated;
grant execute on function public.saved_prospect_insert_allowed(uuid) to authenticated;

-- Public-ish config
grant select on public.plans to anon, authenticated;
grant select (id, demo_mode_enabled, founding_member_enabled, grace_days, checkout_enabled) on public.app_settings to anon, authenticated;

-- Own profile / preferences
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.user_preferences to authenticated;
grant select (user_id, digest_frequency, transactional_opt_in, last_digest_sent_at, updated_at) on public.email_preferences to authenticated;
grant update (digest_frequency, transactional_opt_in) on public.email_preferences to authenticated;

-- Opportunities: teaser columns only.
grant select (
  id, provider_id, company_name, title, industry, country, work_arrangement, remote_eligibility,
  contract_suitability, explicit_restrictions, hiring_signals, published_at, last_verified_at,
  expires_at, quality_status, is_demo, search_vector, created_at
) on public.opportunities to authenticated;
grant select on public.opportunity_skill_tags to authenticated;
grant select (id, name, provider_kind, attribution_text, enabled) on public.source_providers to authenticated;

grant select, insert, delete on public.opportunity_views to authenticated;
grant select, insert, delete on public.opportunity_dismissals to authenticated;
grant select on public.opportunity_unlocks to authenticated;
grant select, insert, update, delete on public.saved_prospects to authenticated;
grant select on public.usage_events to authenticated;
grant select, insert, update, delete on public.outreach_drafts to authenticated;
grant select, insert on public.opportunity_feedback to authenticated;
grant insert on public.product_events to authenticated;
grant select, insert on public.data_requests to authenticated;
grant select (id, user_id, plan_id, provider, status, current_period_start, current_period_end, past_due_since, cancelled_at, promo_ends_at, created_at, updated_at)
  on public.subscriptions to authenticated;
-- NOT granted to anon/authenticated at all: source_records, ingestion_runs, billing_webhook_events, admin_audit_log.

-- ---------------------------------------------------------------- RLS
alter table public.app_settings enable row level security;
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.email_preferences enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.source_providers enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.source_records enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_skill_tags enable row level security;
alter table public.opportunity_views enable row level security;
alter table public.opportunity_dismissals enable row level security;
alter table public.opportunity_unlocks enable row level security;
alter table public.saved_prospects enable row level security;
alter table public.usage_events enable row level security;
alter table public.outreach_drafts enable row level security;
alter table public.opportunity_feedback enable row level security;
alter table public.product_events enable row level security;
alter table public.data_requests enable row level security;
alter table public.admin_audit_log enable row level security;

create policy app_settings_read on public.app_settings for select to anon, authenticated using (true);
create policy plans_read on public.plans for select to anon, authenticated using (active);

create policy profiles_own on public.profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy prefs_own on public.user_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy email_prefs_own on public.email_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy subscriptions_own_read on public.subscriptions for select to authenticated using (user_id = auth.uid());

create policy providers_enabled_read on public.source_providers for select to authenticated using (enabled);
create policy opportunities_servable on public.opportunities for select to authenticated
  using (public.opportunity_is_servable(id));
create policy skill_tags_servable on public.opportunity_skill_tags for select to authenticated
  using (public.opportunity_is_servable(opportunity_id));

create policy views_own on public.opportunity_views for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.opportunity_is_servable(opportunity_id));
create policy dismissals_own on public.opportunity_dismissals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.opportunity_is_servable(opportunity_id));
create policy unlocks_own_read on public.opportunity_unlocks for select to authenticated using (user_id = auth.uid());
create policy usage_own_read on public.usage_events for select to authenticated using (user_id = auth.uid());

create policy saved_select_own on public.saved_prospects for select to authenticated using (user_id = auth.uid());
create policy saved_insert_own on public.saved_prospects for insert to authenticated
  with check (user_id = auth.uid() and public.saved_prospect_insert_allowed(opportunity_id));
create policy saved_update_own on public.saved_prospects for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy saved_delete_own on public.saved_prospects for delete to authenticated using (user_id = auth.uid());

create policy drafts_own on public.outreach_drafts for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.i_have_detail_access(opportunity_id));

create policy feedback_own_read on public.opportunity_feedback for select to authenticated using (user_id = auth.uid());
create policy feedback_own_insert on public.opportunity_feedback for insert to authenticated
  with check (user_id = auth.uid() and public.opportunity_is_servable(opportunity_id));

create policy product_events_own_insert on public.product_events for insert to authenticated with check (user_id = auth.uid());
create policy data_requests_own on public.data_requests for select to authenticated using (user_id = auth.uid());
create policy data_requests_own_insert on public.data_requests for insert to authenticated with check (user_id = auth.uid());
-- billing_webhook_events, source_records, ingestion_runs, admin_audit_log: RLS on, no policies → server/admin only.


-- (re-grant after the blanket revoke above)
grant execute on function public.i_have_detail_access(uuid) to authenticated;
