-- ============================================
-- CostPilot Phase 2.2 — Core customer/product schema
-- ============================================
-- This migration adds the new CostPilot user/account/event foundation
-- without modifying the existing Pre-CRM schema.

create extension if not exists pgcrypto;
-- ---------- 1. profiles ----------
create table if not exists public.profiles (
    id                uuid primary key default gen_random_uuid(),
    firebase_uid      text not null unique,
    email             text,
    display_name      text,
    photo_url         text,
    auth_provider     text,
    last_login_at     timestamptz,
    first_touch_source text,
    first_touch_medium text,
    first_touch_campaign text,
    first_touch_referrer text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
create index if not exists profiles_email_idx
    on public.profiles (email);
create index if not exists profiles_first_touch_source_idx
    on public.profiles (first_touch_source);
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
    before update on public.profiles
    for each row
    execute function public.set_updated_at();
alter table public.profiles enable row level security;
drop policy if exists "service_role_all_profiles" on public.profiles;
create policy "service_role_all_profiles"
    on public.profiles
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.profiles to service_role;
-- ---------- 2. accounts ----------
create table if not exists public.accounts (
    id                uuid primary key default gen_random_uuid(),
    name              text not null,
    slug              text unique,
    primary_domain    text,
    onboarding_status text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
create index if not exists accounts_primary_domain_idx
    on public.accounts (primary_domain);
create index if not exists accounts_onboarding_status_idx
    on public.accounts (onboarding_status);
drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
    before update on public.accounts
    for each row
    execute function public.set_updated_at();
alter table public.accounts enable row level security;
drop policy if exists "service_role_all_accounts" on public.accounts;
create policy "service_role_all_accounts"
    on public.accounts
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.accounts to service_role;
-- ---------- 3. account_members ----------
create table if not exists public.account_members (
    id          uuid primary key default gen_random_uuid(),
    account_id  uuid not null references public.accounts (id) on delete cascade,
    profile_id  uuid not null references public.profiles (id) on delete cascade,
    role        text not null default 'member',
    is_owner    boolean not null default false,
    created_at  timestamptz not null default now(),
    unique (account_id, profile_id)
);
create index if not exists account_members_account_id_idx
    on public.account_members (account_id);
create index if not exists account_members_profile_id_idx
    on public.account_members (profile_id);
create index if not exists account_members_is_owner_idx
    on public.account_members (account_id, is_owner);
alter table public.account_members enable row level security;
drop policy if exists "service_role_all_account_members" on public.account_members;
create policy "service_role_all_account_members"
    on public.account_members
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.account_members to service_role;
-- ---------- 4. onboarding_responses ----------
create table if not exists public.onboarding_responses (
    id                    uuid primary key default gen_random_uuid(),
    profile_id            uuid not null references public.profiles (id) on delete cascade,
    account_id            uuid references public.accounts (id) on delete set null,
    company_size          text,
    providers             jsonb not null default '[]'::jsonb,
    estimated_monthly_spend text,
    raw_answers           jsonb not null default '{}'::jsonb,
    completed_at          timestamptz,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);
create index if not exists onboarding_responses_profile_id_idx
    on public.onboarding_responses (profile_id);
create index if not exists onboarding_responses_account_id_idx
    on public.onboarding_responses (account_id);
create index if not exists onboarding_responses_completed_at_idx
    on public.onboarding_responses (completed_at desc);
drop trigger if exists onboarding_responses_set_updated_at on public.onboarding_responses;
create trigger onboarding_responses_set_updated_at
    before update on public.onboarding_responses
    for each row
    execute function public.set_updated_at();
alter table public.onboarding_responses enable row level security;
drop policy if exists "service_role_all_onboarding_responses" on public.onboarding_responses;
create policy "service_role_all_onboarding_responses"
    on public.onboarding_responses
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.onboarding_responses to service_role;
-- ---------- 5. product_events ----------
create table if not exists public.product_events (
    id               bigint generated always as identity primary key,
    account_id       uuid references public.accounts (id) on delete set null,
    profile_id       uuid references public.profiles (id) on delete set null,
    firebase_uid     text,
    event_name       text not null,
    event_source     text,
    event_properties jsonb not null default '{}'::jsonb,
    created_at       timestamptz not null default now()
);
create index if not exists product_events_account_created_at_idx
    on public.product_events (account_id, created_at desc);
create index if not exists product_events_profile_created_at_idx
    on public.product_events (profile_id, created_at desc);
create index if not exists product_events_event_name_created_at_idx
    on public.product_events (event_name, created_at desc);
create index if not exists product_events_firebase_uid_created_at_idx
    on public.product_events (firebase_uid, created_at desc);
alter table public.product_events enable row level security;
drop policy if exists "service_role_all_product_events" on public.product_events;
create policy "service_role_all_product_events"
    on public.product_events
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.product_events to service_role;
grant usage, select on all sequences in schema public to service_role;
