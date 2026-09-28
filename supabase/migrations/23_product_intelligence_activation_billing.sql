-- ============================================
-- CostPilot Phase 6 — Product intelligence + activation + billing
-- ============================================
-- Adds one canonical product-data layer for:
--   * provider connections
--   * normalized usage / cost records
--   * budgets
--   * persistent product alerts
--   * persistent cost recommendations
--   * account billing / plan state
--   * analytics-ready spend, activation, and dashboard views
--   * PQL-compatible qualification extension on the existing Phase 4 contract

create extension if not exists pgcrypto;
create table if not exists public.provider_connections (
    id                uuid primary key default gen_random_uuid(),
    account_id        uuid not null references public.accounts (id) on delete cascade,
    provider          text not null,
    connection_mode   text not null default 'demo_fixture',
    connection_status text not null default 'connected',
    external_reference text,
    metadata          jsonb not null default '{}'::jsonb,
    connected_at      timestamptz not null default now(),
    last_synced_at    timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint provider_connections_provider_check
        check (provider in ('openai', 'anthropic', 'aws', 'google', 'azure', 'demo')),
    constraint provider_connections_mode_check
        check (connection_mode in ('demo_fixture', 'api_key', 'manual_import')),
    constraint provider_connections_status_check
        check (connection_status in ('connected', 'syncing', 'error', 'disconnected')),
    constraint provider_connections_metadata_object_check
        check (jsonb_typeof(metadata) = 'object'),
    constraint provider_connections_unique_provider_mode
        unique (account_id, provider, connection_mode)
);
create index if not exists provider_connections_account_status_idx
    on public.provider_connections (account_id, connection_status, provider);
drop trigger if exists provider_connections_set_updated_at on public.provider_connections;
create trigger provider_connections_set_updated_at
    before update on public.provider_connections
    for each row
    execute function public.set_updated_at();
alter table public.provider_connections enable row level security;
drop policy if exists "service_role_all_provider_connections" on public.provider_connections;
create policy "service_role_all_provider_connections"
    on public.provider_connections
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.provider_connections to service_role;
create table if not exists public.usage_records (
    id                     uuid primary key default gen_random_uuid(),
    account_id             uuid not null references public.accounts (id) on delete cascade,
    provider_connection_id uuid not null references public.provider_connections (id) on delete cascade,
    provider               text not null,
    service_name           text not null,
    model_name             text,
    usage_quantity         numeric(18, 6) not null,
    usage_unit             text not null,
    unit_price             numeric(18, 6) not null,
    calculated_cost        numeric(18, 6) not null,
    usage_at               timestamptz not null,
    period_start           timestamptz,
    period_end             timestamptz,
    source_type            text not null default 'demo_fixture',
    source_record_id       text not null,
    metadata               jsonb not null default '{}'::jsonb,
    created_at             timestamptz not null default now(),
    constraint usage_records_provider_check
        check (provider in ('openai', 'anthropic', 'aws', 'google', 'azure', 'demo')),
    constraint usage_records_quantity_check
        check (usage_quantity >= 0),
    constraint usage_records_unit_price_check
        check (unit_price >= 0),
    constraint usage_records_cost_check
        check (calculated_cost >= 0),
    constraint usage_records_source_type_check
        check (source_type in ('demo_fixture', 'manual_sync', 'api_sync')),
    constraint usage_records_metadata_object_check
        check (jsonb_typeof(metadata) = 'object'),
    constraint usage_records_unique_source
        unique (provider_connection_id, source_type, source_record_id)
);
create index if not exists usage_records_account_usage_at_idx
    on public.usage_records (account_id, usage_at desc);
create index if not exists usage_records_provider_usage_at_idx
    on public.usage_records (provider, usage_at desc);
create index if not exists usage_records_account_provider_service_idx
    on public.usage_records (account_id, provider, service_name, usage_at desc);
alter table public.usage_records enable row level security;
drop policy if exists "service_role_all_usage_records" on public.usage_records;
create policy "service_role_all_usage_records"
    on public.usage_records
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.usage_records to service_role;
create table if not exists public.budgets (
    id                     uuid primary key default gen_random_uuid(),
    account_id             uuid not null references public.accounts (id) on delete cascade,
    provider_connection_id uuid references public.provider_connections (id) on delete set null,
    provider               text,
    budget_scope           text not null default 'account',
    period_month           date not null,
    amount                 numeric(18, 2) not null,
    currency               text not null default 'USD',
    threshold_percentage   integer,
    alerting_enabled       boolean not null default true,
    status                 text not null default 'active',
    created_by_profile_id  uuid references public.profiles (id) on delete set null,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    constraint budgets_provider_check
        check (provider is null or provider in ('openai', 'anthropic', 'aws', 'google', 'azure', 'demo')),
    constraint budgets_scope_check
        check (budget_scope in ('account', 'provider')),
    constraint budgets_amount_check
        check (amount > 0),
    constraint budgets_threshold_check
        check (threshold_percentage is null or (threshold_percentage >= 1 and threshold_percentage <= 100)),
    constraint budgets_status_check
        check (status in ('active', 'inactive', 'archived')),
    constraint budgets_scope_provider_check
        check (
            (budget_scope = 'account' and provider is null)
            or (budget_scope = 'provider' and provider is not null)
        )
);
create unique index if not exists budgets_unique_scope_month_idx
    on public.budgets (account_id, budget_scope, coalesce(provider, '__account__'), period_month);
create index if not exists budgets_account_period_idx
    on public.budgets (account_id, period_month desc, status);
drop trigger if exists budgets_set_updated_at on public.budgets;
create trigger budgets_set_updated_at
    before update on public.budgets
    for each row
    execute function public.set_updated_at();
alter table public.budgets enable row level security;
drop policy if exists "service_role_all_budgets" on public.budgets;
create policy "service_role_all_budgets"
    on public.budgets
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.budgets to service_role;
create table if not exists public.product_alerts (
    id                     uuid primary key default gen_random_uuid(),
    account_id             uuid not null references public.accounts (id) on delete cascade,
    provider_connection_id uuid references public.provider_connections (id) on delete set null,
    budget_id              uuid references public.budgets (id) on delete set null,
    provider               text,
    alert_type             text not null,
    severity               text not null,
    status                 text not null default 'open',
    threshold_value        numeric(18, 2),
    observed_value         numeric(18, 2),
    observed_period        date not null,
    metadata               jsonb not null default '{}'::jsonb,
    triggered_at           timestamptz not null default now(),
    resolved_at            timestamptz,
    constraint product_alerts_provider_check
        check (provider is null or provider in ('openai', 'anthropic', 'aws', 'google', 'azure', 'demo')),
    constraint product_alerts_type_check
        check (alert_type in ('budget_threshold_reached', 'projected_budget_overrun', 'spend_spike')),
    constraint product_alerts_severity_check
        check (severity in ('low', 'medium', 'high', 'critical')),
    constraint product_alerts_status_check
        check (status in ('open', 'resolved', 'suppressed')),
    constraint product_alerts_metadata_object_check
        check (jsonb_typeof(metadata) = 'object')
);
create unique index if not exists product_alerts_open_dedupe_idx
    on public.product_alerts (account_id, coalesce(provider, '__account__'), alert_type, observed_period)
    where status = 'open';
create index if not exists product_alerts_account_triggered_idx
    on public.product_alerts (account_id, status, triggered_at desc);
alter table public.product_alerts enable row level security;
drop policy if exists "service_role_all_product_alerts" on public.product_alerts;
create policy "service_role_all_product_alerts"
    on public.product_alerts
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.product_alerts to service_role;
create table if not exists public.cost_recommendations (
    id                     uuid primary key default gen_random_uuid(),
    account_id             uuid not null references public.accounts (id) on delete cascade,
    provider_connection_id uuid references public.provider_connections (id) on delete set null,
    provider               text,
    service_name           text,
    model_name             text,
    recommendation_type    text not null,
    priority               text not null,
    status                 text not null default 'open',
    title                  text not null,
    summary                text not null,
    observed_value         numeric(18, 2),
    metadata               jsonb not null default '{}'::jsonb,
    generated_at           timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    constraint cost_recommendations_provider_check
        check (provider is null or provider in ('openai', 'anthropic', 'aws', 'google', 'azure', 'demo')),
    constraint cost_recommendations_type_check
        check (recommendation_type in ('budget_missing', 'projected_budget_overrun', 'provider_cost_concentration', 'service_cost_concentration', 'spend_spike', 'high_unit_cost')),
    constraint cost_recommendations_priority_check
        check (priority in ('low', 'medium', 'high', 'urgent')),
    constraint cost_recommendations_status_check
        check (status in ('open', 'dismissed', 'applied')),
    constraint cost_recommendations_metadata_object_check
        check (jsonb_typeof(metadata) = 'object')
);
create unique index if not exists cost_recommendations_open_dedupe_idx
    on public.cost_recommendations (
        account_id,
        recommendation_type,
        coalesce(provider, '__account__'),
        coalesce(service_name, '__service__'),
        coalesce(model_name, '__model__'),
        status
    )
    where status = 'open';
create index if not exists cost_recommendations_account_generated_idx
    on public.cost_recommendations (account_id, status, priority, generated_at desc);
drop trigger if exists cost_recommendations_set_updated_at on public.cost_recommendations;
create trigger cost_recommendations_set_updated_at
    before update on public.cost_recommendations
    for each row
    execute function public.set_updated_at();
alter table public.cost_recommendations enable row level security;
drop policy if exists "service_role_all_cost_recommendations" on public.cost_recommendations;
create policy "service_role_all_cost_recommendations"
    on public.cost_recommendations
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.cost_recommendations to service_role;
create table if not exists public.billing_transactions (
    id                    uuid primary key default gen_random_uuid(),
    account_id            uuid references public.accounts (id) on delete set null,
    profile_id            uuid references public.profiles (id) on delete set null,
    billing_provider      text not null default 'payu',
    plan_id               text not null,
    billing_interval      text,
    amount                numeric(18, 2) not null,
    currency              text not null default 'INR',
    provider_txn_id       text not null,
    provider_payment_id   text,
    payment_status        text not null default 'pending',
    verification_status   text not null default 'pending',
    idempotency_key       text,
    checkout_payload      jsonb not null default '{}'::jsonb,
    verified_payload      jsonb not null default '{}'::jsonb,
    activated_at          timestamptz,
    verified_at           timestamptz,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    constraint billing_transactions_provider_check
        check (billing_provider in ('payu')),
    constraint billing_transactions_plan_check
        check (plan_id in ('starter', 'growth', 'scale')),
    constraint billing_transactions_interval_check
        check (billing_interval is null or billing_interval in ('monthly', 'custom')),
    constraint billing_transactions_amount_check
        check (amount >= 0),
    constraint billing_transactions_payment_status_check
        check (payment_status in ('pending', 'success', 'failed')),
    constraint billing_transactions_verification_status_check
        check (verification_status in ('pending', 'verified', 'rejected')),
    constraint billing_transactions_checkout_payload_object_check
        check (jsonb_typeof(checkout_payload) = 'object'),
    constraint billing_transactions_verified_payload_object_check
        check (jsonb_typeof(verified_payload) = 'object'),
    constraint billing_transactions_provider_txn_unique
        unique (billing_provider, provider_txn_id)
);
create unique index if not exists billing_transactions_idempotency_idx
    on public.billing_transactions (idempotency_key)
    where idempotency_key is not null;
create index if not exists billing_transactions_account_created_idx
    on public.billing_transactions (account_id, created_at desc);
drop trigger if exists billing_transactions_set_updated_at on public.billing_transactions;
create trigger billing_transactions_set_updated_at
    before update on public.billing_transactions
    for each row
    execute function public.set_updated_at();
alter table public.billing_transactions enable row level security;
drop policy if exists "service_role_all_billing_transactions" on public.billing_transactions;
create policy "service_role_all_billing_transactions"
    on public.billing_transactions
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.billing_transactions to service_role;
create table if not exists public.account_plans (
    id                         uuid primary key default gen_random_uuid(),
    account_id                 uuid not null unique references public.accounts (id) on delete cascade,
    profile_id                 uuid references public.profiles (id) on delete set null,
    current_plan_id            text not null default 'starter',
    plan_status                text not null default 'active',
    billing_provider           text not null default 'payu',
    billing_interval           text not null default 'monthly',
    latest_transaction_id      uuid references public.billing_transactions (id) on delete set null,
    activated_at               timestamptz,
    expires_at                 timestamptz,
    metadata                   jsonb not null default '{}'::jsonb,
    created_at                 timestamptz not null default now(),
    updated_at                 timestamptz not null default now(),
    constraint account_plans_plan_check
        check (current_plan_id in ('starter', 'growth', 'scale')),
    constraint account_plans_status_check
        check (plan_status in ('active', 'pending_payment', 'inactive', 'failed_payment')),
    constraint account_plans_provider_check
        check (billing_provider in ('payu')),
    constraint account_plans_interval_check
        check (billing_interval in ('monthly', 'custom')),
    constraint account_plans_metadata_object_check
        check (jsonb_typeof(metadata) = 'object')
);
create index if not exists account_plans_status_idx
    on public.account_plans (plan_status, current_plan_id, updated_at desc);
drop trigger if exists account_plans_set_updated_at on public.account_plans;
create trigger account_plans_set_updated_at
    before update on public.account_plans
    for each row
    execute function public.set_updated_at();
alter table public.account_plans enable row level security;
drop policy if exists "service_role_all_account_plans" on public.account_plans;
create policy "service_role_all_account_plans"
    on public.account_plans
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.account_plans to service_role;
create or replace view public.account_daily_spend_current_month as
with current_month as (
    select
        u.account_id,
        date_trunc('day', u.usage_at)::date as spend_date,
        sum(u.calculated_cost)::numeric(18, 2) as spend
    from public.usage_records u
    where u.usage_at >= date_trunc('month', now())
      and u.usage_at < date_trunc('month', now()) + interval '1 month'
    group by u.account_id, date_trunc('day', u.usage_at)::date
)
select
    account_id,
    spend_date,
    spend
from current_month;
grant select on public.account_daily_spend_current_month to service_role;
create or replace view public.account_spend_summary_current_month as
with spend as (
    select
        u.account_id,
        sum(u.calculated_cost)::numeric(18, 2) as current_month_spend,
        count(*)::integer as usage_record_count,
        max(u.usage_at) as last_usage_at
    from public.usage_records u
    where u.usage_at >= date_trunc('month', now())
      and u.usage_at < date_trunc('month', now()) + interval '1 month'
    group by u.account_id
),
daily as (
    select
        d.account_id,
        avg(d.spend)::numeric(18, 4) as average_daily_spend,
        sum(case when d.spend_date >= (current_date - interval '6 days')::date then d.spend else 0 end)::numeric(18, 2) as last_7_day_spend,
        sum(case when d.spend_date >= (current_date - interval '13 days')::date and d.spend_date < (current_date - interval '6 days')::date then d.spend else 0 end)::numeric(18, 2) as prior_7_day_spend
    from public.account_daily_spend_current_month d
    group by d.account_id
),
calendar as (
    select
        extract(day from now())::integer as elapsed_days_in_month,
        extract(day from (date_trunc('month', now()) + interval '1 month - 1 day'))::integer as days_in_month
)
select
    a.id as account_id,
    coalesce(spend.current_month_spend, 0)::numeric(18, 2) as current_month_spend,
    coalesce(spend.usage_record_count, 0) as usage_record_count,
    spend.last_usage_at,
    coalesce(daily.average_daily_spend, 0)::numeric(18, 4) as average_daily_spend,
    coalesce(daily.last_7_day_spend, 0)::numeric(18, 2) as last_7_day_spend,
    coalesce(daily.prior_7_day_spend, 0)::numeric(18, 2) as prior_7_day_spend,
    calendar.elapsed_days_in_month,
    calendar.days_in_month,
    case
        when coalesce(spend.current_month_spend, 0) = 0 then 0::numeric(18, 2)
        else round((coalesce(spend.current_month_spend, 0) / greatest(calendar.elapsed_days_in_month, 1)) * calendar.days_in_month, 2)
    end as projected_month_end_spend
from public.accounts a
cross join calendar
left join spend
    on spend.account_id = a.id
left join daily
    on daily.account_id = a.id;
grant select on public.account_spend_summary_current_month to service_role;
create or replace view public.account_provider_spend_current_month as
select
    u.account_id,
    u.provider,
    sum(u.calculated_cost)::numeric(18, 2) as spend,
    sum(u.usage_quantity)::numeric(18, 6) as usage_quantity,
    count(*)::integer as usage_record_count,
    max(u.usage_at) as last_usage_at
from public.usage_records u
where u.usage_at >= date_trunc('month', now())
  and u.usage_at < date_trunc('month', now()) + interval '1 month'
group by u.account_id, u.provider;
grant select on public.account_provider_spend_current_month to service_role;
create or replace view public.account_service_spend_current_month as
select
    u.account_id,
    u.provider,
    u.service_name,
    u.model_name,
    sum(u.calculated_cost)::numeric(18, 2) as spend,
    sum(u.usage_quantity)::numeric(18, 6) as usage_quantity,
    count(*)::integer as usage_record_count,
    avg(u.unit_price)::numeric(18, 6) as average_unit_price,
    max(u.usage_at) as last_usage_at
from public.usage_records u
where u.usage_at >= date_trunc('month', now())
  and u.usage_at < date_trunc('month', now()) + interval '1 month'
group by u.account_id, u.provider, u.service_name, u.model_name;
grant select on public.account_service_spend_current_month to service_role;
create or replace view public.account_budget_status_current_month as
with account_budget as (
    select distinct on (b.account_id)
        b.account_id,
        b.id as budget_id,
        b.amount,
        b.currency,
        b.threshold_percentage,
        b.alerting_enabled,
        b.status
    from public.budgets b
    where b.budget_scope = 'account'
      and b.period_month = date_trunc('month', now())::date
      and b.status = 'active'
    order by b.account_id, b.updated_at desc
)
select
    a.id as account_id,
    account_budget.budget_id,
    account_budget.amount as budget_amount,
    account_budget.currency,
    account_budget.threshold_percentage,
    account_budget.alerting_enabled,
    account_budget.status as budget_status,
    spend.current_month_spend,
    spend.projected_month_end_spend,
    case
        when account_budget.amount is null or account_budget.amount = 0 then null
        else round((spend.current_month_spend / account_budget.amount) * 100, 2)
    end as budget_used_percentage,
    case
        when account_budget.amount is null or account_budget.amount = 0 then null
        else round((spend.projected_month_end_spend / account_budget.amount) * 100, 2)
    end as projected_budget_used_percentage,
    case
        when account_budget.amount is null then null
        else round(spend.projected_month_end_spend - account_budget.amount, 2)
    end as projected_budget_variance,
    case
        when account_budget.amount is null then false
        else spend.projected_month_end_spend > account_budget.amount
    end as projected_overrun
from public.accounts a
left join public.account_spend_summary_current_month spend
    on spend.account_id = a.id
left join account_budget
    on account_budget.account_id = a.id;
grant select on public.account_budget_status_current_month to service_role;
create or replace view public.account_activation_state as
with event_rollup as (
    select
        pe.account_id,
        min(pe.created_at) filter (where pe.event_name = 'signup') as signup_at,
        min(pe.created_at) filter (where pe.event_name = 'onboarding_completed') as onboarding_completed_at,
        min(pe.created_at) filter (where pe.event_name = 'provider_connected') as provider_connected_at,
        min(pe.created_at) filter (where pe.event_name = 'usage_synced') as usage_synced_at,
        min(pe.created_at) filter (where pe.event_name = 'insight_generated') as insight_generated_at,
        min(pe.created_at) filter (where pe.event_name = 'budget_created') as budget_created_at,
        min(pe.created_at) filter (where pe.event_name = 'alert_configured') as alert_configured_at,
        min(pe.created_at) filter (where pe.event_name = 'first_cost_data_received') as first_cost_data_received_at
    from public.product_events pe
    where pe.account_id is not null
    group by pe.account_id
),
connection_rollup as (
    select
        pc.account_id,
        min(pc.connected_at) as first_connected_at
    from public.provider_connections pc
    where pc.connection_status = 'connected'
    group by pc.account_id
),
usage_rollup as (
    select
        u.account_id,
        min(u.usage_at) as first_usage_at
    from public.usage_records u
    group by u.account_id
),
budget_rollup as (
    select
        b.account_id,
        min(b.created_at) as first_budget_at,
        bool_or(b.threshold_percentage is not null and b.alerting_enabled = true and b.status = 'active') as has_alert_configuration
    from public.budgets b
    group by b.account_id
),
recommendation_rollup as (
    select
        r.account_id,
        min(r.generated_at) as first_insight_at
    from public.cost_recommendations r
    group by r.account_id
)
select
    a.id as account_id,
    coalesce(event_rollup.signup_at, profiles.created_at) as signup_at,
    event_rollup.onboarding_completed_at,
    coalesce(event_rollup.provider_connected_at, connection_rollup.first_connected_at) as provider_connected_at,
    coalesce(event_rollup.usage_synced_at, usage_rollup.first_usage_at) as usage_synced_at,
    coalesce(event_rollup.insight_generated_at, recommendation_rollup.first_insight_at) as insight_generated_at,
    coalesce(event_rollup.budget_created_at, budget_rollup.first_budget_at) as budget_created_at,
    event_rollup.alert_configured_at,
    event_rollup.first_cost_data_received_at,
    (coalesce(event_rollup.provider_connected_at, connection_rollup.first_connected_at) is not null) as provider_connected,
    (coalesce(event_rollup.usage_synced_at, usage_rollup.first_usage_at) is not null) as usage_synced,
    (coalesce(event_rollup.insight_generated_at, recommendation_rollup.first_insight_at) is not null) as insight_generated,
    (coalesce(event_rollup.budget_created_at, budget_rollup.first_budget_at) is not null) as budget_created,
    (
        event_rollup.alert_configured_at is not null
        or coalesce(budget_rollup.has_alert_configuration, false)
    ) as alert_configured,
    (
        (case when coalesce(event_rollup.provider_connected_at, connection_rollup.first_connected_at) is not null then 20 else 0 end)
        + (case when coalesce(event_rollup.usage_synced_at, usage_rollup.first_usage_at) is not null then 20 else 0 end)
        + (case when coalesce(event_rollup.insight_generated_at, recommendation_rollup.first_insight_at) is not null then 20 else 0 end)
        + (case when coalesce(event_rollup.budget_created_at, budget_rollup.first_budget_at) is not null then 20 else 0 end)
        + (case when event_rollup.alert_configured_at is not null or coalesce(budget_rollup.has_alert_configuration, false) then 20 else 0 end)
    )::integer as activation_score,
    (
        (
            (case when coalesce(event_rollup.provider_connected_at, connection_rollup.first_connected_at) is not null then 20 else 0 end)
            + (case when coalesce(event_rollup.usage_synced_at, usage_rollup.first_usage_at) is not null then 20 else 0 end)
            + (case when coalesce(event_rollup.insight_generated_at, recommendation_rollup.first_insight_at) is not null then 20 else 0 end)
            + (case when coalesce(event_rollup.budget_created_at, budget_rollup.first_budget_at) is not null then 20 else 0 end)
            + (case when event_rollup.alert_configured_at is not null or coalesce(budget_rollup.has_alert_configuration, false) then 20 else 0 end)
        ) >= 80
    ) as activated,
    greatest(
        coalesce(event_rollup.provider_connected_at, connection_rollup.first_connected_at),
        coalesce(event_rollup.usage_synced_at, usage_rollup.first_usage_at),
        coalesce(event_rollup.insight_generated_at, recommendation_rollup.first_insight_at),
        coalesce(event_rollup.budget_created_at, budget_rollup.first_budget_at),
        event_rollup.alert_configured_at
    ) as latest_activation_signal_at,
    case
        when (
            (case when coalesce(event_rollup.provider_connected_at, connection_rollup.first_connected_at) is not null then 20 else 0 end)
            + (case when coalesce(event_rollup.usage_synced_at, usage_rollup.first_usage_at) is not null then 20 else 0 end)
            + (case when coalesce(event_rollup.insight_generated_at, recommendation_rollup.first_insight_at) is not null then 20 else 0 end)
            + (case when coalesce(event_rollup.budget_created_at, budget_rollup.first_budget_at) is not null then 20 else 0 end)
            + (case when event_rollup.alert_configured_at is not null or coalesce(budget_rollup.has_alert_configuration, false) then 20 else 0 end)
        ) >= 80
        then greatest(
            coalesce(event_rollup.provider_connected_at, connection_rollup.first_connected_at),
            coalesce(event_rollup.usage_synced_at, usage_rollup.first_usage_at),
            coalesce(event_rollup.insight_generated_at, recommendation_rollup.first_insight_at),
            coalesce(event_rollup.budget_created_at, budget_rollup.first_budget_at),
            event_rollup.alert_configured_at
        )
        else null
    end as activated_at,
    case
        when coalesce(event_rollup.insight_generated_at, recommendation_rollup.first_insight_at) is null then null
        when coalesce(event_rollup.onboarding_completed_at, event_rollup.signup_at, profiles.created_at) is null then null
        else round(extract(epoch from (coalesce(event_rollup.insight_generated_at, recommendation_rollup.first_insight_at) - coalesce(event_rollup.onboarding_completed_at, event_rollup.signup_at, profiles.created_at))) / 3600.0, 2)
    end as time_to_value_hours
from public.accounts a
left join event_rollup
    on event_rollup.account_id = a.id
left join connection_rollup
    on connection_rollup.account_id = a.id
left join usage_rollup
    on usage_rollup.account_id = a.id
left join budget_rollup
    on budget_rollup.account_id = a.id
left join recommendation_rollup
    on recommendation_rollup.account_id = a.id
left join lateral (
    select min(p.created_at) as created_at
    from public.account_members am
    inner join public.profiles p
        on p.id = am.profile_id
    where am.account_id = a.id
) profiles on true;
grant select on public.account_activation_state to service_role;
create or replace view public.account_current_plan as
select
    a.id as account_id,
    coalesce(ap.current_plan_id, 'starter') as current_plan_id,
    coalesce(ap.plan_status, 'active') as plan_status,
    coalesce(ap.billing_provider, 'payu') as billing_provider,
    coalesce(ap.billing_interval, 'monthly') as billing_interval,
    ap.latest_transaction_id,
    ap.activated_at,
    ap.expires_at,
    ap.updated_at
from public.accounts a
left join public.account_plans ap
    on ap.account_id = a.id;
grant select on public.account_current_plan to service_role;
create or replace view public.account_dashboard_overview as
select
    a.id as account_id,
    a.name as account_name,
    spend.current_month_spend,
    spend.projected_month_end_spend,
    spend.average_daily_spend,
    spend.last_7_day_spend,
    spend.prior_7_day_spend,
    spend.usage_record_count,
    spend.last_usage_at,
    budget.budget_id,
    budget.budget_amount,
    budget.currency as budget_currency,
    budget.threshold_percentage,
    budget.budget_used_percentage,
    budget.projected_budget_used_percentage,
    budget.projected_budget_variance,
    budget.projected_overrun,
    activation.provider_connected,
    activation.usage_synced,
    activation.insight_generated,
    activation.budget_created,
    activation.alert_configured,
    activation.activation_score,
    activation.activated,
    activation.activated_at,
    activation.time_to_value_hours,
    plan.current_plan_id,
    plan.plan_status,
    plan.billing_provider,
    plan.billing_interval
from public.accounts a
left join public.account_spend_summary_current_month spend
    on spend.account_id = a.id
left join public.account_budget_status_current_month budget
    on budget.account_id = a.id
left join public.account_activation_state activation
    on activation.account_id = a.id
left join public.account_current_plan plan
    on plan.account_id = a.id;
grant select on public.account_dashboard_overview to service_role;
alter table public.qualification_evaluations
    drop constraint if exists qualification_evaluations_pql_check;
alter table public.qualification_evaluations
    add constraint qualification_evaluations_pql_check
        check (pql_status in ('insufficient_product_signals', 'product_qualified', 'product_activated'));
create or replace function public.evaluate_lead_qualification(
    p_lead_id bigint,
    p_evaluation_type text default 'runtime',
    p_source_runtime text default 'precrm_n8n'
) returns table (
    evaluation_id uuid,
    lead_id bigint,
    profile_id uuid,
    account_id uuid,
    fit_score integer,
    buying_intent text,
    mql_status text,
    sql_status text,
    pql_status text,
    crm_ready boolean,
    outbound_ready boolean,
    priority_score integer,
    priority_tier text,
    explanation text,
    evaluated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    s public.lead_qualification_signal_assembly%rowtype;
    activation public.account_activation_state%rowtype;
    v_rule_version text := 'phase6_v1';
    v_fit integer := 0;
    v_intent text := 'low';
    v_disqualified boolean := false;
    v_marketing_signal boolean := false;
    v_product_signal boolean := false;
    v_inbound_or_partner_signal boolean := false;
    v_mql_status text := 'nurture';
    v_sql_status text := 'nurture';
    v_pql_status text := 'insufficient_product_signals';
    v_crm_ready boolean := false;
    v_outbound_ready boolean := false;
    v_priority_score integer := 0;
    v_priority_tier text := 'low';
    v_explanation text := '';
    v_evaluation_reasons jsonb := '{}'::jsonb;
    v_engagement_summary jsonb := '{}'::jsonb;
    v_product_summary jsonb := '{}'::jsonb;
    v_acquisition_summary jsonb := '{}'::jsonb;
    v_evaluation_id uuid;
begin
    select *
    into s
    from public.lead_qualification_signal_assembly
    where lead_qualification_signal_assembly.lead_id = p_lead_id;

    if not found then
        raise exception 'lead_not_found';
    end if;

    if p_evaluation_type not in ('runtime', 'verification_failed', 'jurisdiction_blocked', 'score_update', 'outbound_ready', 'outreach_sent', 'nurture_sent', 'deal_created') then
        raise exception 'invalid_evaluation_type';
    end if;

    if p_source_runtime not in ('precrm_n8n', 'reply_deal_workflow', 'system') then
        raise exception 'invalid_source_runtime';
    end if;

    if s.account_id is not null then
        select *
        into activation
        from public.account_activation_state
        where account_activation_state.account_id = s.account_id;
    end if;

    v_fit := greatest(0, least(coalesce(s.icp_score, 0), 100));
    v_intent := case
        when s.buying_intent in ('high', 'medium', 'low') then s.buying_intent
        else 'low'
    end;

    v_disqualified := coalesce(s.lead_status, 'new') in ('disqualified', 'unverified')
        or coalesce(s.verification_failed_count, 0) > 0
        or coalesce(s.blocked_jurisdiction_count, 0) > 0;

    v_inbound_or_partner_signal := coalesce(s.acquisition_channel, 'inbound') in ('inbound', 'partner', 'creator', 'referral');
    v_product_signal := coalesce(s.onboarding_completed_count, 0) > 0
        or s.onboarding_completed_at is not null
        or coalesce(s.dashboard_viewed_count, 0) > 0
        or coalesce(activation.provider_connected, false)
        or coalesce(activation.usage_synced, false)
        or coalesce(activation.insight_generated, false);
    v_marketing_signal := v_inbound_or_partner_signal
        or v_product_signal
        or coalesce(s.acquisition_interaction_count, 0) > 0;

    if coalesce(activation.provider_connected, false)
        and coalesce(activation.usage_synced, false)
        and coalesce(activation.insight_generated, false)
    then
        if coalesce(activation.activation_score, 0) >= 80 then
            v_pql_status := 'product_activated';
        else
            v_pql_status := 'product_qualified';
        end if;
    end if;

    if v_disqualified then
        v_mql_status := 'disqualified';
    elsif v_fit >= 70 then
        v_mql_status := 'qualified';
    elsif v_fit >= 60 and v_intent = 'high' then
        v_mql_status := 'qualified';
    elsif v_fit >= 55 and v_intent in ('high', 'medium') and v_marketing_signal then
        v_mql_status := 'qualified';
    else
        v_mql_status := 'nurture';
    end if;

    v_crm_ready := not v_disqualified
        and coalesce(s.source_type, 'inbound') <> 'outbound_scraped'
        and v_fit >= 70;

    v_outbound_ready := not v_disqualified
        and coalesce(s.source_type, 'inbound') = 'outbound_scraped'
        and (
            coalesce(s.lead_status, '') in ('ready_to_push', 'emailed')
            or coalesce(s.ready_to_push_count, 0) > 0
        );

    if v_disqualified then
        v_sql_status := 'disqualified';
    elsif coalesce(s.outreach_reply_count, 0) > 0 or coalesce(s.outreach_deal_count, 0) > 0 or coalesce(s.outreach_deal_event_count, 0) > 0 then
        v_sql_status := 'sales_ready';
    elsif v_crm_ready or v_outbound_ready then
        v_sql_status := 'sales_ready';
    elsif v_mql_status = 'qualified' then
        v_sql_status := 'awaiting_engagement';
    else
        v_sql_status := 'nurture';
    end if;

    v_priority_score := v_fit;
    v_priority_score := v_priority_score
        + case v_intent when 'high' then 15 when 'medium' then 8 else 0 end
        + case when coalesce(s.outreach_reply_count, 0) > 0 then 12 else 0 end
        + case when coalesce(s.outreach_deal_count, 0) > 0 or coalesce(s.outreach_deal_event_count, 0) > 0 then 8 else 0 end
        + case when v_outbound_ready then 6 else 0 end
        + case when coalesce(s.acquisition_channel, '') in ('partner', 'referral') then 4 else 0 end
        + case when v_product_signal then 4 else 0 end
        + case when v_pql_status = 'product_qualified' then 6 when v_pql_status = 'product_activated' then 10 else 0 end
        + case when coalesce(s.nurture_email_count, 0) > 0 then 2 else 0 end;

    if v_disqualified then
        v_priority_score := least(v_priority_score, 20);
    end if;
    v_priority_score := greatest(0, least(v_priority_score, 100));

    if v_sql_status = 'sales_ready' and (coalesce(s.outreach_reply_count, 0) > 0 or coalesce(s.outreach_deal_count, 0) > 0 or v_intent = 'high') then
        v_priority_tier := 'urgent';
    elsif v_priority_score >= 80 then
        v_priority_tier := 'high';
    elsif v_priority_score >= 60 then
        v_priority_tier := 'medium';
    else
        v_priority_tier := 'low';
    end if;

    v_evaluation_reasons := jsonb_strip_nulls(jsonb_build_object(
        'rule_version', v_rule_version,
        'fit_band', case when v_fit >= 70 then 'strong' when v_fit >= 55 then 'moderate' else 'low' end,
        'intent', v_intent,
        'lead_status', s.lead_status,
        'source_type', s.source_type,
        'mql_driver', case
            when v_disqualified then 'blocked'
            when v_fit >= 70 then 'strong_fit'
            when v_fit >= 60 and v_intent = 'high' then 'high_intent_fit'
            when v_fit >= 55 and v_intent in ('high', 'medium') and v_marketing_signal then 'fit_intent_with_signal'
            else 'insufficient_fit_or_signal'
        end,
        'sql_driver', case
            when v_disqualified then 'blocked'
            when coalesce(s.outreach_reply_count, 0) > 0 or coalesce(s.outreach_deal_count, 0) > 0 or coalesce(s.outreach_deal_event_count, 0) > 0 then 'reply_or_deal'
            when v_crm_ready then 'crm_ready'
            when v_outbound_ready then 'outbound_ready'
            when v_mql_status = 'qualified' then 'awaiting_engagement'
            else 'nurture'
        end,
        'pql_driver', case
            when v_pql_status = 'product_activated' then 'activation_score_80_plus'
            when v_pql_status = 'product_qualified' then 'core_value_chain_complete'
            else 'insufficient_product_signals'
        end,
        'future_pql_required_events', jsonb_build_array('provider_connected', 'usage_synced', 'insight_generated', 'budget_created', 'alert_configured')
    ));

    v_engagement_summary := jsonb_strip_nulls(jsonb_build_object(
        'lead_event_count', coalesce(s.lead_event_count, 0),
        'nurture_email_count', coalesce(s.nurture_email_count, 0),
        'ready_to_push_count', coalesce(s.ready_to_push_count, 0),
        'outbound_gate_fail_count', coalesce(s.outbound_gate_fail_count, 0),
        'outreach_count', coalesce(s.outreach_count, 0),
        'outreach_sent_count', coalesce(s.outreach_sent_count, 0),
        'outreach_reply_count', coalesce(s.outreach_reply_count, 0),
        'outreach_deal_count', coalesce(s.outreach_deal_count, 0),
        'last_lead_event_at', s.last_lead_event_at,
        'last_outreach_sent_at', s.last_outreach_sent_at,
        'last_reply_received_at', s.last_reply_received_at
    ));

    v_product_summary := jsonb_strip_nulls(jsonb_build_object(
        'product_event_count', coalesce(s.product_event_count, 0),
        'signup_count', coalesce(s.signup_count, 0),
        'login_count', coalesce(s.login_count, 0),
        'onboarding_started_count', coalesce(s.onboarding_started_count, 0),
        'onboarding_completed_count', coalesce(s.onboarding_completed_count, 0),
        'dashboard_viewed_count', coalesce(s.dashboard_viewed_count, 0),
        'onboarding_company_size', s.onboarding_company_size,
        'onboarding_provider_count', s.onboarding_provider_count,
        'onboarding_estimated_monthly_spend', s.onboarding_estimated_monthly_spend,
        'account_onboarding_status', s.onboarding_status,
        'last_product_event_at', s.last_product_event_at,
        'provider_connected', coalesce(activation.provider_connected, false),
        'usage_synced', coalesce(activation.usage_synced, false),
        'insight_generated', coalesce(activation.insight_generated, false),
        'budget_created', coalesce(activation.budget_created, false),
        'alert_configured', coalesce(activation.alert_configured, false),
        'activation_score', coalesce(activation.activation_score, 0),
        'activated', coalesce(activation.activated, false),
        'activated_at', activation.activated_at,
        'time_to_value_hours', activation.time_to_value_hours
    ));

    v_acquisition_summary := jsonb_strip_nulls(jsonb_build_object(
        'channel', s.acquisition_channel,
        'source', s.acquisition_source,
        'campaign', s.acquisition_campaign,
        'first_touch_channel', s.first_touch_channel,
        'last_touch_channel', s.last_touch_channel,
        'latest_interaction_channel', s.latest_interaction_channel,
        'touch_count', coalesce(s.acquisition_touch_count, 0),
        'interaction_count', coalesce(s.acquisition_interaction_count, 0),
        'channels_seen', coalesce(to_jsonb(s.acquisition_channels_seen), '[]'::jsonb),
        'sources_seen', coalesce(to_jsonb(s.acquisition_sources_seen), '[]'::jsonb),
        'campaigns_seen', coalesce(to_jsonb(s.acquisition_campaigns_seen), '[]'::jsonb),
        'partner_id', s.partner_id,
        'creator_id', s.creator_id,
        'referral_id', s.referral_id
    ));

    v_explanation := case
        when v_disqualified then 'Lead is blocked from qualification because verification or jurisdiction signals mark it disqualified.'
        when v_sql_status = 'sales_ready' and coalesce(s.outreach_reply_count, 0) > 0 then 'Lead is SQL because it replied after outbound engagement.'
        when v_sql_status = 'sales_ready' and v_outbound_ready then 'Lead is SQL because it passed the outbound readiness gate after strong fit scoring.'
        when v_sql_status = 'sales_ready' and v_crm_ready then 'Lead is SQL because it is a verified inbound-style lead with strong ICP fit and existing CRM readiness.'
        when v_pql_status = 'product_activated' then 'Lead is product-qualified because the connected account completed the core value chain and reached the activation threshold.'
        when v_pql_status = 'product_qualified' then 'Lead is product-qualified because the connected account completed provider connection, usage sync, and first insight generation.'
        when v_mql_status = 'qualified' then 'Lead is MQL because fit and intent meet the formal marketing-qualified threshold, but it still needs stronger sales engagement.'
        else 'Lead remains in nurture because current fit, intent, engagement, and product signals do not justify stronger qualification.'
    end;

    insert into public.qualification_evaluations (
        lead_id,
        profile_id,
        account_id,
        evaluation_type,
        source_runtime,
        rule_version,
        fit_score,
        buying_intent,
        acquisition_channel,
        acquisition_source,
        acquisition_campaign,
        lead_status,
        mql_status,
        sql_status,
        pql_status,
        crm_ready,
        outbound_ready,
        priority_score,
        priority_tier,
        explanation,
        evaluation_reasons,
        engagement_summary,
        product_summary,
        acquisition_summary,
        evaluated_at
    ) values (
        s.lead_id,
        s.profile_id,
        s.account_id,
        p_evaluation_type,
        p_source_runtime,
        v_rule_version,
        v_fit,
        s.buying_intent,
        s.acquisition_channel,
        s.acquisition_source,
        s.acquisition_campaign,
        s.lead_status,
        v_mql_status,
        v_sql_status,
        v_pql_status,
        v_crm_ready,
        v_outbound_ready,
        v_priority_score,
        v_priority_tier,
        v_explanation,
        v_evaluation_reasons,
        v_engagement_summary,
        v_product_summary,
        v_acquisition_summary,
        now()
    )
    returning id, qualification_evaluations.evaluated_at
    into v_evaluation_id, evaluated_at;

    evaluation_id := v_evaluation_id;
    lead_id := s.lead_id;
    profile_id := s.profile_id;
    account_id := s.account_id;
    fit_score := v_fit;
    buying_intent := s.buying_intent;
    mql_status := v_mql_status;
    sql_status := v_sql_status;
    pql_status := v_pql_status;
    crm_ready := v_crm_ready;
    outbound_ready := v_outbound_ready;
    priority_score := v_priority_score;
    priority_tier := v_priority_tier;
    explanation := v_explanation;

    return next;
end;
$$;
grant execute on function public.evaluate_lead_qualification(bigint, text, text) to service_role;
