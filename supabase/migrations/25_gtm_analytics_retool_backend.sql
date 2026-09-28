-- Phase 8 — GTM analytics + Retool backend preparation
-- Builds one cross-domain analytics layer over the existing acquisition,
-- qualification, sales, product, billing, and retention systems.
-- Retool will consume these stable read models and existing vetted RPCs.

create or replace view public.gtm_lead_funnel_assembly as
with paid_accounts as (
    select
        bt.account_id,
        bool_or(bt.payment_status = 'success' and bt.verification_status = 'verified') as has_verified_payment,
        max(bt.verified_at) filter (
            where bt.payment_status = 'success'
              and bt.verification_status = 'verified'
        ) as paid_at
    from public.billing_transactions bt
    where bt.account_id is not null
    group by bt.account_id
)
select
    l.id as lead_id,
    l.created_at as acquired_at,
    coalesce(
        lcq.acquisition_channel,
        resolved.first_touch_channel,
        resolved.last_touch_channel,
        resolved.latest_interaction_channel,
        case
            when l.source_type = 'outbound_scraped' then 'outbound'
            when l.source_type in ('inbound', 'outbound', 'partner', 'creator', 'referral', 'plg') then l.source_type
            else null
        end,
        'unknown'
    ) as acquisition_channel,
    coalesce(
        lcq.acquisition_source,
        resolved.first_touch_source,
        resolved.last_touch_source,
        resolved.latest_interaction_source,
        'unknown'
    ) as acquisition_source,
    coalesce(
        lcq.acquisition_campaign,
        resolved.first_touch_campaign,
        resolved.last_touch_campaign,
        resolved.latest_interaction_campaign,
        'unattributed'
    ) as acquisition_campaign,
    lcq.profile_id,
    lcq.account_id,
    lcq.fit_score,
    lcq.buying_intent,
    lcq.priority_score,
    lcq.priority_tier,
    lcq.mql_status,
    lcq.sql_status,
    lcq.pql_status,
    sa.routing_status,
    sa.eligible_for_sales,
    sa.current_owner_type,
    sa.current_rep_id,
    sa.manual_override,
    coalesce(queue.deal_state, 'no_deal') as deal_state,
    coalesce(queue.last_interaction_at, sa.last_routed_at, lcq.evaluated_at, l.created_at) as last_sales_touch_at,
    coalesce(activation.activation_score, 0) as activation_score,
    coalesce(activation.activated, false) as activated,
    activation.activated_at,
    activation.time_to_value_hours,
    health.health_score,
    health.health_state,
    health.churn_risk,
    health.expansion_state,
    health.evaluated_at as health_evaluated_at,
    coalesce(paid_accounts.has_verified_payment, false) as paid_account,
    paid_accounts.paid_at,
    (lcq.mql_status = 'qualified') as is_mql,
    (lcq.sql_status = 'sales_ready') as is_sql,
    (sa.lead_id is not null and coalesce(sa.eligible_for_sales, false) = true) as is_routed,
    (
        coalesce(queue.deal_state, 'no_deal') in ('reply_received', 'deal_created')
        or coalesce(sa.needs_ae_handoff, false) = true
        or coalesce(sa.routing_status, '') in ('handoff_pending', 'handed_off')
    ) as is_sales_engaged,
    (coalesce(queue.deal_state, 'no_deal') = 'deal_created') as has_deal,
    (lcq.profile_id is not null) as is_signup,
    (lcq.account_id is not null) as has_account,
    (lcq.pql_status in ('product_qualified', 'product_activated')) as is_pql,
    (health.health_state = 'healthy') as is_healthy,
    (health.expansion_state in ('expansion_candidate', 'upgrade_ready', 'sales_followup')) as is_expansion_ready
from public.staged_leads l
left join public.lead_current_qualification lcq
    on lcq.lead_id = l.id
left join public.acquisition_resolved_attribution resolved
    on resolved.lead_id = l.id
left join public.sales_assignments sa
    on sa.lead_id = l.id
left join public.current_sales_queue queue
    on queue.lead_id = l.id
left join public.account_activation_state activation
    on activation.account_id = lcq.account_id
left join public.current_customer_health health
    on health.account_id = lcq.account_id
left join paid_accounts
    on paid_accounts.account_id = lcq.account_id;
grant select on public.gtm_lead_funnel_assembly to service_role;
create or replace view public.gtm_lifecycle_funnel as
with aggregated as (
    select
        coalesce(acquisition_channel, 'all') as acquisition_channel,
        coalesce(acquisition_source, 'all') as acquisition_source,
        coalesce(acquisition_campaign, 'all') as acquisition_campaign,
        count(*)::integer as acquired_count,
        count(*) filter (where is_mql)::integer as mql_count,
        count(*) filter (where is_sql)::integer as sql_count,
        count(*) filter (where is_routed)::integer as routed_count,
        count(*) filter (where is_sales_engaged)::integer as sales_engaged_count,
        count(*) filter (where has_deal)::integer as deal_count,
        count(*) filter (where is_signup)::integer as signup_count,
        count(*) filter (where has_account)::integer as account_count,
        count(*) filter (where activated)::integer as activated_count,
        count(*) filter (where is_pql)::integer as pql_count,
        count(*) filter (where paid_account)::integer as paid_count,
        count(*) filter (where is_healthy)::integer as healthy_count,
        count(*) filter (where is_expansion_ready)::integer as expansion_ready_count
    from public.gtm_lead_funnel_assembly
    group by grouping sets (
        (acquisition_channel, acquisition_source, acquisition_campaign),
        ()
    )
)
select
    aggregated.acquisition_channel,
    aggregated.acquisition_source,
    aggregated.acquisition_campaign,
    stages.stage_order,
    stages.stage_name,
    stages.stage_count,
    case
        when stages.previous_stage_count is null or stages.previous_stage_count = 0 then null
        else round((stages.stage_count::numeric / stages.previous_stage_count::numeric) * 100, 2)
    end as conversion_from_previous_percentage,
    case
        when aggregated.acquired_count = 0 then null
        else round((stages.stage_count::numeric / aggregated.acquired_count::numeric) * 100, 2)
    end as conversion_from_acquired_percentage
from aggregated
cross join lateral (
    values
        (1, 'acquired', aggregated.acquired_count, null::integer),
        (2, 'mql', aggregated.mql_count, aggregated.acquired_count),
        (3, 'sql', aggregated.sql_count, aggregated.mql_count),
        (4, 'routed', aggregated.routed_count, aggregated.sql_count),
        (5, 'sales_engaged', aggregated.sales_engaged_count, aggregated.routed_count),
        (6, 'deal_created', aggregated.deal_count, aggregated.sales_engaged_count),
        (7, 'signup', aggregated.signup_count, aggregated.deal_count),
        (8, 'account', aggregated.account_count, aggregated.signup_count),
        (9, 'activated', aggregated.activated_count, aggregated.account_count),
        (10, 'pql', aggregated.pql_count, aggregated.activated_count),
        (11, 'paid', aggregated.paid_count, aggregated.pql_count),
        (12, 'healthy', aggregated.healthy_count, aggregated.paid_count),
        (13, 'expansion_ready', aggregated.expansion_ready_count, aggregated.healthy_count)
) as stages(stage_order, stage_name, stage_count, previous_stage_count);
grant select on public.gtm_lifecycle_funnel to service_role;
create or replace view public.gtm_acquisition_funnel_assembly as
with paid_accounts as (
    select
        bt.account_id,
        bool_or(bt.payment_status = 'success' and bt.verification_status = 'verified') as has_verified_payment
    from public.billing_transactions bt
    where bt.account_id is not null
    group by bt.account_id
)
select
    resolved.resolved_identity_key,
    resolved.lead_id,
    resolved.profile_id,
    resolved.account_id,
    resolved.first_touch_channel,
    resolved.first_touch_source,
    resolved.first_touch_campaign,
    resolved.last_touch_channel,
    resolved.last_touch_source,
    resolved.last_touch_campaign,
    coalesce(
        resolved.first_touch_channel,
        resolved.last_touch_channel,
        resolved.latest_interaction_channel,
        'unknown'
    ) as acquisition_channel,
    coalesce(
        resolved.first_touch_source,
        resolved.last_touch_source,
        resolved.latest_interaction_source,
        'unknown'
    ) as acquisition_source,
    coalesce(
        resolved.first_touch_campaign,
        resolved.last_touch_campaign,
        resolved.latest_interaction_campaign,
        'unattributed'
    ) as acquisition_campaign,
    resolved.first_touch_occurred_at as acquired_at,
    lcq.mql_status,
    lcq.sql_status,
    lcq.pql_status,
    activation.activated,
    health.expansion_state,
    coalesce(paid_accounts.has_verified_payment, false) as paid_account
from public.acquisition_resolved_attribution resolved
left join public.lead_current_qualification lcq
    on lcq.lead_id = resolved.lead_id
left join public.account_activation_state activation
    on activation.account_id = resolved.account_id
left join public.current_customer_health health
    on health.account_id = resolved.account_id
left join paid_accounts
    on paid_accounts.account_id = resolved.account_id;
grant select on public.gtm_acquisition_funnel_assembly to service_role;
create or replace view public.gtm_acquisition_conversion_metrics as
select
    coalesce(acquisition_channel, 'unknown') as acquisition_channel,
    coalesce(acquisition_source, 'unknown') as acquisition_source,
    coalesce(acquisition_campaign, 'unattributed') as acquisition_campaign,
    count(*)::integer as acquired_identities,
    count(distinct lead_id) filter (where lead_id is not null)::integer as lead_count,
    count(distinct profile_id) filter (where profile_id is not null)::integer as signup_count,
    count(distinct account_id) filter (where account_id is not null)::integer as account_count,
    count(*) filter (where mql_status = 'qualified')::integer as mql_count,
    count(*) filter (where sql_status = 'sales_ready')::integer as sql_count,
    count(*) filter (where activated = true)::integer as activated_count,
    count(*) filter (where pql_status in ('product_qualified', 'product_activated'))::integer as pql_count,
    count(*) filter (where paid_account = true)::integer as paid_count,
    count(*) filter (where expansion_state in ('expansion_candidate', 'upgrade_ready', 'sales_followup'))::integer as expansion_ready_count,
    case
        when count(*) = 0 then null
        else round((count(*) filter (where mql_status = 'qualified'))::numeric / count(*)::numeric * 100, 2)
    end as mql_conversion_percentage,
    case
        when count(*) = 0 then null
        else round((count(*) filter (where sql_status = 'sales_ready'))::numeric / count(*)::numeric * 100, 2)
    end as sql_conversion_percentage,
    case
        when count(*) = 0 then null
        else round((count(*) filter (where activated = true))::numeric / count(*)::numeric * 100, 2)
    end as activation_conversion_percentage,
    case
        when count(*) = 0 then null
        else round((count(*) filter (where paid_account = true))::numeric / count(*)::numeric * 100, 2)
    end as paid_conversion_percentage,
    case
        when count(*) = 0 then null
        else round((count(*) filter (where expansion_state in ('expansion_candidate', 'upgrade_ready', 'sales_followup')))::numeric / count(*)::numeric * 100, 2)
    end as expansion_ready_conversion_percentage
from public.gtm_acquisition_funnel_assembly
group by 1, 2, 3;
grant select on public.gtm_acquisition_conversion_metrics to service_role;
create or replace view public.gtm_acquisition_first_touch_mix as
select
    coalesce(first_touch_channel, 'unknown') as first_touch_channel,
    coalesce(first_touch_source, 'unknown') as first_touch_source,
    coalesce(first_touch_campaign, 'unattributed') as first_touch_campaign,
    count(*)::integer as resolved_identities,
    count(distinct lead_id) filter (where lead_id is not null)::integer as lead_count,
    count(distinct profile_id) filter (where profile_id is not null)::integer as signup_count,
    count(distinct account_id) filter (where account_id is not null)::integer as account_count
from public.acquisition_resolved_attribution
group by 1, 2, 3;
grant select on public.gtm_acquisition_first_touch_mix to service_role;
create or replace view public.gtm_acquisition_last_touch_mix as
select
    coalesce(last_touch_channel, 'unknown') as last_touch_channel,
    coalesce(last_touch_source, 'unknown') as last_touch_source,
    coalesce(last_touch_campaign, 'unattributed') as last_touch_campaign,
    count(*)::integer as resolved_identities,
    count(distinct lead_id) filter (where lead_id is not null)::integer as lead_count,
    count(distinct profile_id) filter (where profile_id is not null)::integer as signup_count,
    count(distinct account_id) filter (where account_id is not null)::integer as account_count
from public.acquisition_resolved_attribution
group by 1, 2, 3;
grant select on public.gtm_acquisition_last_touch_mix to service_role;
create or replace view public.gtm_qualification_summary as
select
    count(*)::integer as evaluated_leads,
    count(*) filter (where mql_status = 'qualified')::integer as mql_count,
    count(*) filter (where sql_status = 'sales_ready')::integer as sql_count,
    count(*) filter (where pql_status in ('product_qualified', 'product_activated'))::integer as pql_count,
    count(*) filter (where pql_status = 'product_activated')::integer as activated_pql_count,
    count(*) filter (where buying_intent = 'high')::integer as high_intent_count,
    count(*) filter (where priority_tier = 'urgent')::integer as urgent_priority_count,
    count(*) filter (where priority_tier = 'high')::integer as high_priority_count,
    count(*) filter (where lead_status = 'nurture')::integer as nurture_count,
    count(*) filter (where lead_status = 'disqualified')::integer as disqualified_count,
    round(avg(fit_score)::numeric, 2) as average_fit_score,
    round(avg(priority_score)::numeric, 2) as average_priority_score
from public.lead_current_qualification;
grant select on public.gtm_qualification_summary to service_role;
create or replace view public.gtm_qualification_distribution as
select
    coalesce(acquisition_channel, 'unknown') as acquisition_channel,
    coalesce(buying_intent, 'unknown') as buying_intent,
    coalesce(priority_tier, 'unknown') as priority_tier,
    mql_status,
    sql_status,
    pql_status,
    count(*)::integer as lead_count,
    round(avg(fit_score)::numeric, 2) as average_fit_score,
    round(avg(priority_score)::numeric, 2) as average_priority_score
from public.lead_current_qualification
group by 1, 2, 3, 4, 5, 6;
grant select on public.gtm_qualification_distribution to service_role;
create or replace view public.gtm_sales_workload_summary as
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
    count(*) filter (where deal_state = 'reply_received')::integer as reply_leads,
    count(*) filter (where deal_state = 'deal_created')::integer as deal_leads,
    count(*) filter (where manual_override = true)::integer as manual_override_leads,
    round(avg(aging_hours)::numeric, 2) as average_aging_hours
from public.current_sales_queue
group by grouping sets (
    (current_owner_type, rep_code, rep_name),
    ()
);
grant select on public.gtm_sales_workload_summary to service_role;
create or replace view public.gtm_product_summary as
with alert_rollup as (
    select
        count(*) filter (where status = 'open')::integer as open_alert_count,
        count(*) filter (where status = 'open' and severity = 'high')::integer as high_alert_count,
        count(*) filter (where status = 'open' and severity = 'critical')::integer as critical_alert_count
    from public.product_alerts
),
recommendation_rollup as (
    select
        count(*) filter (where status = 'open')::integer as open_recommendation_count,
        count(*) filter (where status = 'applied')::integer as applied_recommendation_count
    from public.cost_recommendations
),
plan_rollup as (
    select
        count(*) filter (where current_plan_id = 'starter')::integer as starter_accounts,
        count(*) filter (where current_plan_id = 'growth')::integer as growth_accounts,
        count(*) filter (where current_plan_id = 'scale')::integer as scale_accounts
    from public.account_current_plan
)
select
    count(*)::integer as total_accounts,
    count(*) filter (
        where coalesce(current_month_spend, 0) > 0
           or coalesce(usage_record_count, 0) > 0
           or coalesce(activation_score, 0) > 0
           or coalesce(provider_connected, false) = true
    )::integer as monitored_accounts,
    count(*) filter (where provider_connected = true)::integer as provider_connected_accounts,
    count(*) filter (where budget_id is not null)::integer as budgeted_accounts,
    count(*) filter (where projected_overrun = true)::integer as projected_overrun_accounts,
    coalesce(sum(current_month_spend), 0)::numeric(18, 2) as current_monitored_spend,
    coalesce(sum(projected_month_end_spend), 0)::numeric(18, 2) as projected_month_end_spend,
    round(avg(activation_score)::numeric, 2) as average_activation_score,
    count(*) filter (where activated = true)::integer as activated_accounts,
    case
        when count(*) = 0 then null
        else round((count(*) filter (where activated = true))::numeric / count(*)::numeric * 100, 2)
    end as activation_rate_percentage,
    round(avg(time_to_value_hours)::numeric, 2) as average_time_to_value_hours,
    case
        when count(*) = 0 then null
        else round((count(*) filter (where budget_id is not null))::numeric / count(*)::numeric * 100, 2)
    end as budget_adoption_rate_percentage,
    max(alert_rollup.open_alert_count) as open_alert_count,
    max(alert_rollup.high_alert_count) as high_alert_count,
    max(alert_rollup.critical_alert_count) as critical_alert_count,
    max(recommendation_rollup.open_recommendation_count) as open_recommendation_count,
    max(recommendation_rollup.applied_recommendation_count) as applied_recommendation_count,
    max(plan_rollup.starter_accounts) as starter_accounts,
    max(plan_rollup.growth_accounts) as growth_accounts,
    max(plan_rollup.scale_accounts) as scale_accounts
from public.account_dashboard_overview overview
cross join alert_rollup
cross join recommendation_rollup
cross join plan_rollup;
grant select on public.gtm_product_summary to service_role;
create or replace view public.gtm_customer_health_summary as
select
    count(*)::integer as evaluated_accounts,
    round(avg(health_score)::numeric, 2) as average_health_score,
    count(*) filter (where health_state = 'healthy')::integer as healthy_accounts,
    count(*) filter (where health_state = 'watch')::integer as watch_accounts,
    count(*) filter (where health_state = 'at_risk')::integer as at_risk_accounts,
    count(*) filter (where health_state = 'critical')::integer as critical_accounts,
    count(*) filter (where churn_risk = 'low')::integer as low_churn_risk_accounts,
    count(*) filter (where churn_risk = 'medium')::integer as medium_churn_risk_accounts,
    count(*) filter (where churn_risk = 'high')::integer as high_churn_risk_accounts,
    count(*) filter (where churn_risk = 'critical')::integer as critical_churn_risk_accounts,
    count(*) filter (where lifecycle_state = 'dormant')::integer as dormant_accounts,
    count(*) filter (where plan_status = 'failed_payment')::integer as payment_risk_accounts,
    count(*) filter (where needs_intervention = true)::integer as intervention_needed_accounts,
    count(*) filter (where lifecycle_state = 'newly_activated')::integer as recently_activated_accounts,
    count(*) filter (where expansion_state = 'expansion_candidate')::integer as expansion_candidate_accounts,
    count(*) filter (where expansion_state = 'upgrade_ready')::integer as upgrade_ready_accounts,
    count(*) filter (where expansion_state = 'sales_followup')::integer as sales_followup_accounts
from public.current_customer_health
where evaluation_id is not null;
grant select on public.gtm_customer_health_summary to service_role;
create or replace view public.gtm_executive_summary as
with lead_summary as (
    select
        count(*)::integer as total_leads
    from public.staged_leads
),
qualification_summary as (
    select
        count(*) filter (where mql_status = 'qualified')::integer as mql_count,
        count(*) filter (where sql_status = 'sales_ready')::integer as sql_count,
        count(*) filter (where pql_status in ('product_qualified', 'product_activated'))::integer as pql_count
    from public.lead_current_qualification
),
sales_summary as (
    select
        count(*)::integer as routed_leads
    from public.current_sales_queue
),
hot_summary as (
    select
        count(*)::integer as hot_leads
    from public.hot_sales_leads
),
account_summary as (
    select
        count(*)::integer as total_accounts,
        count(*) filter (
            where coalesce(current_month_spend, 0) > 0
               or coalesce(usage_record_count, 0) > 0
               or coalesce(activation_score, 0) > 0
               or coalesce(provider_connected, false) = true
        )::integer as active_accounts,
        count(*) filter (where activated = true)::integer as activated_accounts,
        round(avg(activation_score)::numeric, 2) as average_activation_score,
        round(avg(time_to_value_hours)::numeric, 2) as average_time_to_value_hours,
        coalesce(sum(current_month_spend), 0)::numeric(18, 2) as current_monitored_spend
    from public.account_dashboard_overview
),
health_summary as (
    select
        count(*) filter (where health_state in ('at_risk', 'critical') or churn_risk in ('high', 'critical'))::integer as at_risk_accounts,
        count(*) filter (where health_state = 'critical')::integer as critical_accounts,
        count(*) filter (where plan_status = 'failed_payment')::integer as payment_risk_accounts,
        count(*) filter (where expansion_state in ('expansion_candidate', 'upgrade_ready', 'sales_followup'))::integer as expansion_ready_accounts
    from public.current_customer_health
    where evaluation_id is not null
)
select
    lead_summary.total_leads,
    account_summary.total_accounts,
    qualification_summary.mql_count,
    qualification_summary.sql_count,
    qualification_summary.pql_count,
    sales_summary.routed_leads,
    hot_summary.hot_leads,
    account_summary.active_accounts,
    account_summary.activated_accounts,
    case
        when account_summary.total_accounts = 0 then null
        else round((account_summary.activated_accounts::numeric / account_summary.total_accounts::numeric) * 100, 2)
    end as activation_rate_percentage,
    account_summary.average_activation_score,
    account_summary.average_time_to_value_hours,
    account_summary.current_monitored_spend,
    health_summary.at_risk_accounts,
    health_summary.critical_accounts,
    health_summary.payment_risk_accounts,
    health_summary.expansion_ready_accounts,
    null::numeric as revenue_churn_percentage,
    null::numeric as logo_churn_percentage,
    null::numeric as grr_percentage,
    null::numeric as nrr_percentage,
    now() as generated_at
from lead_summary
cross join qualification_summary
cross join sales_summary
cross join hot_summary
cross join account_summary
cross join health_summary;
grant select on public.gtm_executive_summary to service_role;
create or replace view public.gtm_lead_volume_trend as
select
    date_trunc('day', acquired_at)::date as metric_day,
    coalesce(acquisition_channel, 'unknown') as acquisition_channel,
    count(*)::integer as acquired_count,
    count(*) filter (where is_mql)::integer as mql_count,
    count(*) filter (where is_sql)::integer as sql_count,
    count(*) filter (where is_routed)::integer as routed_count,
    count(*) filter (where is_sales_engaged)::integer as sales_engaged_count,
    count(*) filter (where has_deal)::integer as deal_count
from public.gtm_lead_funnel_assembly
group by 1, 2;
grant select on public.gtm_lead_volume_trend to service_role;
create or replace view public.gtm_account_lifecycle_trend as
with signup_events as (
    select
        date_trunc('day', signup_at)::date as metric_day,
        count(*)::integer as signup_accounts
    from public.account_activation_state
    where signup_at is not null
    group by 1
),
activation_events as (
    select
        date_trunc('day', activated_at)::date as metric_day,
        count(*)::integer as activated_accounts
    from public.account_activation_state
    where activated_at is not null
    group by 1
),
paid_events as (
    select
        date_trunc('day', verified_at)::date as metric_day,
        count(*)::integer as paid_accounts
    from public.billing_transactions
    where payment_status = 'success'
      and verification_status = 'verified'
      and verified_at is not null
    group by 1
),
healthy_events as (
    select
        date_trunc('day', evaluated_at)::date as metric_day,
        count(*) filter (where health_state = 'healthy')::integer as healthy_accounts,
        count(*) filter (where expansion_state in ('expansion_candidate', 'upgrade_ready', 'sales_followup'))::integer as expansion_ready_accounts
    from public.customer_health_evaluations
    where evaluated_at is not null
    group by 1
),
days as (
    select metric_day from signup_events
    union
    select metric_day from activation_events
    union
    select metric_day from paid_events
    union
    select metric_day from healthy_events
)
select
    days.metric_day,
    coalesce(signup_events.signup_accounts, 0) as signup_accounts,
    coalesce(activation_events.activated_accounts, 0) as activated_accounts,
    coalesce(paid_events.paid_accounts, 0) as paid_accounts,
    coalesce(healthy_events.healthy_accounts, 0) as healthy_accounts,
    coalesce(healthy_events.expansion_ready_accounts, 0) as expansion_ready_accounts
from days
left join signup_events
    on signup_events.metric_day = days.metric_day
left join activation_events
    on activation_events.metric_day = days.metric_day
left join paid_events
    on paid_events.metric_day = days.metric_day
left join healthy_events
    on healthy_events.metric_day = days.metric_day;
grant select on public.gtm_account_lifecycle_trend to service_role;
create or replace view public.gtm_spend_trend as
select
    spend_date as metric_day,
    count(distinct account_id)::integer as active_accounts,
    sum(spend)::numeric(18, 2) as total_spend
from public.account_daily_spend_current_month
group by spend_date;
grant select on public.gtm_spend_trend to service_role;
create or replace view public.gtm_customer_health_trend as
select
    date_trunc('day', evaluated_at)::date as metric_day,
    count(*)::integer as evaluation_count,
    count(*) filter (where health_state = 'healthy')::integer as healthy_count,
    count(*) filter (where health_state = 'at_risk')::integer as at_risk_count,
    count(*) filter (where health_state = 'critical')::integer as critical_count,
    count(*) filter (where churn_risk in ('high', 'critical'))::integer as elevated_churn_risk_count,
    count(*) filter (where expansion_state in ('expansion_candidate', 'upgrade_ready', 'sales_followup'))::integer as expansion_ready_count
from public.customer_health_evaluations
group by 1;
grant select on public.gtm_customer_health_trend to service_role;
create or replace view public.gtm_sales_assignment_activity_trend as
select
    date_trunc('day', created_at)::date as metric_day,
    count(*)::integer as activity_count,
    count(*) filter (where action_type = 'routed')::integer as routed_count,
    count(*) filter (where action_type = 'assigned')::integer as assigned_count,
    count(*) filter (where action_type = 'handoff')::integer as handoff_count,
    count(*) filter (where action_type = 'manual_override')::integer as manual_override_count,
    count(*) filter (where action_type = 'retry_marked')::integer as retry_marked_count,
    count(*) filter (where action_type = 'sync_updated')::integer as sync_updated_count
from public.sales_assignment_history
group by 1;
grant select on public.gtm_sales_assignment_activity_trend to service_role;
