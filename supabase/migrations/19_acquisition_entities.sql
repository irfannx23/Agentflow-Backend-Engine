-- ============================================
-- CostPilot Phase 3.4 — Partner / Creator / Referral acquisition entities
-- ============================================
-- Adds the minimum entity models required for partner, creator, and referral
-- acquisition while preserving the unified acquisition_touches architecture.

create table if not exists public.acquisition_partners (
    partner_id         text primary key,
    name               text not null,
    partner_type       text not null,
    status             text not null default 'active',
    source_identifier  text,
    default_campaign   text,
    metadata           jsonb not null default '{}'::jsonb,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    constraint acquisition_partners_type_check
        check (partner_type in ('agency', 'consultant')),
    constraint acquisition_partners_status_check
        check (status in ('active', 'inactive', 'paused')),
    constraint acquisition_partners_metadata_object_check
        check (jsonb_typeof(metadata) = 'object')
);
create index if not exists acquisition_partners_type_idx
    on public.acquisition_partners (partner_type);
drop trigger if exists acquisition_partners_set_updated_at on public.acquisition_partners;
create trigger acquisition_partners_set_updated_at
    before update on public.acquisition_partners
    for each row
    execute function public.set_updated_at();
alter table public.acquisition_partners enable row level security;
drop policy if exists "service_role_all_acquisition_partners" on public.acquisition_partners;
create policy "service_role_all_acquisition_partners"
    on public.acquisition_partners
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.acquisition_partners to service_role;
create table if not exists public.acquisition_creators (
    creator_id         text primary key,
    name               text not null,
    platform           text not null,
    status             text not null default 'active',
    source_identifier  text,
    default_campaign   text,
    metadata           jsonb not null default '{}'::jsonb,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    constraint acquisition_creators_platform_check
        check (platform in ('youtube', 'linkedin', 'newsletter', 'podcast')),
    constraint acquisition_creators_status_check
        check (status in ('active', 'inactive', 'paused')),
    constraint acquisition_creators_metadata_object_check
        check (jsonb_typeof(metadata) = 'object')
);
create index if not exists acquisition_creators_platform_idx
    on public.acquisition_creators (platform);
drop trigger if exists acquisition_creators_set_updated_at on public.acquisition_creators;
create trigger acquisition_creators_set_updated_at
    before update on public.acquisition_creators
    for each row
    execute function public.set_updated_at();
alter table public.acquisition_creators enable row level security;
drop policy if exists "service_role_all_acquisition_creators" on public.acquisition_creators;
create policy "service_role_all_acquisition_creators"
    on public.acquisition_creators
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.acquisition_creators to service_role;
create table if not exists public.acquisition_referrals (
    referral_id            text primary key,
    referral_code          text not null unique,
    referring_profile_id   uuid references public.profiles (id) on delete set null,
    referring_account_id   uuid references public.accounts (id) on delete set null,
    referring_partner_id   text references public.acquisition_partners (partner_id) on delete set null,
    status                 text not null default 'active',
    metadata               jsonb not null default '{}'::jsonb,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    constraint acquisition_referrals_status_check
        check (status in ('active', 'inactive', 'redeemed')),
    constraint acquisition_referrals_metadata_object_check
        check (jsonb_typeof(metadata) = 'object')
);
create index if not exists acquisition_referrals_profile_idx
    on public.acquisition_referrals (referring_profile_id);
create index if not exists acquisition_referrals_account_idx
    on public.acquisition_referrals (referring_account_id);
create index if not exists acquisition_referrals_partner_idx
    on public.acquisition_referrals (referring_partner_id);
drop trigger if exists acquisition_referrals_set_updated_at on public.acquisition_referrals;
create trigger acquisition_referrals_set_updated_at
    before update on public.acquisition_referrals
    for each row
    execute function public.set_updated_at();
alter table public.acquisition_referrals enable row level security;
drop policy if exists "service_role_all_acquisition_referrals" on public.acquisition_referrals;
create policy "service_role_all_acquisition_referrals"
    on public.acquisition_referrals
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.acquisition_referrals to service_role;
create or replace function public.capture_lead_acquisition_touches(
    p_lead_id bigint,
    p_event_id text,
    p_source_type text default 'inbound',
    p_raw_payload jsonb default '{}'::jsonb,
    p_email text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_payload jsonb := coalesce(p_raw_payload, '{}'::jsonb);
    v_channel text;
    v_email_domain text;
    v_source text;
    v_source_id text;
    v_medium text;
    v_campaign text;
    v_referrer text;
    v_utm_source text;
    v_utm_medium text;
    v_utm_campaign text;
    v_utm_content text;
    v_utm_term text;
    v_partner_id text;
    v_creator_id text;
    v_referral_id text;
    v_metadata jsonb;
    v_occurred_at timestamptz := now();
begin
    if p_lead_id is null then
        raise exception 'lead_id_required';
    end if;

    v_email_domain := nullif(split_part(lower(coalesce(p_email, '')), '@', 2), '');
    v_partner_id := left(nullif(btrim(v_payload->>'partner_id'), ''), 160);
    v_creator_id := left(nullif(btrim(v_payload->>'creator_id'), ''), 160);
    v_referral_id := left(nullif(btrim(v_payload->>'referral_id'), ''), 160);
    v_channel := case
        when v_referral_id is not null then 'referral'
        when v_creator_id is not null then 'creator'
        when v_partner_id is not null then 'partner'
        when coalesce(p_source_type, 'inbound') = 'outbound_scraped' then 'outbound'
        else 'inbound'
    end;

    if v_channel = 'outbound' then
        v_source := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'source'), ''), 'scraper')), '[^a-z0-9]+', '_', 'g'), 120);
        v_source_id := left(coalesce(nullif(btrim(v_payload->>'source_id'), ''), v_email_domain, nullif(btrim(v_payload->>'url'), ''), nullif(btrim(p_email), '')), 160);
        v_medium := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'medium'), ''), 'signal_outbound')), '[^a-z0-9]+', '_', 'g'), 120);
    elsif v_channel = 'partner' then
        v_source := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'source'), ''), 'agency')), '[^a-z0-9]+', '_', 'g'), 120);
        v_source_id := left(coalesce(nullif(btrim(v_payload->>'source_id'), ''), v_partner_id), 160);
        v_medium := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'medium'), ''), 'partner')), '[^a-z0-9]+', '_', 'g'), 120);
    elsif v_channel = 'creator' then
        v_source := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'source'), ''), 'youtube')), '[^a-z0-9]+', '_', 'g'), 120);
        v_source_id := left(coalesce(nullif(btrim(v_payload->>'source_id'), ''), v_creator_id), 160);
        v_medium := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'medium'), ''), 'creator')), '[^a-z0-9]+', '_', 'g'), 120);
    elsif v_channel = 'referral' then
        v_source := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'source'), ''), 'customer_referral')), '[^a-z0-9]+', '_', 'g'), 120);
        v_source_id := left(coalesce(nullif(btrim(v_payload->>'source_id'), ''), v_referral_id), 160);
        v_medium := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'medium'), ''), 'referral')), '[^a-z0-9]+', '_', 'g'), 120);
    else
        v_source := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'source'), ''), nullif(btrim(v_payload->>'form'), ''), 'website')), '[^a-z0-9]+', '_', 'g'), 120);
        v_source_id := left(coalesce(nullif(btrim(v_payload->>'source_id'), ''), nullif(btrim(v_payload->>'form_id'), ''), nullif(btrim(p_event_id), '')), 160);
        v_medium := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'medium'), ''), nullif(btrim(v_payload->>'form'), ''), nullif(btrim(v_payload->>'channel'), ''), 'web_form')), '[^a-z0-9]+', '_', 'g'), 120);
    end if;

    v_campaign := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'campaign'), ''), nullif(btrim(v_payload->>'utm_campaign'), ''), '')), '[^a-z0-9]+', '_', 'g'), 120);
    v_referrer := left(coalesce(nullif(btrim(v_payload->>'referrer'), ''), nullif(btrim(v_payload->>'referer'), ''), nullif(btrim(v_payload->>'referrer_url'), ''), nullif(btrim(v_payload->>'url'), '')), 512);
    v_utm_source := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'utm_source'), ''), '')), '[^a-z0-9]+', '_', 'g'), 120);
    v_utm_medium := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'utm_medium'), ''), '')), '[^a-z0-9]+', '_', 'g'), 120);
    v_utm_campaign := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'utm_campaign'), ''), '')), '[^a-z0-9]+', '_', 'g'), 120);
    v_utm_content := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'utm_content'), ''), '')), '[^a-z0-9]+', '_', 'g'), 120);
    v_utm_term := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'utm_term'), ''), '')), '[^a-z0-9]+', '_', 'g'), 120);

    v_metadata := jsonb_strip_nulls(
        jsonb_build_object(
            'captured_via', 'get_or_create_lead',
            'event_id', nullif(btrim(p_event_id), ''),
            'source_type', nullif(btrim(p_source_type), ''),
            'form', nullif(btrim(v_payload->>'form'), ''),
            'origin', nullif(btrim(v_payload->>'origin'), ''),
            'url', nullif(btrim(v_payload->>'url'), '')
        )
    );

    insert into public.acquisition_touches (
        lead_id, channel, source, source_id, medium, campaign, referrer,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        partner_id, creator_id, referral_id, touch_type, occurred_at, metadata
    ) values (
        p_lead_id, v_channel, nullif(v_source, ''), nullif(v_source_id, ''), nullif(v_medium, ''), nullif(v_campaign, ''), nullif(v_referrer, ''),
        nullif(v_utm_source, ''), nullif(v_utm_medium, ''), nullif(v_utm_campaign, ''), nullif(v_utm_content, ''), nullif(v_utm_term, ''),
        nullif(v_partner_id, ''), nullif(v_creator_id, ''), nullif(v_referral_id, ''), 'first_touch', v_occurred_at, v_metadata
    )
    on conflict (identity_key) where touch_type = 'first_touch'
    do nothing;

    insert into public.acquisition_touches (
        lead_id, channel, source, source_id, medium, campaign, referrer,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        partner_id, creator_id, referral_id, touch_type, occurred_at, metadata
    ) values (
        p_lead_id, v_channel, nullif(v_source, ''), nullif(v_source_id, ''), nullif(v_medium, ''), nullif(v_campaign, ''), nullif(v_referrer, ''),
        nullif(v_utm_source, ''), nullif(v_utm_medium, ''), nullif(v_utm_campaign, ''), nullif(v_utm_content, ''), nullif(v_utm_term, ''),
        nullif(v_partner_id, ''), nullif(v_creator_id, ''), nullif(v_referral_id, ''), 'last_touch', v_occurred_at, v_metadata
    )
    on conflict (identity_key) where touch_type = 'last_touch'
    do update set
        channel = excluded.channel,
        source = excluded.source,
        source_id = excluded.source_id,
        medium = excluded.medium,
        campaign = excluded.campaign,
        referrer = excluded.referrer,
        utm_source = excluded.utm_source,
        utm_medium = excluded.utm_medium,
        utm_campaign = excluded.utm_campaign,
        utm_content = excluded.utm_content,
        utm_term = excluded.utm_term,
        partner_id = excluded.partner_id,
        creator_id = excluded.creator_id,
        referral_id = excluded.referral_id,
        occurred_at = excluded.occurred_at,
        metadata = excluded.metadata;

    insert into public.acquisition_touches (
        lead_id, channel, source, source_id, medium, campaign, referrer,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        partner_id, creator_id, referral_id, touch_type, occurred_at, metadata
    ) values (
        p_lead_id, v_channel, nullif(v_source, ''), nullif(v_source_id, ''), nullif(v_medium, ''), nullif(v_campaign, ''), nullif(v_referrer, ''),
        nullif(v_utm_source, ''), nullif(v_utm_medium, ''), nullif(v_utm_campaign, ''), nullif(v_utm_content, ''), nullif(v_utm_term, ''),
        nullif(v_partner_id, ''), nullif(v_creator_id, ''), nullif(v_referral_id, ''), 'interaction', v_occurred_at, v_metadata
    );
end;
$$;
