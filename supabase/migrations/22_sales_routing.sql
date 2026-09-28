-- ============================================
-- CostPilot Phase 5 — Sales automation + routing
-- ============================================
-- Reuses the existing qualification, CRM, Slack, outbound, and reply-to-deal
-- runtime. Adds one canonical deterministic routing layer for:
--   * sales rep configuration
--   * lead assignment state
--   * assignment history
--   * routing / sync RPCs
--   * analytics-ready sales queues

create extension if not exists pgcrypto;
create table if not exists public.sales_reps (
    id          uuid primary key default gen_random_uuid(),
    rep_code    text not null unique,
    full_name   text not null,
    role        text not null,
    region      text,
    segment     text,
    active      boolean not null default true,
    capacity    integer not null default 50,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    constraint sales_reps_role_check
        check (role in ('sdr', 'ae')),
    constraint sales_reps_region_check
        check (region is null or region in ('north_america', 'europe', 'global')),
    constraint sales_reps_segment_check
        check (segment is null or segment in ('smb', 'mid_market', 'enterprise', 'all')),
    constraint sales_reps_capacity_check
        check (capacity > 0)
);
create index if not exists sales_reps_role_active_idx
    on public.sales_reps (role, active, region, segment);
drop trigger if exists sales_reps_set_updated_at on public.sales_reps;
create trigger sales_reps_set_updated_at
    before update on public.sales_reps
    for each row
    execute function public.set_updated_at();
alter table public.sales_reps enable row level security;
drop policy if exists "service_role_all_sales_reps" on public.sales_reps;
create policy "service_role_all_sales_reps"
    on public.sales_reps
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.sales_reps to service_role;
insert into public.sales_reps (rep_code, full_name, role, region, segment, capacity)
values
    ('sdr_na_1', 'Alex North', 'sdr', 'north_america', 'all', 75),
    ('sdr_global_1', 'Riley Global', 'sdr', 'global', 'all', 75),
    ('ae_ent_na_1', 'Jordan Enterprise', 'ae', 'north_america', 'enterprise', 40),
    ('ae_global_1', 'Morgan Growth', 'ae', 'global', 'all', 40)
on conflict (rep_code) do nothing;
create table if not exists public.sales_assignments (
    id                           uuid primary key default gen_random_uuid(),
    lead_id                      bigint not null unique references public.staged_leads (id) on delete cascade,
    profile_id                   uuid references public.profiles (id) on delete set null,
    account_id                   uuid references public.accounts (id) on delete set null,
    qualification_evaluation_id  uuid references public.qualification_evaluations (id) on delete set null,
    current_rep_id               uuid references public.sales_reps (id) on delete set null,
    current_owner_type           text,
    segment                      text,
    geography                    text,
    acquisition_channel          text,
    acquisition_source           text,
    fit_score                    integer,
    buying_intent                text,
    mql_status                   text,
    sql_status                   text,
    priority_tier                text,
    priority_score               integer not null default 0,
    routing_status               text not null,
    routing_reason               text not null,
    routing_rule_version         text not null default 'phase5_v1',
    eligible_for_sales           boolean not null default false,
    manual_override              boolean not null default false,
    manual_override_reason       text,
    needs_ae_handoff            boolean not null default false,
    crm_sync_status              text not null default 'not_started',
    slack_sync_status            text not null default 'not_started',
    retry_count                  integer not null default 0,
    last_error                   text,
    last_routed_at               timestamptz not null default now(),
    assigned_at                  timestamptz,
    handoff_at                   timestamptz,
    last_synced_at               timestamptz,
    created_at                   timestamptz not null default now(),
    updated_at                   timestamptz not null default now(),
    constraint sales_assignments_owner_type_check
        check (current_owner_type is null or current_owner_type in ('sdr', 'ae')),
    constraint sales_assignments_segment_check
        check (segment is null or segment in ('smb', 'mid_market', 'enterprise', 'unknown')),
    constraint sales_assignments_geography_check
        check (geography is null or geography in ('north_america', 'europe', 'global', 'unknown')),
    constraint sales_assignments_channel_check
        check (acquisition_channel is null or acquisition_channel in ('inbound', 'plg', 'outbound', 'partner', 'creator', 'referral')),
    constraint sales_assignments_intent_check
        check (buying_intent is null or buying_intent in ('high', 'medium', 'low')),
    constraint sales_assignments_mql_check
        check (mql_status is null or mql_status in ('qualified', 'nurture', 'disqualified')),
    constraint sales_assignments_sql_check
        check (sql_status is null or sql_status in ('sales_ready', 'awaiting_engagement', 'nurture', 'disqualified')),
    constraint sales_assignments_priority_check
        check (priority_tier is null or priority_tier in ('urgent', 'high', 'medium', 'low')),
    constraint sales_assignments_routing_status_check
        check (routing_status in ('pending', 'assigned', 'unassigned', 'handoff_pending', 'handed_off', 'retry_required', 'manually_overridden')),
    constraint sales_assignments_crm_sync_status_check
        check (crm_sync_status in ('not_started', 'pending', 'synced', 'retry_required', 'failed', 'not_applicable')),
    constraint sales_assignments_slack_sync_status_check
        check (slack_sync_status in ('not_started', 'pending', 'synced', 'retry_required', 'failed', 'not_applicable')),
    constraint sales_assignments_retry_count_check
        check (retry_count >= 0),
    constraint sales_assignments_owner_required_check
        check (
            (current_rep_id is null and current_owner_type is null)
            or (current_rep_id is not null and current_owner_type is not null)
        )
);
create index if not exists sales_assignments_owner_idx
    on public.sales_assignments (current_owner_type, routing_status, priority_score desc, last_routed_at desc);
create index if not exists sales_assignments_rep_idx
    on public.sales_assignments (current_rep_id, routing_status, last_routed_at desc);
create index if not exists sales_assignments_queue_idx
    on public.sales_assignments (routing_status, eligible_for_sales, priority_tier, priority_score desc, assigned_at asc);
drop trigger if exists sales_assignments_set_updated_at on public.sales_assignments;
create trigger sales_assignments_set_updated_at
    before update on public.sales_assignments
    for each row
    execute function public.set_updated_at();
alter table public.sales_assignments enable row level security;
drop policy if exists "service_role_all_sales_assignments" on public.sales_assignments;
create policy "service_role_all_sales_assignments"
    on public.sales_assignments
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.sales_assignments to service_role;
create table if not exists public.sales_assignment_history (
    id                uuid primary key default gen_random_uuid(),
    assignment_id     uuid not null references public.sales_assignments (id) on delete cascade,
    lead_id           bigint not null references public.staged_leads (id) on delete cascade,
    profile_id        uuid references public.profiles (id) on delete set null,
    account_id        uuid references public.accounts (id) on delete set null,
    action_type       text not null,
    from_rep_id       uuid references public.sales_reps (id) on delete set null,
    to_rep_id         uuid references public.sales_reps (id) on delete set null,
    from_owner_type   text,
    to_owner_type     text,
    from_status       text,
    to_status         text not null,
    reason            text not null,
    context           jsonb not null default '{}'::jsonb,
    created_at        timestamptz not null default now(),
    constraint sales_assignment_history_action_check
        check (action_type in ('routed', 'assigned', 'handoff', 'reassigned', 'manual_override', 'retry_marked', 'sync_updated')),
    constraint sales_assignment_history_owner_type_check
        check (
            (from_owner_type is null or from_owner_type in ('sdr', 'ae'))
            and (to_owner_type is null or to_owner_type in ('sdr', 'ae'))
        ),
    constraint sales_assignment_history_status_check
        check (
            (from_status is null or from_status in ('pending', 'assigned', 'unassigned', 'handoff_pending', 'handed_off', 'retry_required', 'manually_overridden'))
            and to_status in ('pending', 'assigned', 'unassigned', 'handoff_pending', 'handed_off', 'retry_required', 'manually_overridden')
        ),
    constraint sales_assignment_history_context_object_check
        check (jsonb_typeof(context) = 'object')
);
create index if not exists sales_assignment_history_assignment_created_at_idx
    on public.sales_assignment_history (assignment_id, created_at desc);
create index if not exists sales_assignment_history_lead_created_at_idx
    on public.sales_assignment_history (lead_id, created_at desc);
alter table public.sales_assignment_history enable row level security;
drop policy if exists "service_role_all_sales_assignment_history" on public.sales_assignment_history;
create policy "service_role_all_sales_assignment_history"
    on public.sales_assignment_history
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.sales_assignment_history to service_role;
create or replace view public.sales_routing_signal_assembly as
select
    q.lead_id,
    q.lead_email,
    q.company_name,
    q.source_type,
    q.lead_status,
    q.firmographics,
    q.lead_created_at,
    q.profile_id,
    q.account_id,
    q.firebase_uid,
    q.account_name,
    q.account_primary_domain,
    q.acquisition_channel,
    q.acquisition_source,
    q.acquisition_campaign,
    q.first_touch_channel,
    q.last_touch_channel,
    q.latest_interaction_channel,
    q.partner_id,
    q.creator_id,
    q.referral_id,
    q.icp_score,
    q.buying_intent,
    q.onboarding_company_size,
    q.onboarding_estimated_monthly_spend,
    q.onboarding_provider_count,
    q.onboarding_completed_at,
    q.product_event_count,
    q.last_product_event_at,
    q.lead_event_count,
    q.last_lead_event_at,
    q.nurture_email_count,
    q.ready_to_push_count,
    q.outreach_count,
    q.outreach_sent_count,
    q.outreach_reply_count,
    q.outreach_deal_count,
    q.last_outreach_sent_at,
    q.last_reply_received_at,
    c.evaluation_id as qualification_evaluation_id,
    c.rule_version as qualification_rule_version,
    c.fit_score,
    c.buying_intent as qualification_buying_intent,
    c.mql_status,
    c.sql_status,
    c.pql_status,
    c.crm_ready,
    c.outbound_ready,
    c.priority_score,
    c.priority_tier,
    c.explanation as qualification_explanation,
    c.evaluated_at as qualification_evaluated_at
from public.lead_qualification_signal_assembly q
left join public.lead_current_qualification c
    on c.lead_id = q.lead_id;
grant select on public.sales_routing_signal_assembly to service_role;
create or replace function public.route_lead_to_sales(
    p_lead_id bigint,
    p_trigger text default 'qualification_runtime',
    p_force_reassign boolean default false
) returns table (
    assignment_id uuid,
    lead_id bigint,
    profile_id uuid,
    account_id uuid,
    qualification_evaluation_id uuid,
    current_rep_id uuid,
    current_owner_type text,
    routing_status text,
    routing_reason text,
    segment text,
    geography text,
    priority_tier text,
    priority_score integer,
    crm_sync_status text,
    slack_sync_status text,
    evaluated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    s public.sales_routing_signal_assembly%rowtype;
    v_existing public.sales_assignments%rowtype;
    v_rep public.sales_reps%rowtype;
    v_segment text := 'unknown';
    v_geography text := 'unknown';
    v_owner_type text := null;
    v_routing_status text := 'unassigned';
    v_routing_reason text := 'not_sales_eligible';
    v_eligible boolean := false;
    v_handoff boolean := false;
    v_assignment_id uuid;
    v_action_type text := 'routed';
    v_fit integer := 0;
    v_intent text := null;
    v_priority_score integer := 0;
    v_priority_tier text := 'low';
    v_employees integer := null;
    v_company_size text := null;
    v_spend text := null;
    v_country text := null;
    v_last_sync timestamptz := null;
begin
    select *
    into s
    from public.sales_routing_signal_assembly
    where sales_routing_signal_assembly.lead_id = p_lead_id;

    if not found then
        raise exception 'lead_not_found';
    end if;

    if p_trigger is null or btrim(p_trigger) = '' then
        raise exception 'invalid_trigger';
    end if;

    if s.firmographics ? 'employees' then
        begin
            v_employees := (s.firmographics ->> 'employees')::integer;
        exception when others then
            v_employees := null;
        end;
    end if;

    v_company_size := nullif(btrim(coalesce(s.onboarding_company_size, '')), '');
    v_spend := lower(coalesce(s.onboarding_estimated_monthly_spend, ''));
    v_country := upper(coalesce(nullif(s.firmographics ->> 'country_code', ''), ''));
    if v_country = '' then
        v_country := upper(coalesce(nullif(s.firmographics ->> 'country', ''), ''));
    end if;

    v_segment := case
        when v_company_size in ('201-500', '201–500', '500+', '501+', '1000+', '1001+') then 'enterprise'
        when v_company_size in ('51-200', '51–200') then 'mid_market'
        when v_company_size in ('1-10', '11-50', '11–50') then 'smb'
        when v_employees is not null and v_employees >= 200 then 'enterprise'
        when v_employees is not null and v_employees >= 51 then 'mid_market'
        when v_employees is not null and v_employees >= 1 then 'smb'
        when v_spend like '%10k%' or v_spend like '%25k%' or v_spend like '%50k%' then 'enterprise'
        when v_spend like '%5k%' then 'mid_market'
        else 'unknown'
    end;

    v_geography := case
        when v_country in ('US', 'USA', 'CA', 'CANADA') then 'north_america'
        when v_country in ('GB', 'UK', 'UNITED KINGDOM', 'DE', 'GERMANY', 'FR', 'FRANCE', 'ES', 'SPAIN', 'IT', 'ITALY', 'NL', 'NETHERLANDS') then 'europe'
        when v_country = '' then 'global'
        else 'global'
    end;

    v_fit := greatest(0, least(coalesce(s.fit_score, s.icp_score, 0), 100));
    v_intent := case
        when coalesce(s.qualification_buying_intent, s.buying_intent) in ('high', 'medium', 'low') then coalesce(s.qualification_buying_intent, s.buying_intent)
        else null
    end;
    v_priority_score := greatest(0, least(coalesce(s.priority_score, 0), 100));
    v_priority_tier := coalesce(s.priority_tier, 'low');

    v_eligible := coalesce(s.sql_status, 'nurture') = 'sales_ready'
        and coalesce(s.lead_status, 'new') not in ('unverified', 'disqualified', 'nurture')
        and coalesce(s.mql_status, 'nurture') <> 'disqualified';

    if v_eligible then
        if coalesce(s.outreach_reply_count, 0) > 0 or coalesce(s.outreach_deal_count, 0) > 0 then
            v_owner_type := 'ae';
            v_routing_reason := 'reply_or_deal_handoff';
            v_handoff := true;
        elsif coalesce(s.acquisition_channel, 'inbound') = 'outbound' or coalesce(s.source_type, 'inbound') = 'outbound_scraped' then
            v_owner_type := 'sdr';
            v_routing_reason := 'outbound_sql_to_sdr';
        elsif v_segment = 'enterprise' and coalesce(v_intent, 'low') = 'high' then
            v_owner_type := 'ae';
            v_routing_reason := 'enterprise_high_intent_sql';
        elsif v_priority_tier = 'urgent' and coalesce(v_intent, 'low') = 'high' then
            v_owner_type := 'ae';
            v_routing_reason := 'urgent_high_intent_sql';
        else
            v_owner_type := 'sdr';
            v_routing_reason := 'default_sql_to_sdr';
        end if;
    end if;

    select *
    into v_existing
    from public.sales_assignments
    where sales_assignments.lead_id = p_lead_id;

    if found and v_existing.manual_override and not p_force_reassign then
        assignment_id := v_existing.id;
        lead_id := v_existing.lead_id;
        profile_id := v_existing.profile_id;
        account_id := v_existing.account_id;
        qualification_evaluation_id := v_existing.qualification_evaluation_id;
        current_rep_id := v_existing.current_rep_id;
        current_owner_type := v_existing.current_owner_type;
        routing_status := 'manually_overridden';
        routing_reason := coalesce(v_existing.manual_override_reason, v_existing.routing_reason);
        segment := v_existing.segment;
        geography := v_existing.geography;
        priority_tier := v_existing.priority_tier;
        priority_score := v_existing.priority_score;
        crm_sync_status := v_existing.crm_sync_status;
        slack_sync_status := v_existing.slack_sync_status;
        evaluated_at := now();
        return next;
        return;
    end if;

    if v_eligible and v_owner_type is not null then
        if v_existing.id is not null
           and not p_force_reassign
           and v_existing.current_rep_id is not null
           and v_existing.current_owner_type = v_owner_type then
            select rep.*
            into v_rep
            from public.sales_reps rep
            where rep.id = v_existing.current_rep_id
              and rep.active = true
              and rep.role = v_owner_type
              and coalesce(rep.region, 'global') in (v_geography, 'global')
              and coalesce(rep.segment, 'all') in (v_segment, 'all')
            limit 1;
        end if;

        if v_rep.id is null then
            select rep.*
            into v_rep
            from public.sales_reps rep
            left join lateral (
                select count(*)::integer as active_load
                from public.sales_assignments a
                where a.current_rep_id = rep.id
                  and a.routing_status in ('assigned', 'handoff_pending', 'handed_off', 'manually_overridden')
            ) load on true
            where rep.active = true
              and rep.role = v_owner_type
              and coalesce(rep.region, 'global') in (v_geography, 'global')
              and coalesce(rep.segment, 'all') in (v_segment, 'all')
              and coalesce(load.active_load, 0) < rep.capacity
            order by coalesce(load.active_load, 0) asc, rep.created_at asc, rep.rep_code asc
            limit 1;
        end if;

        if v_rep.id is null then
            v_routing_status := 'retry_required';
            v_routing_reason := 'no_available_rep';
            v_owner_type := null;
            v_handoff := false;
        elsif v_handoff then
            v_routing_status := case
                when v_existing.id is not null and v_existing.current_owner_type = 'sdr' and v_existing.current_rep_id is distinct from v_rep.id then 'handed_off'
                else 'assigned'
            end;
        else
            v_routing_status := 'assigned';
        end if;
    elsif v_eligible then
        v_routing_status := 'retry_required';
        v_routing_reason := 'routing_rule_missing_owner_type';
    else
        v_routing_status := 'unassigned';
    end if;

    if v_existing.id is not null
       and coalesce(v_existing.qualification_evaluation_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(s.qualification_evaluation_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and v_existing.current_rep_id is not distinct from v_rep.id
       and v_existing.current_owner_type is not distinct from v_owner_type
       and v_existing.routing_status = (
            case
                when v_existing.manual_override and not p_force_reassign then 'manually_overridden'
                else v_routing_status
            end
       )
       and v_existing.routing_reason = (
            case
                when v_existing.manual_override and not p_force_reassign then coalesce(v_existing.manual_override_reason, v_existing.routing_reason)
                else v_routing_reason
            end
       )
       and v_existing.manual_override = false then
        update public.sales_assignments
           set last_routed_at = now(),
               profile_id = s.profile_id,
               account_id = s.account_id,
               segment = v_segment,
               geography = v_geography,
               acquisition_channel = s.acquisition_channel,
               acquisition_source = s.acquisition_source,
               fit_score = v_fit,
               buying_intent = v_intent,
               mql_status = s.mql_status,
               sql_status = s.sql_status,
               priority_tier = v_priority_tier,
               priority_score = v_priority_score,
               eligible_for_sales = v_eligible,
               needs_ae_handoff = v_handoff
         where id = v_existing.id
         returning * into v_existing;

        assignment_id := v_existing.id;
        lead_id := v_existing.lead_id;
        profile_id := v_existing.profile_id;
        account_id := v_existing.account_id;
        qualification_evaluation_id := v_existing.qualification_evaluation_id;
        current_rep_id := v_existing.current_rep_id;
        current_owner_type := v_existing.current_owner_type;
        routing_status := v_existing.routing_status;
        routing_reason := v_existing.routing_reason;
        segment := v_existing.segment;
        geography := v_existing.geography;
        priority_tier := v_existing.priority_tier;
        priority_score := v_existing.priority_score;
        crm_sync_status := v_existing.crm_sync_status;
        slack_sync_status := v_existing.slack_sync_status;
        evaluated_at := now();
        return next;
        return;
    end if;

    if v_existing.id is null then
        insert into public.sales_assignments (
            lead_id,
            profile_id,
            account_id,
            qualification_evaluation_id,
            current_rep_id,
            current_owner_type,
            segment,
            geography,
            acquisition_channel,
            acquisition_source,
            fit_score,
            buying_intent,
            mql_status,
            sql_status,
            priority_tier,
            priority_score,
            routing_status,
            routing_reason,
            routing_rule_version,
            eligible_for_sales,
            manual_override,
            needs_ae_handoff,
            crm_sync_status,
            slack_sync_status,
            retry_count,
            last_error,
            last_routed_at,
            assigned_at,
            handoff_at,
            last_synced_at
        ) values (
            p_lead_id,
            s.profile_id,
            s.account_id,
            s.qualification_evaluation_id,
            v_rep.id,
            v_owner_type,
            v_segment,
            v_geography,
            s.acquisition_channel,
            s.acquisition_source,
            v_fit,
            v_intent,
            s.mql_status,
            s.sql_status,
            v_priority_tier,
            v_priority_score,
            v_routing_status,
            v_routing_reason,
            'phase5_v1',
            v_eligible,
            false,
            v_handoff,
            case when v_eligible then 'pending' else 'not_applicable' end,
            case when v_eligible then 'pending' else 'not_applicable' end,
            case when v_routing_status = 'retry_required' then 1 else 0 end,
            case when v_routing_status = 'retry_required' then 'no_available_rep' else null end,
            now(),
            case when v_rep.id is not null then now() else null end,
            case when v_routing_status = 'handed_off' then now() else null end,
            v_last_sync
        )
        returning id into v_assignment_id;

        v_action_type := case
            when v_routing_status = 'retry_required' then 'retry_marked'
            when v_routing_status = 'handed_off' then 'handoff'
            when v_rep.id is not null then 'assigned'
            else 'routed'
        end;
    else
        v_action_type := case
            when v_existing.current_rep_id is distinct from v_rep.id and v_existing.current_rep_id is not null and v_rep.id is not null and v_routing_status = 'handed_off' then 'handoff'
            when v_existing.current_rep_id is distinct from v_rep.id and v_rep.id is not null then 'reassigned'
            when v_routing_status = 'retry_required' then 'retry_marked'
            else 'routed'
        end;

        update public.sales_assignments
           set profile_id = s.profile_id,
               account_id = s.account_id,
               qualification_evaluation_id = s.qualification_evaluation_id,
               current_rep_id = v_rep.id,
               current_owner_type = v_owner_type,
               segment = v_segment,
               geography = v_geography,
               acquisition_channel = s.acquisition_channel,
               acquisition_source = s.acquisition_source,
               fit_score = v_fit,
               buying_intent = v_intent,
               mql_status = s.mql_status,
               sql_status = s.sql_status,
               priority_tier = v_priority_tier,
               priority_score = v_priority_score,
               routing_status = v_routing_status,
               routing_reason = v_routing_reason,
               routing_rule_version = 'phase5_v1',
               eligible_for_sales = v_eligible,
               manual_override = false,
               manual_override_reason = null,
               needs_ae_handoff = v_handoff,
               crm_sync_status = case
                   when v_eligible then
                       case when v_existing.crm_sync_status = 'synced' then 'synced' else 'pending' end
                   else 'not_applicable'
               end,
               slack_sync_status = case
                   when v_eligible then
                       case when v_existing.slack_sync_status = 'synced' then 'synced' else 'pending' end
                   else 'not_applicable'
               end,
               retry_count = case
                   when v_routing_status = 'retry_required' then v_existing.retry_count + 1
                   else v_existing.retry_count
               end,
               last_error = case
                   when v_routing_status = 'retry_required' then 'no_available_rep'
                   else null
               end,
               last_routed_at = now(),
               assigned_at = case
                   when v_rep.id is not null and (v_existing.current_rep_id is distinct from v_rep.id or v_existing.assigned_at is null) then now()
                   else v_existing.assigned_at
               end,
               handoff_at = case
                   when v_routing_status = 'handed_off' then now()
                   else v_existing.handoff_at
               end
         where id = v_existing.id
         returning id into v_assignment_id;
    end if;

    insert into public.sales_assignment_history (
        assignment_id,
        lead_id,
        profile_id,
        account_id,
        action_type,
        from_rep_id,
        to_rep_id,
        from_owner_type,
        to_owner_type,
        from_status,
        to_status,
        reason,
        context
    ) values (
        v_assignment_id,
        p_lead_id,
        s.profile_id,
        s.account_id,
        v_action_type,
        v_existing.current_rep_id,
        v_rep.id,
        v_existing.current_owner_type,
        v_owner_type,
        v_existing.routing_status,
        v_routing_status,
        v_routing_reason,
        jsonb_strip_nulls(jsonb_build_object(
            'trigger', p_trigger,
            'qualification_evaluation_id', s.qualification_evaluation_id,
            'priority_tier', v_priority_tier,
            'priority_score', v_priority_score,
            'sql_status', s.sql_status,
            'mql_status', s.mql_status,
            'segment', v_segment,
            'geography', v_geography,
            'acquisition_channel', s.acquisition_channel,
            'acquisition_source', s.acquisition_source,
            'needs_ae_handoff', v_handoff
        ))
    );

    select *
    into v_existing
    from public.sales_assignments
    where id = v_assignment_id;

    assignment_id := v_existing.id;
    lead_id := v_existing.lead_id;
    profile_id := v_existing.profile_id;
    account_id := v_existing.account_id;
    qualification_evaluation_id := v_existing.qualification_evaluation_id;
    current_rep_id := v_existing.current_rep_id;
    current_owner_type := v_existing.current_owner_type;
    routing_status := v_existing.routing_status;
    routing_reason := v_existing.routing_reason;
    segment := v_existing.segment;
    geography := v_existing.geography;
    priority_tier := v_existing.priority_tier;
    priority_score := v_existing.priority_score;
    crm_sync_status := v_existing.crm_sync_status;
    slack_sync_status := v_existing.slack_sync_status;
    evaluated_at := now();
    return next;
end;
$$;
grant execute on function public.route_lead_to_sales(bigint, text, boolean) to service_role;
create or replace function public.override_sales_assignment(
    p_lead_id bigint,
    p_rep_code text,
    p_reason text,
    p_force_owner_type text default null
) returns table (
    assignment_id uuid,
    lead_id bigint,
    current_rep_id uuid,
    current_owner_type text,
    routing_status text,
    routing_reason text,
    manual_override boolean,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_assignment public.sales_assignments%rowtype;
    v_rep public.sales_reps%rowtype;
    v_from_rep_id uuid;
    v_from_owner_type text;
    v_from_status text;
begin
    if p_rep_code is null or btrim(p_rep_code) = '' then
        raise exception 'invalid_rep_code';
    end if;

    if p_reason is null or btrim(p_reason) = '' then
        raise exception 'invalid_reason';
    end if;

    if p_force_owner_type is not null and p_force_owner_type not in ('sdr', 'ae') then
        raise exception 'invalid_owner_type';
    end if;

    select *
    into v_rep
    from public.sales_reps
    where rep_code = p_rep_code
      and active = true
    limit 1;

    if not found then
        raise exception 'rep_not_found';
    end if;

    select *
    into v_assignment
    from public.sales_assignments
    where sales_assignments.lead_id = p_lead_id;

    if not found then
        perform public.route_lead_to_sales(p_lead_id, 'manual_override_seed', true);

        select *
        into v_assignment
        from public.sales_assignments
        where sales_assignments.lead_id = p_lead_id;
    end if;

    v_from_rep_id := v_assignment.current_rep_id;
    v_from_owner_type := v_assignment.current_owner_type;
    v_from_status := v_assignment.routing_status;

    update public.sales_assignments
       set current_rep_id = v_rep.id,
           current_owner_type = coalesce(p_force_owner_type, v_rep.role),
           routing_status = 'manually_overridden',
           routing_reason = p_reason,
           manual_override = true,
           manual_override_reason = p_reason,
           eligible_for_sales = true,
           needs_ae_handoff = coalesce(p_force_owner_type, v_rep.role) = 'ae' and coalesce(v_from_owner_type, '') = 'sdr',
           assigned_at = now(),
           handoff_at = case when coalesce(v_from_owner_type, '') = 'sdr' and coalesce(p_force_owner_type, v_rep.role) = 'ae' then now() else public.sales_assignments.handoff_at end,
           last_routed_at = now()
     where public.sales_assignments.lead_id = p_lead_id
     returning * into v_assignment;

    insert into public.sales_assignment_history (
        assignment_id,
        lead_id,
        profile_id,
        account_id,
        action_type,
        from_rep_id,
        to_rep_id,
        from_owner_type,
        to_owner_type,
        from_status,
        to_status,
        reason,
        context
    ) values (
        v_assignment.id,
        v_assignment.lead_id,
        v_assignment.profile_id,
        v_assignment.account_id,
        'manual_override',
        v_from_rep_id,
        v_rep.id,
        v_from_owner_type,
        coalesce(p_force_owner_type, v_rep.role),
        v_from_status,
        'manually_overridden',
        p_reason,
        jsonb_build_object('rep_code', p_rep_code)
    );

    assignment_id := v_assignment.id;
    lead_id := v_assignment.lead_id;
    current_rep_id := v_assignment.current_rep_id;
    current_owner_type := v_assignment.current_owner_type;
    routing_status := v_assignment.routing_status;
    routing_reason := v_assignment.routing_reason;
    manual_override := v_assignment.manual_override;
    updated_at := v_assignment.updated_at;
    return next;
end;
$$;
grant execute on function public.override_sales_assignment(bigint, text, text, text) to service_role;
create or replace function public.update_sales_assignment_sync(
    p_lead_id bigint,
    p_crm_sync_status text default null,
    p_slack_sync_status text default null,
    p_last_error text default null,
    p_increment_retry boolean default false,
    p_reason text default 'sync_update'
) returns table (
    assignment_id uuid,
    lead_id bigint,
    routing_status text,
    crm_sync_status text,
    slack_sync_status text,
    retry_count integer,
    last_error text,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_assignment public.sales_assignments%rowtype;
    v_routing_status text;
begin
    if p_crm_sync_status is not null and p_crm_sync_status not in ('not_started', 'pending', 'synced', 'retry_required', 'failed', 'not_applicable') then
        raise exception 'invalid_crm_sync_status';
    end if;

    if p_slack_sync_status is not null and p_slack_sync_status not in ('not_started', 'pending', 'synced', 'retry_required', 'failed', 'not_applicable') then
        raise exception 'invalid_slack_sync_status';
    end if;

    select *
    into v_assignment
    from public.sales_assignments
    where sales_assignments.lead_id = p_lead_id;

    if not found then
        raise exception 'assignment_not_found';
    end if;

    v_routing_status := case
        when coalesce(p_crm_sync_status, v_assignment.crm_sync_status) in ('retry_required', 'failed')
          or coalesce(p_slack_sync_status, v_assignment.slack_sync_status) in ('retry_required', 'failed')
          then 'retry_required'
        else v_assignment.routing_status
    end;

    update public.sales_assignments
       set crm_sync_status = coalesce(p_crm_sync_status, public.sales_assignments.crm_sync_status),
           slack_sync_status = coalesce(p_slack_sync_status, public.sales_assignments.slack_sync_status),
           routing_status = v_routing_status,
           retry_count = case when p_increment_retry then public.sales_assignments.retry_count + 1 else public.sales_assignments.retry_count end,
           last_error = p_last_error,
           last_synced_at = now(),
           last_routed_at = now()
     where public.sales_assignments.lead_id = p_lead_id
     returning * into v_assignment;

    insert into public.sales_assignment_history (
        assignment_id,
        lead_id,
        profile_id,
        account_id,
        action_type,
        from_rep_id,
        to_rep_id,
        from_owner_type,
        to_owner_type,
        from_status,
        to_status,
        reason,
        context
    ) values (
        v_assignment.id,
        v_assignment.lead_id,
        v_assignment.profile_id,
        v_assignment.account_id,
        'sync_updated',
        v_assignment.current_rep_id,
        v_assignment.current_rep_id,
        v_assignment.current_owner_type,
        v_assignment.current_owner_type,
        null,
        v_assignment.routing_status,
        coalesce(p_reason, 'sync_update'),
        jsonb_strip_nulls(jsonb_build_object(
            'crm_sync_status', p_crm_sync_status,
            'slack_sync_status', p_slack_sync_status,
            'last_error', p_last_error,
            'increment_retry', p_increment_retry
        ))
    );

    assignment_id := v_assignment.id;
    lead_id := v_assignment.lead_id;
    routing_status := v_assignment.routing_status;
    crm_sync_status := v_assignment.crm_sync_status;
    slack_sync_status := v_assignment.slack_sync_status;
    retry_count := v_assignment.retry_count;
    last_error := v_assignment.last_error;
    updated_at := v_assignment.updated_at;
    return next;
end;
$$;
grant execute on function public.update_sales_assignment_sync(bigint, text, text, text, boolean, text) to service_role;
create or replace view public.current_sales_queue as
select
    a.id as assignment_id,
    a.lead_id,
    a.profile_id,
    a.account_id,
    s.lead_email,
    s.company_name,
    s.account_name,
    s.source_type,
    s.acquisition_channel,
    s.acquisition_source,
    s.fit_score,
    s.qualification_buying_intent as buying_intent,
    s.mql_status,
    s.sql_status,
    s.priority_tier,
    s.priority_score,
    a.segment,
    a.geography,
    a.current_owner_type,
    a.current_rep_id,
    rep.rep_code,
    rep.full_name as rep_name,
    a.routing_status,
    a.routing_reason,
    a.manual_override,
    a.manual_override_reason,
    a.needs_ae_handoff,
    a.crm_sync_status,
    a.slack_sync_status,
    coalesce(
        s.last_reply_received_at,
        s.last_outreach_sent_at,
        s.last_lead_event_at,
        s.last_product_event_at,
        s.qualification_evaluated_at,
        s.onboarding_completed_at,
        s.lead_created_at
    ) as last_interaction_at,
    greatest(
        extract(epoch from (now() - coalesce(a.assigned_at, a.last_routed_at, s.qualification_evaluated_at, s.lead_created_at))) / 3600.0,
        0
    ) as aging_hours,
    case
        when a.routing_status = 'retry_required' then 'retry_sales_sync'
        when a.current_owner_type = 'ae' and (coalesce(s.outreach_deal_count, 0) > 0 or coalesce(s.outreach_reply_count, 0) > 0) then 'advance_deal'
        when a.needs_ae_handoff then 'handoff_to_ae'
        when a.current_owner_type = 'sdr' and coalesce(s.acquisition_channel, '') = 'outbound' and coalesce(s.outreach_sent_count, 0) = 0 then 'send_outreach'
        when a.current_owner_type = 'sdr' and coalesce(s.acquisition_channel, '') in ('inbound', 'partner', 'creator', 'referral', 'plg') then 'qualify_and_contact'
        when a.routing_status = 'unassigned' and a.eligible_for_sales then 'assign_rep'
        else 'review'
    end as next_action,
    case
        when coalesce(s.outreach_deal_count, 0) > 0 then 'deal_created'
        when coalesce(s.outreach_reply_count, 0) > 0 then 'reply_received'
        when coalesce(s.outreach_sent_count, 0) > 0 then 'outreach_sent'
        else 'no_deal'
    end as deal_state,
    a.assigned_at,
    a.handoff_at,
    a.last_routed_at
from public.sales_assignments a
join public.sales_routing_signal_assembly s
    on s.lead_id = a.lead_id
left join public.sales_reps rep
    on rep.id = a.current_rep_id
where a.eligible_for_sales = true;
create or replace view public.sdr_sales_queue as
select *
from public.current_sales_queue
where current_owner_type = 'sdr'
  and routing_status in ('assigned', 'manually_overridden', 'handoff_pending', 'handed_off');
create or replace view public.ae_sales_queue as
select *
from public.current_sales_queue
where current_owner_type = 'ae'
  and routing_status in ('assigned', 'manually_overridden', 'handoff_pending', 'handed_off');
create or replace view public.unassigned_sales_queue as
select *
from public.current_sales_queue
where current_rep_id is null
   or routing_status in ('unassigned', 'retry_required');
create or replace view public.hot_sales_leads as
select *
from public.current_sales_queue
where sql_status = 'sales_ready'
  and priority_tier in ('urgent', 'high')
order by priority_score desc, assigned_at asc nulls first, last_routed_at desc;
create or replace view public.sales_handoff_queue as
select *
from public.current_sales_queue
where needs_ae_handoff = true
   or routing_status in ('handoff_pending', 'handed_off');
grant select on public.current_sales_queue to service_role;
grant select on public.sdr_sales_queue to service_role;
grant select on public.ae_sales_queue to service_role;
grant select on public.unassigned_sales_queue to service_role;
grant select on public.hot_sales_leads to service_role;
grant select on public.sales_handoff_queue to service_role;
