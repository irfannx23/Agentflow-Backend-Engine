-- ============================================
-- CostPilot Phase 3.3 — Existing lead-engine acquisition touch capture
-- ============================================
-- Reuse the existing Pre-CRM lead persistence point so inbound and outbound
-- leads automatically create unified acquisition_touches rows without a
-- workflow redesign.

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
    v_channel := case when coalesce(p_source_type, 'inbound') = 'outbound_scraped' then 'outbound' else 'inbound' end;

    if v_channel = 'outbound' then
        v_source := left(
            regexp_replace(
                lower(
                    coalesce(
                        nullif(btrim(v_payload->>'source'), ''),
                        'scraper'
                    )
                ),
                '[^a-z0-9]+',
                '_',
                'g'
            ),
            120
        );
        v_source_id := left(
            coalesce(
                nullif(btrim(v_payload->>'source_id'), ''),
                v_email_domain,
                nullif(btrim(v_payload->>'url'), ''),
                nullif(btrim(p_email), '')
            ),
            160
        );
        v_medium := left(
            regexp_replace(
                lower(
                    coalesce(
                        nullif(btrim(v_payload->>'medium'), ''),
                        'signal_outbound'
                    )
                ),
                '[^a-z0-9]+',
                '_',
                'g'
            ),
            120
        );
        v_campaign := left(
            regexp_replace(
                lower(
                    coalesce(
                        nullif(btrim(v_payload->>'campaign'), ''),
                        nullif(btrim(v_payload->>'utm_campaign'), '')
                    )
                ),
                '[^a-z0-9]+',
                '_',
                'g'
            ),
            120
        );
        v_referrer := left(
            coalesce(
                nullif(btrim(v_payload->>'referrer'), ''),
                nullif(btrim(v_payload->>'url'), '')
            ),
            512
        );
    else
        v_source := left(
            regexp_replace(
                lower(
                    coalesce(
                        nullif(btrim(v_payload->>'source'), ''),
                        nullif(btrim(v_payload->>'form'), ''),
                        'website'
                    )
                ),
                '[^a-z0-9]+',
                '_',
                'g'
            ),
            120
        );
        v_source_id := left(
            coalesce(
                nullif(btrim(v_payload->>'source_id'), ''),
                nullif(btrim(v_payload->>'form_id'), ''),
                nullif(btrim(p_event_id), '')
            ),
            160
        );
        v_medium := left(
            regexp_replace(
                lower(
                    coalesce(
                        nullif(btrim(v_payload->>'medium'), ''),
                        nullif(btrim(v_payload->>'form'), ''),
                        nullif(btrim(v_payload->>'channel'), ''),
                        'web_form'
                    )
                ),
                '[^a-z0-9]+',
                '_',
                'g'
            ),
            120
        );
        v_campaign := left(
            regexp_replace(
                lower(
                    coalesce(
                        nullif(btrim(v_payload->>'campaign'), ''),
                        nullif(btrim(v_payload->>'utm_campaign'), '')
                    )
                ),
                '[^a-z0-9]+',
                '_',
                'g'
            ),
            120
        );
        v_referrer := left(
            coalesce(
                nullif(btrim(v_payload->>'referrer'), ''),
                nullif(btrim(v_payload->>'referer'), ''),
                nullif(btrim(v_payload->>'referrer_url'), '')
            ),
            512
        );
    end if;

    v_utm_source := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'utm_source'), ''), '')), '[^a-z0-9]+', '_', 'g'), 120);
    v_utm_medium := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'utm_medium'), ''), '')), '[^a-z0-9]+', '_', 'g'), 120);
    v_utm_campaign := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'utm_campaign'), ''), '')), '[^a-z0-9]+', '_', 'g'), 120);
    v_utm_content := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'utm_content'), ''), '')), '[^a-z0-9]+', '_', 'g'), 120);
    v_utm_term := left(regexp_replace(lower(coalesce(nullif(btrim(v_payload->>'utm_term'), ''), '')), '[^a-z0-9]+', '_', 'g'), 120);
    v_partner_id := left(nullif(btrim(v_payload->>'partner_id'), ''), 160);
    v_creator_id := left(nullif(btrim(v_payload->>'creator_id'), ''), 160);
    v_referral_id := left(nullif(btrim(v_payload->>'referral_id'), ''), 160);

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
        lead_id,
        channel,
        source,
        source_id,
        medium,
        campaign,
        referrer,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        partner_id,
        creator_id,
        referral_id,
        touch_type,
        occurred_at,
        metadata
    ) values (
        p_lead_id,
        v_channel,
        nullif(v_source, ''),
        nullif(v_source_id, ''),
        nullif(v_medium, ''),
        nullif(v_campaign, ''),
        nullif(v_referrer, ''),
        nullif(v_utm_source, ''),
        nullif(v_utm_medium, ''),
        nullif(v_utm_campaign, ''),
        nullif(v_utm_content, ''),
        nullif(v_utm_term, ''),
        nullif(v_partner_id, ''),
        nullif(v_creator_id, ''),
        nullif(v_referral_id, ''),
        'first_touch',
        v_occurred_at,
        v_metadata
    )
    on conflict (identity_key) where touch_type = 'first_touch'
    do nothing;

    insert into public.acquisition_touches (
        lead_id,
        channel,
        source,
        source_id,
        medium,
        campaign,
        referrer,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        partner_id,
        creator_id,
        referral_id,
        touch_type,
        occurred_at,
        metadata
    ) values (
        p_lead_id,
        v_channel,
        nullif(v_source, ''),
        nullif(v_source_id, ''),
        nullif(v_medium, ''),
        nullif(v_campaign, ''),
        nullif(v_referrer, ''),
        nullif(v_utm_source, ''),
        nullif(v_utm_medium, ''),
        nullif(v_utm_campaign, ''),
        nullif(v_utm_content, ''),
        nullif(v_utm_term, ''),
        nullif(v_partner_id, ''),
        nullif(v_creator_id, ''),
        nullif(v_referral_id, ''),
        'last_touch',
        v_occurred_at,
        v_metadata
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
        lead_id,
        channel,
        source,
        source_id,
        medium,
        campaign,
        referrer,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        partner_id,
        creator_id,
        referral_id,
        touch_type,
        occurred_at,
        metadata
    ) values (
        p_lead_id,
        v_channel,
        nullif(v_source, ''),
        nullif(v_source_id, ''),
        nullif(v_medium, ''),
        nullif(v_campaign, ''),
        nullif(v_referrer, ''),
        nullif(v_utm_source, ''),
        nullif(v_utm_medium, ''),
        nullif(v_utm_campaign, ''),
        nullif(v_utm_content, ''),
        nullif(v_utm_term, ''),
        nullif(v_partner_id, ''),
        nullif(v_creator_id, ''),
        nullif(v_referral_id, ''),
        'interaction',
        v_occurred_at,
        v_metadata
    );
end;
$$;
drop function if exists public.get_or_create_lead(text, text, text, jsonb, jsonb, text, text);
create function public.get_or_create_lead(
    p_event_id text,
    p_email text,
    p_company_name text,
    p_raw_payload jsonb,
    p_firmographics jsonb,
    p_source_type text default 'inbound',
    p_ip text default null
) returns table (lead_id bigint, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lead_id bigint;
    v_is_new boolean;
begin
    insert into public.staged_leads (event_id, email, company_name, raw_payload, firmographics, status, source_type, ip)
    values (p_event_id, lower(p_email), p_company_name, p_raw_payload, p_firmographics, 'new', p_source_type, p_ip)
    on conflict (lower(email)) do nothing
    returning id into v_lead_id;

    if v_lead_id is null then
        select id into v_lead_id
        from public.staged_leads
        where lower(email) = lower(p_email)
        order by id
        limit 1;
        v_is_new := false;
    else
        v_is_new := true;
    end if;

    perform public.capture_lead_acquisition_touches(
        p_lead_id => v_lead_id,
        p_event_id => p_event_id,
        p_source_type => p_source_type,
        p_raw_payload => p_raw_payload,
        p_email => p_email
    );

    return query select v_lead_id, v_is_new;
end;
$$;
grant execute on function public.capture_lead_acquisition_touches(bigint, text, text, jsonb, text) to service_role;
grant execute on function public.get_or_create_lead(text, text, text, jsonb, jsonb, text, text) to service_role;
