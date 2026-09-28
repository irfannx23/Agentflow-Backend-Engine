-- ============================================
-- CostPilot Phase 3.2 — Unified acquisition attribution persistence
-- ============================================
-- This migration adds one shared acquisition touch history table for
-- inbound, PLG, outbound, partner, creator, and referral attribution.

create table if not exists public.acquisition_touches (
    id            uuid primary key default gen_random_uuid(),
    profile_id    uuid references public.profiles (id) on delete set null,
    account_id    uuid references public.accounts (id) on delete set null,
    lead_id       bigint references public.staged_leads (id) on delete set null,
    firebase_uid  text,
    channel       text not null,
    source        text,
    source_id     text,
    medium        text,
    campaign      text,
    referrer      text,
    utm_source    text,
    utm_medium    text,
    utm_campaign  text,
    utm_content   text,
    utm_term      text,
    partner_id    text,
    creator_id    text,
    referral_id   text,
    touch_type    text not null,
    identity_key  text generated always as (
        coalesce(
            profile_id::text,
            firebase_uid,
            case when lead_id is not null then 'lead:' || lead_id::text else null end,
            case when source_id is not null then 'source:' || source_id else null end
        )
    ) stored,
    occurred_at   timestamptz not null default now(),
    metadata      jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now(),
    constraint acquisition_touches_channel_check
        check (channel in ('inbound', 'plg', 'outbound', 'partner', 'creator', 'referral')),
    constraint acquisition_touches_touch_type_check
        check (touch_type in ('first_touch', 'last_touch', 'interaction')),
    constraint acquisition_touches_identity_key_required
        check (identity_key is not null),
    constraint acquisition_touches_metadata_object_check
        check (jsonb_typeof(metadata) = 'object')
);
create index if not exists acquisition_touches_profile_occurred_at_idx
    on public.acquisition_touches (profile_id, occurred_at desc);
create index if not exists acquisition_touches_account_occurred_at_idx
    on public.acquisition_touches (account_id, occurred_at desc);
create index if not exists acquisition_touches_lead_occurred_at_idx
    on public.acquisition_touches (lead_id, occurred_at desc);
create index if not exists acquisition_touches_firebase_uid_occurred_at_idx
    on public.acquisition_touches (firebase_uid, occurred_at desc);
create index if not exists acquisition_touches_identity_occurred_at_idx
    on public.acquisition_touches (identity_key, occurred_at desc);
create index if not exists acquisition_touches_touch_type_occurred_at_idx
    on public.acquisition_touches (touch_type, occurred_at desc);
create unique index if not exists acquisition_touches_first_touch_identity_uidx
    on public.acquisition_touches (identity_key)
    where touch_type = 'first_touch';
create unique index if not exists acquisition_touches_last_touch_identity_uidx
    on public.acquisition_touches (identity_key)
    where touch_type = 'last_touch';
alter table public.acquisition_touches enable row level security;
drop policy if exists "service_role_all_acquisition_touches" on public.acquisition_touches;
create policy "service_role_all_acquisition_touches"
    on public.acquisition_touches
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.acquisition_touches to service_role;
