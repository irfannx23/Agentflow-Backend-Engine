-- ============================================
-- CostPilot Phase 10 — Hosted runtime performance corrections
-- ============================================
-- Keeps the existing Retool and RPC contracts intact while removing the two
-- main timeout paths exposed by the larger Phase 10 historical demo cohort:
--   * gtm_sales_workload_summary no longer depends on current_sales_queue
--   * account_health_signal_assembly no longer re-nests account_dashboard_overview

create or replace view public.gtm_sales_workload_summary as
with outreach_rollup as (
    select
        o.lead_id,
        count(*) filter (where o.status = 'replied' or o.reply_received_at is not null)::integer as reply_leads,
        count(*) filter (where o.deal_id is not null)::integer as deal_leads
    from public.outreach o
    group by o.lead_id
),
base as (
    select
        sa.current_owner_type,
        rep.rep_code,
        rep.full_name as rep_name,
        sa.current_rep_id,
        sa.routing_status,
        sa.priority_tier,
        sa.sql_status,
        sa.needs_ae_handoff,
        sa.crm_sync_status,
        sa.slack_sync_status,
        sa.manual_override,
        coalesce(oroll.reply_leads, 0) as reply_leads,
        coalesce(oroll.deal_leads, 0) as deal_leads,
        greatest(
            extract(epoch from (now() - coalesce(sa.assigned_at, sa.last_routed_at, lead.created_at, sa.created_at))) / 3600.0,
            0
        ) as aging_hours
    from public.sales_assignments sa
    left join public.sales_reps rep
        on rep.id = sa.current_rep_id
    left join public.staged_leads lead
        on lead.id = sa.lead_id
    left join outreach_rollup oroll
        on oroll.lead_id = sa.lead_id
    where sa.eligible_for_sales = true
)
select
    coalesce(current_owner_type, 'all') as owner_type,
    coalesce(rep_code, 'all') as rep_code,
    coalesce(rep_name, 'All reps') as rep_name,
    count(*)::integer as queued_leads,
    count(*) filter (where current_rep_id is not null)::integer as assigned_leads,
    count(*) filter (where current_rep_id is null or routing_status in ('unassigned', 'retry_required'))::integer as unassigned_or_retry_leads,
    count(*) filter (where priority_tier in ('urgent', 'high') and sql_status = 'sales_ready')::integer as hot_leads,
    count(*) filter (where routing_status in ('handoff_pending', 'handed_off') or needs_ae_handoff = true)::integer as handoff_leads,
    count(*) filter (where routing_status = 'retry_required' or crm_sync_status = 'failed' or slack_sync_status = 'failed')::integer as routing_failure_leads,
    count(*) filter (where reply_leads > 0)::integer as reply_leads,
    count(*) filter (where deal_leads > 0)::integer as deal_leads,
    count(*) filter (where manual_override = true)::integer as manual_override_leads,
    round(avg(aging_hours)::numeric, 2) as average_aging_hours
from base
group by grouping sets (
    (current_owner_type, rep_code, rep_name),
    ()
);
grant select on public.gtm_sales_workload_summary to service_role;
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
    spend.current_month_spend,
    spend.projected_month_end_spend,
    spend.average_daily_spend,
    spend.last_7_day_spend,
    spend.prior_7_day_spend,
    spend.usage_record_count,
    spend.last_usage_at,
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
    case when spend.last_usage_at is null then null else greatest(floor(extract(epoch from (now() - spend.last_usage_at)) / 86400), 0)::integer end as days_since_last_usage,
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
left join public.account_spend_summary_current_month spend
    on spend.account_id = a.id
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
