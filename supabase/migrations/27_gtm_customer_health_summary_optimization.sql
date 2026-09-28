-- Phase 8 corrective migration: keep GTM retention rollups fast under growing
-- synthetic datasets by aggregating from latest health evaluations directly.

create or replace view public.gtm_customer_health_summary as
with latest_health as (
    select distinct on (che.account_id)
        che.account_id,
        che.health_score,
        che.health_state,
        che.lifecycle_state,
        che.churn_risk,
        che.expansion_state
    from public.customer_health_evaluations che
    order by che.account_id, che.evaluated_at desc, che.created_at desc, che.id desc
),
plan_state as (
    select
        account_id,
        plan_status
    from public.account_current_plan
),
activation_state as (
    select
        account_id,
        activated
    from public.account_activation_state
)
select
    count(*)::integer as evaluated_accounts,
    round(avg(latest_health.health_score)::numeric, 2) as average_health_score,
    count(*) filter (where latest_health.health_state = 'healthy')::integer as healthy_accounts,
    count(*) filter (where latest_health.health_state = 'watch')::integer as watch_accounts,
    count(*) filter (where latest_health.health_state = 'at_risk')::integer as at_risk_accounts,
    count(*) filter (where latest_health.health_state = 'critical')::integer as critical_accounts,
    count(*) filter (where latest_health.churn_risk = 'low')::integer as low_churn_risk_accounts,
    count(*) filter (where latest_health.churn_risk = 'medium')::integer as medium_churn_risk_accounts,
    count(*) filter (where latest_health.churn_risk = 'high')::integer as high_churn_risk_accounts,
    count(*) filter (where latest_health.churn_risk = 'critical')::integer as critical_churn_risk_accounts,
    count(*) filter (where latest_health.lifecycle_state = 'dormant')::integer as dormant_accounts,
    count(*) filter (where plan_state.plan_status = 'failed_payment')::integer as payment_risk_accounts,
    count(*) filter (
        where latest_health.health_state in ('at_risk', 'critical')
           or latest_health.churn_risk in ('high', 'critical')
           or latest_health.lifecycle_state = 'dormant'
    )::integer as intervention_needed_accounts,
    count(*) filter (where latest_health.lifecycle_state = 'newly_activated')::integer as recently_activated_accounts,
    count(*) filter (where latest_health.expansion_state = 'expansion_candidate')::integer as expansion_candidate_accounts,
    count(*) filter (where latest_health.expansion_state = 'upgrade_ready')::integer as upgrade_ready_accounts,
    count(*) filter (where latest_health.expansion_state = 'sales_followup')::integer as sales_followup_accounts
from latest_health
left join plan_state
    on plan_state.account_id = latest_health.account_id
left join activation_state
    on activation_state.account_id = latest_health.account_id;
grant select on public.gtm_customer_health_summary to service_role;
