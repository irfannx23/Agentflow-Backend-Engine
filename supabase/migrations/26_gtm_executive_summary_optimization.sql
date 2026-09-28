-- Phase 8 corrective migration: reuse GTM summary views for the executive rollup
-- so Retool overview queries do not duplicate heavier lower-level scans.

create or replace view public.gtm_executive_summary as
with lead_summary as (
    select
        count(*)::integer as total_leads
    from public.staged_leads
),
qualification_summary as (
    select *
    from public.gtm_qualification_summary
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
    select *
    from public.gtm_product_summary
),
health_summary as (
    select *
    from public.gtm_customer_health_summary
)
select
    lead_summary.total_leads,
    account_summary.total_accounts,
    qualification_summary.mql_count,
    qualification_summary.sql_count,
    qualification_summary.pql_count,
    sales_summary.routed_leads,
    hot_summary.hot_leads,
    account_summary.monitored_accounts as active_accounts,
    account_summary.activated_accounts,
    account_summary.activation_rate_percentage,
    account_summary.average_activation_score,
    account_summary.average_time_to_value_hours,
    account_summary.current_monitored_spend,
    health_summary.at_risk_accounts,
    health_summary.critical_accounts,
    health_summary.payment_risk_accounts,
    (
        coalesce(health_summary.expansion_candidate_accounts, 0)
        + coalesce(health_summary.upgrade_ready_accounts, 0)
        + coalesce(health_summary.sales_followup_accounts, 0)
    )::integer as expansion_ready_accounts,
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
