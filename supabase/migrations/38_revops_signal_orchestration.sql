-- ============================================
-- CostPilot Phase 7 — Closed-loop RevOps signal orchestration
-- ============================================
-- Adds an idempotent account-level action queue derived from the existing
-- product/lifecycle intelligence layer. This does not replace lead scoring,
-- sales routing, HubSpot sync, Slack, Retool, or product events.

create extension if not exists pgcrypto;
create table if not exists public.revops_signals (
    id                    uuid primary key default gen_random_uuid(),
    signal_key            text not null unique,
    account_id            uuid not null references public.accounts (id) on delete cascade,
    lead_id               bigint references public.staged_leads (id) on delete set null,
    signal_type           text not null,
    priority              text not null,
    source                text not null default 'lifecycle_engine',
    status                text not null default 'pending',
    owner_type            text,
    sales_rep_id          uuid references public.sales_reps (id) on delete set null,
    internal_team_id      uuid references public.internal_team (id) on delete set null,
    hubspot_contact_id    text,
    hubspot_company_id    text,
    hubspot_deal_id       text,
    slack_notified_at     timestamptz,
    processed_at          timestamptz,
    outcome_status        text,
    outcome_notes         text,
    workflow_execution_id text,
    context               jsonb not null default '{}'::jsonb,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    constraint revops_signals_signal_key_nonempty_check
        check (length(btrim(signal_key)) > 0),
    constraint revops_signals_signal_type_check
        check (signal_type in (
            'PQL_REACHED',
            'EXPANSION_CANDIDATE',
            'ACCOUNT_AT_RISK',
            'HIGH_CHURN_RISK',
            'UPGRADE_INTENT',
            'BUDGET_PRESSURE',
            'ALLOWANCE_PRESSURE',
            'SIGNIFICANT_USAGE_GROWTH',
            'MEANINGFUL_INACTIVITY',
            'SUBSCRIPTION_ACTIVATED'
        )),
    constraint revops_signals_priority_check
        check (priority in ('low', 'medium', 'high', 'urgent')),
    constraint revops_signals_status_check
        check (status in ('pending', 'processing', 'completed', 'failed', 'dismissed')),
    constraint revops_signals_owner_type_check
        check (owner_type is null or owner_type in ('sdr', 'ae', 'cs', 'revops', 'founder')),
    constraint revops_signals_outcome_status_check
        check (outcome_status is null or outcome_status in ('created', 'notified', 'routed', 'previewed', 'no_action', 'error')),
    constraint revops_signals_context_object_check
        check (jsonb_typeof(context) = 'object')
);
create index if not exists revops_signals_account_status_idx
    on public.revops_signals (account_id, status, priority, created_at desc);
create index if not exists revops_signals_type_status_idx
    on public.revops_signals (signal_type, status, created_at desc);
create index if not exists revops_signals_owner_idx
    on public.revops_signals (owner_type, sales_rep_id, status, created_at desc);
drop trigger if exists revops_signals_set_updated_at on public.revops_signals;
create trigger revops_signals_set_updated_at
    before update on public.revops_signals
    for each row
    execute function public.set_updated_at();
alter table public.revops_signals enable row level security;
drop policy if exists "service_role_all_revops_signals" on public.revops_signals;
create policy "service_role_all_revops_signals"
    on public.revops_signals
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.revops_signals to service_role;
create or replace function public.revops_signal_priority(p_signal_type text)
returns text
language sql
immutable
as $$
    select case
        when p_signal_type in ('ACCOUNT_AT_RISK', 'HIGH_CHURN_RISK', 'BUDGET_PRESSURE') then 'urgent'
        when p_signal_type in ('PQL_REACHED', 'EXPANSION_CANDIDATE', 'UPGRADE_INTENT', 'ALLOWANCE_PRESSURE', 'SIGNIFICANT_USAGE_GROWTH') then 'high'
        when p_signal_type in ('SUBSCRIPTION_ACTIVATED', 'MEANINGFUL_INACTIVITY') then 'medium'
        else 'low'
    end
$$;
grant execute on function public.revops_signal_priority(text) to service_role;
create or replace function public.revops_signal_owner_type(p_signal_type text)
returns text
language sql
immutable
as $$
    select case
        when p_signal_type in ('PQL_REACHED', 'UPGRADE_INTENT') then 'sdr'
        when p_signal_type in ('EXPANSION_CANDIDATE', 'SIGNIFICANT_USAGE_GROWTH') then 'ae'
        when p_signal_type in ('ACCOUNT_AT_RISK', 'HIGH_CHURN_RISK', 'MEANINGFUL_INACTIVITY') then 'cs'
        when p_signal_type in ('BUDGET_PRESSURE', 'ALLOWANCE_PRESSURE') then 'revops'
        when p_signal_type = 'SUBSCRIPTION_ACTIVATED' then 'founder'
        else null
    end
$$;
grant execute on function public.revops_signal_owner_type(text) to service_role;
create or replace function public.resolve_revops_owner(p_owner_type text)
returns table (
    sales_rep_id uuid,
    internal_team_id uuid
)
language sql
stable
as $$
    select
        sr.id as sales_rep_id,
        it.id as internal_team_id
    from public.internal_team it
    left join public.sales_reps sr
        on sr.id = it.sales_rep_id
    where it.active = true
      and (
          (p_owner_type = 'sdr' and it.team_code = 'priya_shah')
          or (p_owner_type = 'ae' and it.team_code = 'daniel_lee')
          or (p_owner_type = 'cs' and it.team_code = 'marcus_reed')
          or (p_owner_type = 'revops' and it.team_code = 'sofia_chen')
          or (p_owner_type = 'founder' and it.team_code = 'aisha_khan')
      )
    order by it.team_code
    limit 1
$$;
grant execute on function public.resolve_revops_owner(text) to service_role;
create or replace function public.upsert_revops_signal(
    p_signal_key text,
    p_account_id uuid,
    p_lead_id bigint,
    p_signal_type text,
    p_source text,
    p_context jsonb
)
returns table (
    id uuid,
    signal_key text,
    signal_type text,
    status text,
    priority text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner_type text := public.revops_signal_owner_type(p_signal_type);
    v_owner record;
begin
    if p_account_id is null then
        raise exception 'p_account_id is required';
    end if;

    select *
    into v_owner
    from public.resolve_revops_owner(v_owner_type);

    return query
    insert into public.revops_signals (
        signal_key,
        account_id,
        lead_id,
        signal_type,
        priority,
        source,
        status,
        owner_type,
        sales_rep_id,
        internal_team_id,
        context
    ) values (
        p_signal_key,
        p_account_id,
        p_lead_id,
        p_signal_type,
        public.revops_signal_priority(p_signal_type),
        coalesce(nullif(btrim(p_source), ''), 'lifecycle_engine'),
        'pending',
        v_owner_type,
        v_owner.sales_rep_id,
        v_owner.internal_team_id,
        coalesce(p_context, '{}'::jsonb)
    )
    on conflict (signal_key) do update
    set
        lead_id = coalesce(excluded.lead_id, public.revops_signals.lead_id),
        priority = excluded.priority,
        source = excluded.source,
        owner_type = excluded.owner_type,
        sales_rep_id = excluded.sales_rep_id,
        internal_team_id = excluded.internal_team_id,
        context = excluded.context,
        updated_at = now()
    where public.revops_signals.status in ('pending', 'processing', 'failed')
    returning
        public.revops_signals.id,
        public.revops_signals.signal_key,
        public.revops_signals.signal_type,
        public.revops_signals.status,
        public.revops_signals.priority;
end;
$$;
grant execute on function public.upsert_revops_signal(text, uuid, bigint, text, text, jsonb) to service_role;
create or replace function public.generate_revops_signals(
    p_account_id uuid default null,
    p_source text default 'lifecycle_engine'
)
returns table (
    id uuid,
    signal_key text,
    account_id uuid,
    signal_type text,
    status text,
    priority text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    rec record;
    limit_rec record;
    v_month text := to_char(date_trunc('month', now()), 'YYYY-MM');
    v_signal record;
    v_limit_usage numeric(18, 6);
    v_limit_percent numeric(18, 2);
begin
    for rec in
        select
            s.*,
            h.health_score,
            h.health_state,
            h.lifecycle_state,
            h.churn_risk,
            h.expansion_score,
            h.expansion_state,
            h.recommended_action,
            h.recommended_lead_id,
            h.recommended_owner_type,
            h.needs_intervention,
            b.projected_budget_used_percentage
        from public.account_health_signal_assembly s
        left join public.current_customer_health h
            on h.account_id = s.account_id
        left join public.account_budget_status_current_month b
            on b.account_id = s.account_id
        where p_account_id is null or s.account_id = p_account_id
    loop
        if coalesce(rec.activated, false) and coalesce(rec.activation_score, 0) >= 80 then
            select * into v_signal from public.upsert_revops_signal(
                'account:' || rec.account_id::text || ':PQL_REACHED:v1',
                rec.account_id,
                rec.top_lead_id,
                'PQL_REACHED',
                p_source,
                jsonb_build_object(
                    'activation_score', rec.activation_score,
                    'activated_at', rec.activated_at,
                    'provider_connected', rec.provider_connected,
                    'usage_synced', rec.usage_synced,
                    'insight_generated', rec.insight_generated,
                    'reason', 'Existing activation view reached the PQL threshold.'
                )
            );
            if v_signal.id is not null then
                id := v_signal.id; signal_key := v_signal.signal_key; account_id := rec.account_id; signal_type := v_signal.signal_type; status := v_signal.status; priority := v_signal.priority; return next;
            end if;
        end if;

        if rec.expansion_state in ('expansion_candidate', 'upgrade_ready', 'sales_followup') then
            select * into v_signal from public.upsert_revops_signal(
                'account:' || rec.account_id::text || ':EXPANSION_CANDIDATE:' || rec.expansion_state || ':v1',
                rec.account_id,
                coalesce(rec.recommended_lead_id, rec.top_lead_id),
                'EXPANSION_CANDIDATE',
                p_source,
                jsonb_build_object(
                    'expansion_state', rec.expansion_state,
                    'expansion_score', rec.expansion_score,
                    'recommended_action', rec.recommended_action,
                    'current_month_spend', rec.current_month_spend,
                    'spend_growth_percentage', rec.spend_growth_percentage,
                    'reason', 'Existing customer health engine identified expansion readiness.'
                )
            );
            if v_signal.id is not null then
                id := v_signal.id; signal_key := v_signal.signal_key; account_id := rec.account_id; signal_type := v_signal.signal_type; status := v_signal.status; priority := v_signal.priority; return next;
            end if;
        end if;

        if rec.health_state in ('at_risk', 'critical') then
            select * into v_signal from public.upsert_revops_signal(
                'account:' || rec.account_id::text || ':ACCOUNT_AT_RISK:' || rec.health_state || ':v1',
                rec.account_id,
                rec.top_lead_id,
                'ACCOUNT_AT_RISK',
                p_source,
                jsonb_build_object(
                    'health_state', rec.health_state,
                    'health_score', rec.health_score,
                    'recommended_action', rec.recommended_action,
                    'reason', 'Existing customer health engine marked this account at risk.'
                )
            );
            if v_signal.id is not null then
                id := v_signal.id; signal_key := v_signal.signal_key; account_id := rec.account_id; signal_type := v_signal.signal_type; status := v_signal.status; priority := v_signal.priority; return next;
            end if;
        end if;

        if rec.churn_risk in ('high', 'critical') then
            select * into v_signal from public.upsert_revops_signal(
                'account:' || rec.account_id::text || ':HIGH_CHURN_RISK:' || rec.churn_risk || ':v1',
                rec.account_id,
                rec.top_lead_id,
                'HIGH_CHURN_RISK',
                p_source,
                jsonb_build_object(
                    'churn_risk', rec.churn_risk,
                    'health_state', rec.health_state,
                    'health_score', rec.health_score,
                    'reason', 'Existing customer health engine identified high churn risk.'
                )
            );
            if v_signal.id is not null then
                id := v_signal.id; signal_key := v_signal.signal_key; account_id := rec.account_id; signal_type := v_signal.signal_type; status := v_signal.status; priority := v_signal.priority; return next;
            end if;
        end if;

        if coalesce(rec.upgrade_requested_count_30d, 0) > 0 then
            select * into v_signal from public.upsert_revops_signal(
                'account:' || rec.account_id::text || ':UPGRADE_INTENT:' || v_month,
                rec.account_id,
                rec.top_lead_id,
                'UPGRADE_INTENT',
                p_source,
                jsonb_build_object(
                    'upgrade_requested_count_30d', rec.upgrade_requested_count_30d,
                    'current_plan_id', rec.current_plan_id,
                    'reason', 'Existing product events show upgrade intent in the last 30 days.'
                )
            );
            if v_signal.id is not null then
                id := v_signal.id; signal_key := v_signal.signal_key; account_id := rec.account_id; signal_type := v_signal.signal_type; status := v_signal.status; priority := v_signal.priority; return next;
            end if;
        end if;

        if coalesce(rec.projected_overrun, false)
            or coalesce(rec.projected_budget_used_percentage, 0) >= coalesce(rec.threshold_percentage, 80) then
            select * into v_signal from public.upsert_revops_signal(
                'account:' || rec.account_id::text || ':BUDGET_PRESSURE:' || v_month,
                rec.account_id,
                rec.top_lead_id,
                'BUDGET_PRESSURE',
                p_source,
                jsonb_build_object(
                    'budget_amount', rec.budget_amount,
                    'current_month_spend', rec.current_month_spend,
                    'projected_month_end_spend', rec.projected_month_end_spend,
                    'projected_overrun', rec.projected_overrun,
                    'projected_budget_used_percentage', rec.projected_budget_used_percentage,
                    'threshold_percentage', rec.threshold_percentage,
                    'reason', 'Existing budget view shows threshold or projected-overrun pressure.'
                )
            );
            if v_signal.id is not null then
                id := v_signal.id; signal_key := v_signal.signal_key; account_id := rec.account_id; signal_type := v_signal.signal_type; status := v_signal.status; priority := v_signal.priority; return next;
            end if;
        end if;

        if rec.spend_growth_percentage is not null and rec.spend_growth_percentage >= 20 then
            select * into v_signal from public.upsert_revops_signal(
                'account:' || rec.account_id::text || ':SIGNIFICANT_USAGE_GROWTH:' || v_month,
                rec.account_id,
                rec.top_lead_id,
                'SIGNIFICANT_USAGE_GROWTH',
                p_source,
                jsonb_build_object(
                    'current_month_spend', rec.current_month_spend,
                    'spend_growth_percentage', rec.spend_growth_percentage,
                    'reason', 'Existing health signal assembly shows meaningful spend growth.'
                )
            );
            if v_signal.id is not null then
                id := v_signal.id; signal_key := v_signal.signal_key; account_id := rec.account_id; signal_type := v_signal.signal_type; status := v_signal.status; priority := v_signal.priority; return next;
            end if;
        end if;

        if coalesce(rec.days_since_last_usage, 0) >= 14
            or coalesce(rec.days_since_last_product_event, 0) >= 14 then
            select * into v_signal from public.upsert_revops_signal(
                'account:' || rec.account_id::text || ':MEANINGFUL_INACTIVITY:' || v_month,
                rec.account_id,
                rec.top_lead_id,
                'MEANINGFUL_INACTIVITY',
                p_source,
                jsonb_build_object(
                    'days_since_last_usage', rec.days_since_last_usage,
                    'days_since_last_product_event', rec.days_since_last_product_event,
                    'reason', 'Existing lifecycle signals show meaningful inactivity.'
                )
            );
            if v_signal.id is not null then
                id := v_signal.id; signal_key := v_signal.signal_key; account_id := rec.account_id; signal_type := v_signal.signal_type; status := v_signal.status; priority := v_signal.priority; return next;
            end if;
        end if;

        if rec.plan_status = 'active' and rec.current_plan_id is not null then
            select * into v_signal from public.upsert_revops_signal(
                'account:' || rec.account_id::text || ':SUBSCRIPTION_ACTIVATED:' || rec.current_plan_id || ':v1',
                rec.account_id,
                rec.top_lead_id,
                'SUBSCRIPTION_ACTIVATED',
                p_source,
                jsonb_build_object(
                    'current_plan_id', rec.current_plan_id,
                    'plan_status', rec.plan_status,
                    'reason', 'Existing account plan state shows an active subscription.'
                )
            );
            if v_signal.id is not null then
                id := v_signal.id; signal_key := v_signal.signal_key; account_id := rec.account_id; signal_type := v_signal.signal_type; status := v_signal.status; priority := v_signal.priority; return next;
            end if;
        end if;
    end loop;

    for limit_rec in
        with usage_window as (
            select
                pul.id as limit_id,
                pul.account_id,
                pul.provider_connection_id,
                pul.limit_type,
                pul.limit_amount,
                pul.limit_period,
                pul.threshold_percentage,
                pc.provider,
                coalesce(sum(
                    case
                        when pul.limit_type = 'cost_credits' then ur.calculated_cost
                        when pul.limit_type = 'tokens' and ur.usage_unit = 'tokens' then ur.usage_quantity
                        when pul.limit_type = 'requests' and ur.usage_unit = 'requests' then ur.usage_quantity
                        else 0
                    end
                ), 0) as used_amount
            from public.provider_usage_limits pul
            inner join public.provider_connections pc
                on pc.id = pul.provider_connection_id
            left join public.usage_records ur
                on ur.provider_connection_id = pul.provider_connection_id
               and ur.account_id = pul.account_id
               and ur.usage_at >= case
                    when pul.limit_period = 'daily' then date_trunc('day', now())
                    when pul.limit_period = 'weekly' then date_trunc('week', now())
                    else date_trunc('month', now())
               end
            where pul.enabled = true
              and (p_account_id is null or pul.account_id = p_account_id)
            group by pul.id, pul.account_id, pul.provider_connection_id, pul.limit_type, pul.limit_amount, pul.limit_period, pul.threshold_percentage, pc.provider
        )
        select *
        from usage_window
        where limit_amount > 0
          and ((used_amount / limit_amount) * 100) >= threshold_percentage
    loop
        v_limit_usage := limit_rec.used_amount;
        v_limit_percent := round((limit_rec.used_amount / limit_rec.limit_amount) * 100, 2);

        select * into v_signal from public.upsert_revops_signal(
            'account:' || limit_rec.account_id::text || ':ALLOWANCE_PRESSURE:' || limit_rec.limit_id::text || ':' || v_month,
            limit_rec.account_id,
            null,
            'ALLOWANCE_PRESSURE',
            p_source,
            jsonb_build_object(
                'provider', limit_rec.provider,
                'limit_type', limit_rec.limit_type,
                'limit_period', limit_rec.limit_period,
                'limit_amount', limit_rec.limit_amount,
                'used_amount', v_limit_usage,
                'used_percentage', v_limit_percent,
                'threshold_percentage', limit_rec.threshold_percentage,
                'reason', 'Existing provider allowance rule crossed its configured threshold.'
            )
        );
        if v_signal.id is not null then
            id := v_signal.id; signal_key := v_signal.signal_key; account_id := limit_rec.account_id; signal_type := v_signal.signal_type; status := v_signal.status; priority := v_signal.priority; return next;
        end if;
    end loop;
end;
$$;
grant execute on function public.generate_revops_signals(uuid, text) to service_role;
create or replace function public.record_revops_signal_outcome(
    p_signal_key text,
    p_status text,
    p_outcome_status text default null,
    p_outcome_notes text default null,
    p_workflow_execution_id text default null,
    p_hubspot_contact_id text default null,
    p_hubspot_company_id text default null,
    p_hubspot_deal_id text default null,
    p_slack_notified boolean default false
)
returns table (
    id uuid,
    signal_key text,
    status text,
    outcome_status text,
    processed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_status not in ('pending', 'processing', 'completed', 'failed', 'dismissed') then
        raise exception 'unsupported revops signal status: %', p_status;
    end if;

    return query
    update public.revops_signals rs
    set
        status = p_status,
        outcome_status = p_outcome_status,
        outcome_notes = p_outcome_notes,
        workflow_execution_id = p_workflow_execution_id,
        hubspot_contact_id = coalesce(p_hubspot_contact_id, rs.hubspot_contact_id),
        hubspot_company_id = coalesce(p_hubspot_company_id, rs.hubspot_company_id),
        hubspot_deal_id = coalesce(p_hubspot_deal_id, rs.hubspot_deal_id),
        slack_notified_at = case
            when p_slack_notified then coalesce(rs.slack_notified_at, now())
            else rs.slack_notified_at
        end,
        processed_at = case
            when p_status in ('completed', 'failed', 'dismissed') then now()
            else rs.processed_at
        end,
        updated_at = now()
    where rs.signal_key = p_signal_key
    returning rs.id, rs.signal_key, rs.status, rs.outcome_status, rs.processed_at;
end;
$$;
grant execute on function public.record_revops_signal_outcome(text, text, text, text, text, text, text, text, boolean) to service_role;
create or replace view public.revops_signal_queue as
select
    rs.id,
    rs.signal_key,
    rs.signal_type,
    rs.priority,
    rs.status,
    rs.source,
    rs.account_id,
    a.name as account_name,
    a.slug as account_slug,
    a.primary_domain,
    rs.lead_id,
    sl.email as lead_email,
    sl.company_name as lead_company_name,
    rs.owner_type,
    rs.sales_rep_id,
    sr.full_name as sales_rep_name,
    rs.internal_team_id,
    it.full_name as internal_owner_name,
    it.job_title as internal_owner_title,
    rs.hubspot_contact_id,
    rs.hubspot_company_id,
    rs.hubspot_deal_id,
    rs.slack_notified_at,
    rs.processed_at,
    rs.outcome_status,
    rs.outcome_notes,
    rs.workflow_execution_id,
    rs.context,
    rs.created_at,
    rs.updated_at
from public.revops_signals rs
inner join public.accounts a
    on a.id = rs.account_id
left join public.staged_leads sl
    on sl.id = rs.lead_id
left join public.sales_reps sr
    on sr.id = rs.sales_rep_id
left join public.internal_team it
    on it.id = rs.internal_team_id;
grant select on public.revops_signal_queue to service_role;
