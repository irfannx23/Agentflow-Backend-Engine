-- Phase 7 — Retention + Expansion
-- Builds one canonical account-centric health, churn-risk, and expansion layer
-- on top of the existing Phase 4 qualification, Phase 5 sales routing, and
-- Phase 6 product-intelligence + billing systems.

alter table public.account_plans
    add column if not exists cancellation_requested_at timestamptz,
    add column if not exists cancelled_at timestamptz,
    add column if not exists cancellation_reason text;
alter table public.account_plans
    drop constraint if exists account_plans_cancellation_timeline_check;
alter table public.account_plans
    add constraint account_plans_cancellation_timeline_check
        check (
            cancellation_requested_at is null
            or cancelled_at is null
            or cancelled_at >= cancellation_requested_at
        );
create table if not exists public.customer_health_evaluations (
    id                    uuid primary key default gen_random_uuid(),
    account_id            uuid not null references public.accounts (id) on delete cascade,
    evaluation_type       text not null default 'runtime',
    rule_version          text not null,
    health_score          integer not null,
    health_state          text not null,
    lifecycle_state       text not null,
    churn_risk            text not null,
    expansion_score       integer not null,
    expansion_state       text not null,
    adoption_component    integer not null,
    engagement_component  integer not null,
    value_component       integer not null,
    billing_component     integer not null,
    risk_penalty          integer not null,
    authoritative_churned boolean not null default false,
    needs_intervention    boolean not null default false,
    recommended_action    text not null,
    recommended_lead_id   bigint references public.staged_leads (id) on delete set null,
    recommended_owner_type text,
    reasons               jsonb not null default '{}'::jsonb,
    evaluation_fingerprint text not null,
    evaluated_at          timestamptz not null default now(),
    created_at            timestamptz not null default now(),
    constraint customer_health_evaluations_type_check
        check (evaluation_type in ('runtime', 'product_signal_refresh', 'billing_state_change', 'engagement_refresh', 'manual_review', 'synthetic_scenario', 'cancellation_state_change')),
    constraint customer_health_evaluations_health_score_check
        check (health_score between 0 and 100),
    constraint customer_health_evaluations_health_state_check
        check (health_state in ('healthy', 'watch', 'at_risk', 'critical')),
    constraint customer_health_evaluations_lifecycle_state_check
        check (lifecycle_state in ('new', 'onboarding', 'newly_activated', 'activated', 'low_adoption', 'dormant', 'churned')),
    constraint customer_health_evaluations_churn_risk_check
        check (churn_risk in ('low', 'medium', 'high', 'critical')),
    constraint customer_health_evaluations_expansion_state_check
        check (expansion_state in ('none', 'watch', 'expansion_candidate', 'upgrade_ready', 'sales_followup')),
    constraint customer_health_evaluations_owner_type_check
        check (recommended_owner_type is null or recommended_owner_type in ('sdr', 'ae')),
    constraint customer_health_evaluations_components_check
        check (
            adoption_component between 0 and 30
            and engagement_component between 0 and 20
            and value_component between 0 and 25
            and billing_component between 0 and 10
            and risk_penalty between 0 and 100
            and expansion_score between 0 and 100
        ),
    constraint customer_health_evaluations_reasons_object_check
        check (jsonb_typeof(reasons) = 'object')
);
create index if not exists customer_health_evaluations_account_eval_idx
    on public.customer_health_evaluations (account_id, evaluated_at desc);
create index if not exists customer_health_evaluations_state_idx
    on public.customer_health_evaluations (health_state, churn_risk, evaluated_at desc);
create index if not exists customer_health_evaluations_expansion_idx
    on public.customer_health_evaluations (expansion_state, evaluated_at desc);
alter table public.customer_health_evaluations enable row level security;
drop policy if exists "service_role_all_customer_health_evaluations" on public.customer_health_evaluations;
create policy "service_role_all_customer_health_evaluations"
    on public.customer_health_evaluations
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.customer_health_evaluations to service_role;
create or replace view public.account_health_signal_assembly as
with latest_onboarding as (
    select distinct on (o.account_id)
        o.account_id,
        o.company_size,
        o.providers,
        o.estimated_monthly_spend,
        o.completed_at
    from public.onboarding_responses o
    where o.account_id is not null
    order by o.account_id, o.updated_at desc, o.created_at desc
),
member_rollup as (
    select
        am.account_id,
        count(*)::integer as member_count,
        max(p.last_login_at) as last_login_at
    from public.account_members am
    inner join public.profiles p
        on p.id = am.profile_id
    group by am.account_id
),
event_rollup as (
    select
        pe.account_id,
        max(pe.created_at) as last_product_event_at,
        count(*)::integer as total_product_event_count,
        count(*) filter (where pe.created_at >= now() - interval '30 days')::integer as product_event_count_30d,
        count(*) filter (where pe.event_name = 'dashboard_viewed' and pe.created_at >= now() - interval '30 days')::integer as dashboard_view_count_30d,
        count(*) filter (where pe.event_name = 'forecast_viewed' and pe.created_at >= now() - interval '30 days')::integer as forecast_view_count_30d,
        count(*) filter (where pe.event_name = 'recommendation_viewed' and pe.created_at >= now() - interval '30 days')::integer as recommendation_view_count_30d,
        count(*) filter (where pe.event_name = 'insight_generated' and pe.created_at >= now() - interval '30 days')::integer as insight_generated_count_30d,
        count(*) filter (where pe.event_name = 'alert_triggered' and pe.created_at >= now() - interval '30 days')::integer as alert_triggered_count_30d,
        count(*) filter (where pe.event_name = 'plan_selected' and pe.created_at >= now() - interval '30 days')::integer as plan_selected_count_30d,
        count(*) filter (where pe.event_name = 'upgrade_requested' and pe.created_at >= now() - interval '30 days')::integer as upgrade_requested_count_30d,
        max(pe.created_at) filter (where pe.event_name = 'upgrade_requested') as last_upgrade_requested_at
    from public.product_events pe
    where pe.account_id is not null
    group by pe.account_id
),
provider_rollup as (
    select
        pc.account_id,
        count(*)::integer as provider_count,
        count(*) filter (where pc.connection_status = 'connected')::integer as connected_provider_count,
        count(*) filter (where pc.connection_status = 'error')::integer as provider_error_count,
        count(*) filter (where pc.connection_status = 'disconnected')::integer as provider_disconnected_count,
        max(pc.last_synced_at) as last_synced_at
    from public.provider_connections pc
    group by pc.account_id
),
usage_rollup as (
    select
        u.account_id,
        max(u.usage_at) as last_usage_at,
        count(*) filter (where u.usage_at >= now() - interval '30 days')::integer as usage_record_count_30d,
        count(*) filter (where u.usage_at >= now() - interval '30 days')::integer as trailing_30d_usage_count,
        sum(case when u.usage_at >= now() - interval '30 days' then u.calculated_cost else 0 end)::numeric(18, 2) as trailing_30d_spend,
        sum(case when u.usage_at >= now() - interval '60 days' and u.usage_at < now() - interval '30 days' then u.calculated_cost else 0 end)::numeric(18, 2) as prior_30d_spend,
        count(distinct concat_ws('::', u.provider, u.service_name, coalesce(u.model_name, ''))) filter (where u.usage_at >= now() - interval '30 days')::integer as active_service_count
    from public.usage_records u
    group by u.account_id
),
alert_rollup as (
    select
        pa.account_id,
        count(*) filter (where pa.status = 'open')::integer as open_alert_count,
        count(*) filter (where pa.status = 'open' and pa.severity = 'high')::integer as open_high_alert_count,
        count(*) filter (where pa.status = 'open' and pa.severity = 'critical')::integer as open_critical_alert_count,
        max(pa.triggered_at) filter (where pa.status = 'open') as last_open_alert_at
    from public.product_alerts pa
    group by pa.account_id
),
recommendation_rollup as (
    select
        cr.account_id,
        count(*) filter (where cr.status = 'open')::integer as open_recommendation_count,
        count(*) filter (where cr.status = 'applied')::integer as applied_recommendation_count,
        max(cr.generated_at) as last_recommendation_at
    from public.cost_recommendations cr
    group by cr.account_id
),
qualification_rollup as (
    select
        lcq.account_id,
        count(*)::integer as qualified_lead_count,
        count(*) filter (where lcq.sql_status = 'sales_ready')::integer as sales_ready_lead_count,
        count(*) filter (where lcq.pql_status = 'product_qualified')::integer as product_qualified_lead_count,
        count(*) filter (where lcq.pql_status = 'product_activated')::integer as product_activated_lead_count,
        max(lcq.priority_score)::integer as max_priority_score
    from public.lead_current_qualification lcq
    where lcq.account_id is not null
    group by lcq.account_id
),
top_lead as (
    select distinct on (lcq.account_id)
        lcq.account_id,
        lcq.lead_id as top_lead_id,
        lcq.priority_score as top_lead_priority_score,
        lcq.priority_tier as top_lead_priority_tier,
        lcq.sql_status as top_lead_sql_status,
        lcq.mql_status as top_lead_mql_status
    from public.lead_current_qualification lcq
    where lcq.account_id is not null
    order by lcq.account_id, lcq.priority_score desc, lcq.evaluated_at desc, lcq.lead_id desc
),
sales_rollup as (
    select
        sa.account_id,
        count(*) filter (where sa.eligible_for_sales = true)::integer as assigned_sales_lead_count,
        count(*) filter (where sa.current_owner_type = 'ae' and sa.eligible_for_sales = true)::integer as ae_owned_lead_count,
        count(*) filter (where sa.current_owner_type = 'sdr' and sa.eligible_for_sales = true)::integer as sdr_owned_lead_count,
        bool_or(sa.manual_override) as has_manual_sales_override,
        max(sa.last_routed_at) as latest_sales_routed_at
    from public.sales_assignments sa
    where sa.account_id is not null
    group by sa.account_id
),
latest_sales as (
    select distinct on (sa.account_id)
        sa.account_id,
        sa.current_owner_type as latest_sales_owner_type,
        sa.routing_status as latest_sales_routing_status,
        sa.current_rep_id as latest_sales_rep_id
    from public.sales_assignments sa
    where sa.account_id is not null
    order by sa.account_id, sa.last_routed_at desc nulls last, sa.updated_at desc, sa.id desc
),
latest_payment as (
    select distinct on (bt.account_id)
        bt.account_id,
        bt.payment_status as latest_payment_status,
        bt.verification_status as latest_verification_status,
        bt.verified_at as latest_verified_at
    from public.billing_transactions bt
    where bt.account_id is not null
    order by bt.account_id, bt.verified_at desc nulls last, bt.updated_at desc, bt.id desc
)
select
    a.id as account_id,
    a.name as account_name,
    a.onboarding_status,
    onboarding.company_size,
    onboarding.estimated_monthly_spend,
    member.member_count,
    member.last_login_at,
    events.last_product_event_at,
    coalesce(events.total_product_event_count, 0) as total_product_event_count,
    coalesce(events.product_event_count_30d, 0) as product_event_count_30d,
    coalesce(events.dashboard_view_count_30d, 0) as dashboard_view_count_30d,
    coalesce(events.forecast_view_count_30d, 0) as forecast_view_count_30d,
    coalesce(events.recommendation_view_count_30d, 0) as recommendation_view_count_30d,
    coalesce(events.insight_generated_count_30d, 0) as insight_generated_count_30d,
    coalesce(events.alert_triggered_count_30d, 0) as alert_triggered_count_30d,
    coalesce(events.plan_selected_count_30d, 0) as plan_selected_count_30d,
    coalesce(events.upgrade_requested_count_30d, 0) as upgrade_requested_count_30d,
    events.last_upgrade_requested_at,
    coalesce(provider.provider_count, 0) as provider_count,
    coalesce(provider.connected_provider_count, 0) as connected_provider_count,
    coalesce(provider.provider_error_count, 0) as provider_error_count,
    coalesce(provider.provider_disconnected_count, 0) as provider_disconnected_count,
    provider.last_synced_at,
    overview.current_month_spend,
    overview.projected_month_end_spend,
    overview.average_daily_spend,
    overview.last_7_day_spend,
    overview.prior_7_day_spend,
    overview.usage_record_count,
    overview.last_usage_at,
    coalesce(usage.trailing_30d_spend, 0)::numeric(18, 2) as trailing_30d_spend,
    coalesce(usage.prior_30d_spend, 0)::numeric(18, 2) as prior_30d_spend,
    coalesce(usage.trailing_30d_usage_count, 0) as trailing_30d_usage_count,
    coalesce(usage.active_service_count, 0) as active_service_count,
    case
        when coalesce(usage.prior_30d_spend, 0) = 0 then null
        else round(((coalesce(usage.trailing_30d_spend, 0) - coalesce(usage.prior_30d_spend, 0)) / usage.prior_30d_spend) * 100, 2)
    end as spend_growth_percentage,
    budget.budget_id,
    budget.budget_amount,
    budget.threshold_percentage,
    coalesce(budget.alerting_enabled, false) as budget_alerting_enabled,
    budget.budget_used_percentage,
    budget.projected_budget_used_percentage,
    budget.projected_budget_variance,
    coalesce(budget.projected_overrun, false) as projected_overrun,
    activation.provider_connected,
    activation.usage_synced,
    activation.insight_generated,
    activation.budget_created,
    activation.alert_configured,
    activation.activation_score,
    activation.activated,
    activation.activated_at,
    activation.latest_activation_signal_at,
    activation.time_to_value_hours,
    coalesce(alerts.open_alert_count, 0) as open_alert_count,
    coalesce(alerts.open_high_alert_count, 0) as open_high_alert_count,
    coalesce(alerts.open_critical_alert_count, 0) as open_critical_alert_count,
    alerts.last_open_alert_at,
    coalesce(recommendations.open_recommendation_count, 0) as open_recommendation_count,
    coalesce(recommendations.applied_recommendation_count, 0) as applied_recommendation_count,
    recommendations.last_recommendation_at,
    coalesce(plan.current_plan_id, 'starter') as current_plan_id,
    coalesce(plan.plan_status, 'active') as plan_status,
    coalesce(plan.billing_provider, 'payu') as billing_provider,
    coalesce(plan.billing_interval, 'monthly') as billing_interval,
    plan.latest_transaction_id,
    plan.activated_at as plan_activated_at,
    plan.expires_at,
    plan.cancellation_requested_at,
    plan.cancelled_at,
    plan.cancellation_reason,
    payments.latest_payment_status,
    payments.latest_verification_status,
    payments.latest_verified_at,
    coalesce(qualification.qualified_lead_count, 0) as qualified_lead_count,
    coalesce(qualification.sales_ready_lead_count, 0) as sales_ready_lead_count,
    coalesce(qualification.product_qualified_lead_count, 0) as product_qualified_lead_count,
    coalesce(qualification.product_activated_lead_count, 0) as product_activated_lead_count,
    coalesce(qualification.max_priority_score, 0) as max_priority_score,
    top_lead.top_lead_id,
    top_lead.top_lead_priority_score,
    top_lead.top_lead_priority_tier,
    top_lead.top_lead_sql_status,
    top_lead.top_lead_mql_status,
    coalesce(sales.assigned_sales_lead_count, 0) as assigned_sales_lead_count,
    coalesce(sales.ae_owned_lead_count, 0) as ae_owned_lead_count,
    coalesce(sales.sdr_owned_lead_count, 0) as sdr_owned_lead_count,
    coalesce(sales.has_manual_sales_override, false) as has_manual_sales_override,
    sales.latest_sales_routed_at,
    latest_sales.latest_sales_owner_type,
    latest_sales.latest_sales_routing_status,
    latest_sales.latest_sales_rep_id,
    case when member.last_login_at is null then null else greatest(floor(extract(epoch from (now() - member.last_login_at)) / 86400), 0)::integer end as days_since_last_login,
    case when events.last_product_event_at is null then null else greatest(floor(extract(epoch from (now() - events.last_product_event_at)) / 86400), 0)::integer end as days_since_last_product_event,
    case when overview.last_usage_at is null then null else greatest(floor(extract(epoch from (now() - overview.last_usage_at)) / 86400), 0)::integer end as days_since_last_usage,
    case when provider.last_synced_at is null then null else greatest(floor(extract(epoch from (now() - provider.last_synced_at)) / 86400), 0)::integer end as days_since_last_sync
from public.accounts a
left join latest_onboarding onboarding
    on onboarding.account_id = a.id
left join member_rollup member
    on member.account_id = a.id
left join event_rollup events
    on events.account_id = a.id
left join provider_rollup provider
    on provider.account_id = a.id
left join usage_rollup usage
    on usage.account_id = a.id
left join public.account_dashboard_overview overview
    on overview.account_id = a.id
left join public.account_budget_status_current_month budget
    on budget.account_id = a.id
left join public.account_activation_state activation
    on activation.account_id = a.id
left join alert_rollup alerts
    on alerts.account_id = a.id
left join recommendation_rollup recommendations
    on recommendations.account_id = a.id
left join public.account_plans plan
    on plan.account_id = a.id
left join latest_payment payments
    on payments.account_id = a.id
left join qualification_rollup qualification
    on qualification.account_id = a.id
left join top_lead
    on top_lead.account_id = a.id
left join sales_rollup sales
    on sales.account_id = a.id
left join latest_sales
    on latest_sales.account_id = a.id;
grant select on public.account_health_signal_assembly to service_role;
create or replace function public.evaluate_account_health(
    p_account_id uuid,
    p_evaluation_type text default 'runtime'
) returns table (
    evaluation_id uuid,
    account_id uuid,
    health_score integer,
    health_state text,
    lifecycle_state text,
    churn_risk text,
    expansion_score integer,
    expansion_state text,
    recommended_action text,
    recommended_lead_id bigint,
    recommended_owner_type text,
    authoritative_churned boolean,
    needs_intervention boolean,
    evaluated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    s public.account_health_signal_assembly%rowtype;
    latest public.customer_health_evaluations%rowtype;
    v_rule_version text := 'phase7_v1';
    v_adoption integer := 0;
    v_engagement integer := 0;
    v_value integer := 0;
    v_billing integer := 0;
    v_risk integer := 0;
    v_health_score integer := 0;
    v_health_state text := 'watch';
    v_lifecycle_state text := 'new';
    v_churn_risk text := 'low';
    v_expansion_score integer := 0;
    v_expansion_state text := 'none';
    v_authoritative_churned boolean := false;
    v_needs_intervention boolean := false;
    v_recommended_action text := 'monitor';
    v_recommended_lead_id bigint := null;
    v_recommended_owner_type text := null;
    v_health_reasons text[] := array[]::text[];
    v_churn_reasons text[] := array[]::text[];
    v_expansion_reasons text[] := array[]::text[];
    v_fingerprint text := '';
    v_reasons jsonb := '{}'::jsonb;
    v_evaluation_id uuid;
begin
    select *
    into s
    from public.account_health_signal_assembly
    where account_health_signal_assembly.account_id = p_account_id;

    if not found then
        raise exception 'account_not_found';
    end if;

    if p_evaluation_type not in ('runtime', 'product_signal_refresh', 'billing_state_change', 'engagement_refresh', 'manual_review', 'synthetic_scenario', 'cancellation_state_change') then
        raise exception 'invalid_evaluation_type';
    end if;

    v_authoritative_churned := s.cancelled_at is not null;

    v_adoption := v_adoption
        + case
            when coalesce(s.activation_score, 0) >= 80 then 18
            when coalesce(s.activation_score, 0) >= 60 then 14
            when coalesce(s.activation_score, 0) >= 40 then 8
            when coalesce(s.activation_score, 0) >= 20 then 4
            else 0
          end
        + case when coalesce(s.connected_provider_count, 0) >= 1 then 4 else 0 end
        + case
            when s.days_since_last_sync is not null and s.days_since_last_sync <= 7 then 4
            when s.days_since_last_sync is not null and s.days_since_last_sync <= 14 then 2
            else 0
          end
        + case when s.budget_id is not null or s.budget_amount is not null then 4 else 0 end;
    v_adoption := greatest(0, least(v_adoption, 30));

    v_engagement := v_engagement
        + case
            when s.days_since_last_login is not null and s.days_since_last_login <= 7 then 6
            when s.days_since_last_login is not null and s.days_since_last_login <= 14 then 4
            when s.days_since_last_login is not null and s.days_since_last_login <= 30 then 2
            else 0
          end
        + case
            when s.days_since_last_product_event is not null and s.days_since_last_product_event <= 7 then 6
            when s.days_since_last_product_event is not null and s.days_since_last_product_event <= 14 then 4
            when s.days_since_last_product_event is not null and s.days_since_last_product_event <= 30 then 2
            else 0
          end
        + case
            when coalesce(s.dashboard_view_count_30d, 0) >= 4 then 5
            when coalesce(s.dashboard_view_count_30d, 0) >= 1 then 3
            else 0
          end
        + case
            when coalesce(s.forecast_view_count_30d, 0) + coalesce(s.recommendation_view_count_30d, 0) > 0 then 3
            else 0
          end;
    v_engagement := greatest(0, least(v_engagement, 20));

    v_value := v_value
        + case
            when coalesce(s.current_month_spend, 0) > 0 or coalesce(s.trailing_30d_spend, 0) > 0 then 8
            else 0
          end
        + case
            when coalesce(s.insight_generated_count_30d, 0) > 0 or coalesce(s.open_recommendation_count, 0) > 0 then 6
            else 0
          end
        + case when s.budget_id is not null or s.budget_amount is not null then 4 else 0 end
        + case
            when coalesce(s.connected_provider_count, 0) >= 2 then 4
            when coalesce(s.connected_provider_count, 0) = 1 then 2
            else 0
          end
        + case
            when coalesce(s.active_service_count, 0) >= 3 then 3
            when coalesce(s.active_service_count, 0) >= 1 then 1
            else 0
          end;
    v_value := greatest(0, least(v_value, 25));

    v_billing := case
        when v_authoritative_churned then 0
        when coalesce(s.plan_status, 'active') = 'active' then 10
        when s.plan_status = 'pending_payment' then 6
        when s.plan_status = 'inactive' then 3
        when s.plan_status = 'failed_payment' then 0
        else 4
    end;

    if v_authoritative_churned then
        v_risk := v_risk + 40;
        v_churn_reasons := array_append(v_churn_reasons, 'Account has an authoritative cancellation state.');
    end if;

    if coalesce(s.connected_provider_count, 0) = 0 then
        v_risk := v_risk + 12;
        v_health_reasons := array_append(v_health_reasons, 'No connected provider is available for monitored spend.');
    end if;

    if s.days_since_last_usage is not null and s.days_since_last_usage >= 21 then
        v_risk := v_risk + 18;
        v_health_reasons := array_append(v_health_reasons, format('No usage was recorded for %s days.', s.days_since_last_usage));
        v_churn_reasons := array_append(v_churn_reasons, format('Usage has been inactive for %s days.', s.days_since_last_usage));
    elsif s.days_since_last_usage is not null and s.days_since_last_usage >= 14 then
        v_risk := v_risk + 10;
        v_health_reasons := array_append(v_health_reasons, format('Usage recency is weakening at %s days.', s.days_since_last_usage));
    elsif s.days_since_last_usage is not null and s.days_since_last_usage >= 7 then
        v_risk := v_risk + 4;
    end if;

    if s.days_since_last_sync is not null and s.days_since_last_sync >= 21 then
        v_risk := v_risk + 15;
        v_health_reasons := array_append(v_health_reasons, format('No provider sync completed for %s days.', s.days_since_last_sync));
        v_churn_reasons := array_append(v_churn_reasons, format('Provider sync recency is %s days old.', s.days_since_last_sync));
    elsif s.days_since_last_sync is not null and s.days_since_last_sync >= 14 then
        v_risk := v_risk + 8;
    elsif s.days_since_last_sync is not null and s.days_since_last_sync >= 7 then
        v_risk := v_risk + 3;
    end if;

    if s.days_since_last_product_event is not null and s.days_since_last_product_event >= 21 then
        v_risk := v_risk + 10;
        v_health_reasons := array_append(v_health_reasons, format('No recent product engagement was recorded for %s days.', s.days_since_last_product_event));
    elsif s.days_since_last_product_event is not null and s.days_since_last_product_event >= 14 then
        v_risk := v_risk + 6;
    end if;

    if coalesce(s.provider_error_count, 0) > 0 or coalesce(s.provider_disconnected_count, 0) > 0 then
        v_risk := v_risk + 10;
        v_health_reasons := array_append(v_health_reasons, 'One or more provider connections are disconnected or erroring.');
        v_churn_reasons := array_append(v_churn_reasons, 'Provider connectivity is degraded.');
    end if;

    if coalesce(s.open_critical_alert_count, 0) > 0 then
        v_risk := v_risk + 15;
        v_health_reasons := array_append(v_health_reasons, 'Open critical product alerts require intervention.');
    elsif coalesce(s.open_high_alert_count, 0) > 0 then
        v_risk := v_risk + 8;
        v_health_reasons := array_append(v_health_reasons, 'Open high-severity alerts are unresolved.');
    end if;

    if coalesce(s.plan_status, 'active') = 'failed_payment' or coalesce(s.latest_payment_status, '') = 'failed' then
        v_risk := v_risk + 25;
        v_health_reasons := array_append(v_health_reasons, 'Billing has a failed payment state.');
        v_churn_reasons := array_append(v_churn_reasons, 'Failed payment creates immediate retention risk.');
    end if;

    if coalesce(s.plan_status, 'active') = 'inactive' and s.expires_at is not null and s.expires_at < now() then
        v_risk := v_risk + 20;
        v_churn_reasons := array_append(v_churn_reasons, 'Plan is inactive and already expired.');
    end if;

    if s.spend_growth_percentage is not null and s.spend_growth_percentage <= -35 then
        v_risk := v_risk + 10;
        v_health_reasons := array_append(v_health_reasons, 'Observed spend declined ' || round(s.spend_growth_percentage, 2)::text || '% versus the prior 30 days.');
        v_churn_reasons := array_append(v_churn_reasons, 'Usage and spend are declining sharply.');
    elsif s.spend_growth_percentage is not null and s.spend_growth_percentage <= -20 then
        v_risk := v_risk + 6;
    end if;

    v_risk := greatest(0, least(v_risk, 100));
    v_health_score := greatest(0, least(v_adoption + v_engagement + v_value + v_billing - v_risk, 100));

    if v_authoritative_churned then
        v_lifecycle_state := 'churned';
    elsif coalesce(s.activation_score, 0) < 40 and coalesce(s.connected_provider_count, 0) <= 1 then
        v_lifecycle_state := 'low_adoption';
    elsif coalesce(s.activated, false)
        and coalesce(s.days_since_last_usage, 9999) >= 21
        and coalesce(s.days_since_last_product_event, 9999) >= 21
        and coalesce(s.days_since_last_login, 9999) >= 21
    then
        v_lifecycle_state := 'dormant';
    elsif coalesce(s.activated, false) and s.activated_at is not null and s.activated_at >= now() - interval '14 days' then
        v_lifecycle_state := 'newly_activated';
    elsif coalesce(s.activated, false) then
        v_lifecycle_state := 'activated';
    elsif coalesce(s.onboarding_status, '') = 'completed' then
        v_lifecycle_state := 'onboarding';
    else
        v_lifecycle_state := 'new';
    end if;

    if v_authoritative_churned then
        v_churn_risk := 'critical';
    elsif coalesce(s.plan_status, 'active') = 'failed_payment'
        or (coalesce(s.days_since_last_usage, 0) >= 21 and coalesce(s.days_since_last_sync, 0) >= 21)
        or v_lifecycle_state = 'dormant'
    then
        v_churn_risk := 'critical';
    elsif v_health_score < 50
        or coalesce(s.provider_error_count, 0) > 0
        or coalesce(s.provider_disconnected_count, 0) > 0
        or (s.spend_growth_percentage is not null and s.spend_growth_percentage <= -20)
    then
        v_churn_risk := 'high';
    elsif v_health_score < 70
        or coalesce(s.days_since_last_sync, 0) >= 14
        or coalesce(s.days_since_last_product_event, 0) >= 14
    then
        v_churn_risk := 'medium';
    else
        v_churn_risk := 'low';
    end if;

    if v_authoritative_churned or coalesce(s.plan_status, 'active') in ('inactive', 'failed_payment') then
        v_expansion_score := 0;
    else
        v_expansion_score := v_expansion_score
            + case when coalesce(s.activated, false) then 20 else 0 end
            + case when coalesce(s.connected_provider_count, 0) >= 2 then 10 when coalesce(s.connected_provider_count, 0) = 1 then 4 else 0 end
            + case when coalesce(s.active_service_count, 0) >= 3 then 8 when coalesce(s.active_service_count, 0) >= 1 then 3 else 0 end
            + case
                when coalesce(s.upgrade_requested_count_30d, 0) > 0 then 35
                when coalesce(s.plan_selected_count_30d, 0) > 0 and coalesce(s.current_plan_id, 'starter') = 'starter' then 10
                else 0
              end
            + case
                when coalesce(s.projected_overrun, false) then 15
                else 0
              end
            + case
                when s.spend_growth_percentage is not null and s.spend_growth_percentage >= 35 then 18
                when s.spend_growth_percentage is not null and s.spend_growth_percentage >= 20 then 12
                when s.spend_growth_percentage is not null and s.spend_growth_percentage >= 10 then 6
                else 0
              end
            + case
                when coalesce(s.current_plan_id, 'starter') = 'starter' and coalesce(s.current_month_spend, 0) >= 500 then 12
                when coalesce(s.current_plan_id, 'starter') = 'growth' and coalesce(s.current_month_spend, 0) >= 2000 then 10
                else 0
              end
            + case
                when coalesce(s.sales_ready_lead_count, 0) > 0 then 10
                when coalesce(s.qualified_lead_count, 0) > 0 then 5
                else 0
              end
            + case
                when coalesce(s.estimated_monthly_spend, '') in ('$10K-$25K', '$25K-$50K', '$50K+') then 6
                else 0
              end;
    end if;
    v_expansion_score := greatest(0, least(v_expansion_score, 100));

    if coalesce(s.upgrade_requested_count_30d, 0) > 0 then
        v_expansion_reasons := array_append(v_expansion_reasons, 'Account explicitly requested an upgrade.');
    end if;
    if coalesce(s.projected_overrun, false) then
        v_expansion_reasons := array_append(v_expansion_reasons, 'Projected spend exceeds the configured budget.');
    end if;
    if s.spend_growth_percentage is not null and s.spend_growth_percentage >= 20 then
        v_expansion_reasons := array_append(v_expansion_reasons, 'Observed spend grew ' || round(s.spend_growth_percentage, 2)::text || '% versus the prior 30 days.');
    end if;
    if coalesce(s.connected_provider_count, 0) >= 2 then
        v_expansion_reasons := array_append(v_expansion_reasons, format('Account is active across %s connected providers.', s.connected_provider_count));
    end if;

    if v_authoritative_churned or coalesce(s.plan_status, 'active') in ('inactive', 'failed_payment') then
        v_expansion_state := 'none';
    elsif v_expansion_score >= 85 and s.top_lead_id is not null then
        v_expansion_state := 'sales_followup';
        v_recommended_lead_id := s.top_lead_id;
        v_recommended_owner_type := 'ae';
    elsif v_expansion_score >= 70 then
        v_expansion_state := 'upgrade_ready';
    elsif v_expansion_score >= 50 then
        v_expansion_state := 'expansion_candidate';
    elsif v_expansion_score >= 30 then
        v_expansion_state := 'watch';
    else
        v_expansion_state := 'none';
    end if;

    if v_authoritative_churned or v_health_score < 35 or coalesce(s.plan_status, 'active') = 'failed_payment' then
        v_health_state := 'critical';
    elsif v_health_score < 55 then
        v_health_state := 'at_risk';
    elsif v_health_score < 75 then
        v_health_state := 'watch';
    else
        v_health_state := 'healthy';
    end if;

    if coalesce(s.activation_score, 0) < 40 then
        v_health_reasons := array_append(v_health_reasons, format('Activation score is %s and remains below 40.', coalesce(s.activation_score, 0)));
    end if;
    if v_health_state = 'healthy' and coalesce(s.activated, false) then
        v_health_reasons := array_append(v_health_reasons, 'Activation, engagement, and billing signals are stable.');
    end if;
    if v_expansion_state in ('expansion_candidate', 'upgrade_ready', 'sales_followup') and coalesce(s.activation_score, 0) >= 80 then
        v_expansion_reasons := array_append(v_expansion_reasons, format('Activation score is %s with sustained product value signals.', s.activation_score));
    end if;

    v_needs_intervention := v_health_state in ('at_risk', 'critical')
        or v_churn_risk in ('high', 'critical')
        or v_lifecycle_state = 'dormant';

    v_recommended_action := case
        when v_authoritative_churned then 'review_churn_recovery'
        when coalesce(s.plan_status, 'active') = 'failed_payment' then 'resolve_billing'
        when v_lifecycle_state = 'dormant' then 'reactivate_account'
        when v_health_state in ('at_risk', 'critical') then 'customer_intervention'
        when v_expansion_state = 'sales_followup' then 'route_to_ae'
        when v_expansion_state = 'upgrade_ready' then 'prompt_upgrade'
        when v_lifecycle_state = 'newly_activated' then 'reinforce_activation'
        else 'monitor'
    end;

    v_reasons := jsonb_build_object(
        'rule_version', v_rule_version,
        'health_reasons', to_jsonb(v_health_reasons),
        'churn_reasons', to_jsonb(v_churn_reasons),
        'expansion_reasons', to_jsonb(v_expansion_reasons),
        'components', jsonb_build_object(
            'adoption', v_adoption,
            'engagement', v_engagement,
            'value', v_value,
            'billing', v_billing,
            'risk_penalty', v_risk
        ),
        'signals', jsonb_strip_nulls(jsonb_build_object(
            'activation_score', s.activation_score,
            'connected_provider_count', s.connected_provider_count,
            'days_since_last_usage', s.days_since_last_usage,
            'days_since_last_sync', s.days_since_last_sync,
            'days_since_last_login', s.days_since_last_login,
            'days_since_last_product_event', s.days_since_last_product_event,
            'current_month_spend', s.current_month_spend,
            'spend_growth_percentage', s.spend_growth_percentage,
            'open_critical_alert_count', s.open_critical_alert_count,
            'plan_status', s.plan_status,
            'upgrade_requested_count_30d', s.upgrade_requested_count_30d,
            'top_lead_id', s.top_lead_id
        ))
    );

    v_fingerprint := md5(jsonb_build_object(
        'rule_version', v_rule_version,
        'health_score', v_health_score,
        'health_state', v_health_state,
        'lifecycle_state', v_lifecycle_state,
        'churn_risk', v_churn_risk,
        'expansion_score', v_expansion_score,
        'expansion_state', v_expansion_state,
        'recommended_action', v_recommended_action,
        'recommended_lead_id', v_recommended_lead_id,
        'recommended_owner_type', v_recommended_owner_type,
        'authoritative_churned', v_authoritative_churned,
        'needs_intervention', v_needs_intervention,
        'reasons', v_reasons
    )::text);

    select *
    into latest
    from public.customer_health_evaluations che
    where che.account_id = p_account_id
    order by che.evaluated_at desc, che.created_at desc, che.id desc
    limit 1;

    if found and latest.rule_version = v_rule_version and latest.evaluation_fingerprint = v_fingerprint then
        evaluation_id := latest.id;
        account_id := latest.account_id;
        health_score := latest.health_score;
        health_state := latest.health_state;
        lifecycle_state := latest.lifecycle_state;
        churn_risk := latest.churn_risk;
        expansion_score := latest.expansion_score;
        expansion_state := latest.expansion_state;
        recommended_action := latest.recommended_action;
        recommended_lead_id := latest.recommended_lead_id;
        recommended_owner_type := latest.recommended_owner_type;
        authoritative_churned := latest.authoritative_churned;
        needs_intervention := latest.needs_intervention;
        evaluated_at := latest.evaluated_at;
        return next;
        return;
    end if;

    insert into public.customer_health_evaluations (
        account_id,
        evaluation_type,
        rule_version,
        health_score,
        health_state,
        lifecycle_state,
        churn_risk,
        expansion_score,
        expansion_state,
        adoption_component,
        engagement_component,
        value_component,
        billing_component,
        risk_penalty,
        authoritative_churned,
        needs_intervention,
        recommended_action,
        recommended_lead_id,
        recommended_owner_type,
        reasons,
        evaluation_fingerprint,
        evaluated_at
    ) values (
        p_account_id,
        p_evaluation_type,
        v_rule_version,
        v_health_score,
        v_health_state,
        v_lifecycle_state,
        v_churn_risk,
        v_expansion_score,
        v_expansion_state,
        v_adoption,
        v_engagement,
        v_value,
        v_billing,
        v_risk,
        v_authoritative_churned,
        v_needs_intervention,
        v_recommended_action,
        v_recommended_lead_id,
        v_recommended_owner_type,
        v_reasons,
        v_fingerprint,
        now()
    )
    returning id, customer_health_evaluations.evaluated_at
    into v_evaluation_id, evaluated_at;

    evaluation_id := v_evaluation_id;
    account_id := p_account_id;
    health_score := v_health_score;
    health_state := v_health_state;
    lifecycle_state := v_lifecycle_state;
    churn_risk := v_churn_risk;
    expansion_score := v_expansion_score;
    expansion_state := v_expansion_state;
    recommended_action := v_recommended_action;
    recommended_lead_id := v_recommended_lead_id;
    recommended_owner_type := v_recommended_owner_type;
    authoritative_churned := v_authoritative_churned;
    needs_intervention := v_needs_intervention;
    return next;
end;
$$;
grant execute on function public.evaluate_account_health(uuid, text) to service_role;
create or replace view public.current_customer_health as
with latest as (
    select distinct on (che.account_id)
        che.*
    from public.customer_health_evaluations che
    order by che.account_id, che.evaluated_at desc, che.created_at desc, che.id desc
)
select
    s.account_id,
    s.account_name,
    s.onboarding_status,
    s.company_size,
    s.estimated_monthly_spend,
    s.current_plan_id,
    s.plan_status,
    s.current_month_spend,
    s.projected_month_end_spend,
    s.budget_amount,
    s.projected_overrun,
    s.activation_score,
    s.activated,
    s.activated_at,
    s.time_to_value_hours,
    s.connected_provider_count,
    s.active_service_count,
    s.last_usage_at,
    s.last_synced_at,
    s.last_login_at,
    s.last_product_event_at,
    s.days_since_last_usage,
    s.days_since_last_sync,
    s.days_since_last_login,
    s.days_since_last_product_event,
    s.open_alert_count,
    s.open_high_alert_count,
    s.open_critical_alert_count,
    s.open_recommendation_count,
    s.applied_recommendation_count,
    s.sales_ready_lead_count,
    s.qualified_lead_count,
    s.assigned_sales_lead_count,
    s.ae_owned_lead_count,
    s.sdr_owned_lead_count,
    s.has_manual_sales_override,
    s.latest_sales_owner_type,
    s.latest_sales_routing_status,
    s.top_lead_id,
    latest.id as evaluation_id,
    latest.evaluation_type,
    latest.rule_version,
    latest.health_score,
    latest.health_state,
    latest.lifecycle_state,
    latest.churn_risk,
    latest.expansion_score,
    latest.expansion_state,
    latest.recommended_action,
    latest.recommended_lead_id,
    latest.recommended_owner_type,
    latest.authoritative_churned,
    latest.needs_intervention,
    latest.reasons,
    latest.evaluated_at
from public.account_health_signal_assembly s
left join latest
    on latest.account_id = s.account_id;
create or replace view public.at_risk_accounts as
select *
from public.current_customer_health
where health_state in ('at_risk', 'critical')
   or churn_risk in ('high', 'critical');
create or replace view public.dormant_accounts as
select *
from public.current_customer_health
where lifecycle_state = 'dormant';
create or replace view public.payment_risk_accounts as
select *
from public.current_customer_health
where plan_status = 'failed_payment';
create or replace view public.expansion_ready_accounts as
select *
from public.current_customer_health
where expansion_state in ('expansion_candidate', 'upgrade_ready', 'sales_followup');
create or replace view public.intervention_needed_accounts as
select *
from public.current_customer_health
where needs_intervention = true
   or recommended_action in ('resolve_billing', 'reactivate_account', 'customer_intervention');
create or replace view public.recently_activated_accounts as
select *
from public.current_customer_health
where lifecycle_state = 'newly_activated';
create or replace view public.customer_health_metrics as
select
    count(*)::integer as total_accounts,
    count(*) filter (where health_state = 'healthy')::integer as healthy_accounts,
    count(*) filter (where health_state = 'watch')::integer as watch_accounts,
    count(*) filter (where health_state = 'at_risk')::integer as at_risk_accounts,
    count(*) filter (where health_state = 'critical')::integer as critical_accounts,
    count(*) filter (where lifecycle_state = 'dormant')::integer as dormant_accounts,
    count(*) filter (where plan_status = 'failed_payment')::integer as payment_risk_accounts,
    count(*) filter (where expansion_state = 'expansion_candidate')::integer as expansion_candidate_accounts,
    count(*) filter (where expansion_state = 'upgrade_ready')::integer as upgrade_ready_accounts,
    count(*) filter (where expansion_state = 'sales_followup')::integer as sales_followup_accounts,
    count(*) filter (where activated = true)::integer as activated_accounts,
    round((count(*) filter (where activated = true)::numeric / nullif(count(*), 0)) * 100, 2) as activated_account_rate,
    round((count(*) filter (where budget_amount is not null)::numeric / nullif(count(*), 0)) * 100, 2) as budget_adoption_rate,
    round((count(*) filter (where connected_provider_count > 0)::numeric / nullif(count(*), 0)) * 100, 2) as active_provider_rate,
    false as logo_churn_available,
    false as revenue_churn_available,
    false as grr_available,
    false as nrr_available
from public.current_customer_health
where evaluation_id is not null;
grant select on public.current_customer_health to service_role;
grant select on public.at_risk_accounts to service_role;
grant select on public.dormant_accounts to service_role;
grant select on public.payment_risk_accounts to service_role;
grant select on public.expansion_ready_accounts to service_role;
grant select on public.intervention_needed_accounts to service_role;
grant select on public.recently_activated_accounts to service_role;
grant select on public.customer_health_metrics to service_role;
