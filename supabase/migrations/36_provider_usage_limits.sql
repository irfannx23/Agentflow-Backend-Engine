-- CostPilot Phase 12 — Provider management usage limits
-- Stores non-secret provider quota/allowance rules. Actual credentials remain
-- server-side and usage is calculated from public.usage_records.

create extension if not exists pgcrypto;
create table if not exists public.provider_usage_limits (
    id                     uuid primary key default gen_random_uuid(),
    account_id             uuid not null references public.accounts (id) on delete cascade,
    provider_connection_id uuid not null references public.provider_connections (id) on delete cascade,
    limit_type             text not null,
    limit_amount           numeric(18, 6) not null,
    limit_period           text not null,
    threshold_percentage   integer not null default 70,
    enabled                boolean not null default true,
    metadata               jsonb not null default '{}'::jsonb,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    constraint provider_usage_limits_type_check
        check (limit_type in ('tokens', 'requests', 'cost_credits')),
    constraint provider_usage_limits_period_check
        check (limit_period in ('daily', 'weekly', 'monthly')),
    constraint provider_usage_limits_amount_check
        check (limit_amount > 0),
    constraint provider_usage_limits_threshold_check
        check (threshold_percentage >= 1 and threshold_percentage <= 100),
    constraint provider_usage_limits_metadata_object_check
        check (jsonb_typeof(metadata) = 'object')
);
create unique index if not exists provider_usage_limits_unique_active_rule_idx
    on public.provider_usage_limits (account_id, provider_connection_id, limit_type, limit_period);
create index if not exists provider_usage_limits_account_enabled_idx
    on public.provider_usage_limits (account_id, enabled, limit_period);
drop trigger if exists provider_usage_limits_set_updated_at on public.provider_usage_limits;
create trigger provider_usage_limits_set_updated_at
    before update on public.provider_usage_limits
    for each row
    execute function public.set_updated_at();
alter table public.provider_usage_limits enable row level security;
drop policy if exists "service_role_all_provider_usage_limits" on public.provider_usage_limits;
create policy "service_role_all_provider_usage_limits"
    on public.provider_usage_limits
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.provider_usage_limits to service_role;
