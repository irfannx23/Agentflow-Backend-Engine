-- ============================================
-- CostPilot Phase 3.5 — Attribution resolver + analytics foundation
-- ============================================
-- Builds explainable attribution and analytics-ready surfaces directly from
-- the existing unified acquisition_touches history.

grant execute on function public.capture_lead_acquisition_touches(bigint, text, text, jsonb, text) to service_role;
create or replace view public.acquisition_touch_lineage as
with stitched as (
    select
        t.id,
        t.profile_id,
        t.account_id,
        t.lead_id,
        t.firebase_uid,
        t.channel,
        t.source,
        t.source_id,
        t.medium,
        t.campaign,
        t.referrer,
        t.utm_source,
        t.utm_medium,
        t.utm_campaign,
        t.utm_content,
        t.utm_term,
        t.partner_id,
        t.creator_id,
        t.referral_id,
        t.touch_type,
        t.identity_key,
        t.occurred_at,
        t.metadata,
        t.created_at,
        sl.email as lead_email,
        sl.company_name as lead_company_name,
        sl.status as lead_status,
        sl.source_type as lead_source_type,
        matched_profile.id as matched_profile_id,
        matched_profile.firebase_uid as matched_profile_firebase_uid,
        matched_profile.email as matched_profile_email,
        matched_account.account_id as matched_account_id
    from public.acquisition_touches t
    left join public.staged_leads sl
        on sl.id = t.lead_id
    left join lateral (
        select
            p.id,
            p.firebase_uid,
            p.email,
            p.created_at
        from public.profiles p
        where (
            t.profile_id is not null
            and p.id = t.profile_id
        ) or (
            t.profile_id is null
            and sl.email is not null
            and p.email is not null
            and lower(p.email) = lower(sl.email)
        )
        order by
            case when t.profile_id is not null and p.id = t.profile_id then 0 else 1 end,
            p.created_at asc
        limit 1
    ) matched_profile on true
    left join lateral (
        select
            am.account_id,
            am.created_at,
            am.is_owner
        from public.account_members am
        where am.profile_id = coalesce(t.profile_id, matched_profile.id)
        order by am.is_owner desc, am.created_at asc
        limit 1
    ) matched_account on true
)
select
    id,
    profile_id,
    account_id,
    lead_id,
    firebase_uid,
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
    identity_key,
    occurred_at,
    metadata,
    created_at,
    lead_email,
    lead_company_name,
    lead_status,
    lead_source_type,
    coalesce(profile_id, matched_profile_id) as stitched_profile_id,
    coalesce(account_id, matched_account_id) as stitched_account_id,
    coalesce(
        coalesce(account_id, matched_account_id)::text,
        coalesce(profile_id, matched_profile_id)::text,
        firebase_uid,
        case when lead_id is not null then 'lead:' || lead_id::text else null end,
        case when source_id is not null then 'source:' || source_id else null end
    ) as resolved_identity_key,
    case
        when account_id is not null then 'direct_account_id'
        when matched_account_id is not null and coalesce(profile_id, matched_profile_id) is not null then 'profile_to_account_member'
        when profile_id is not null then 'direct_profile_id'
        when matched_profile_id is not null then 'lead_email_to_profile_email'
        when firebase_uid is not null then 'firebase_uid'
        when lead_id is not null then 'lead_id'
        when source_id is not null then 'source_id'
        else 'unresolved'
    end as resolution_reason,
    matched_profile_id,
    matched_profile_firebase_uid,
    matched_profile_email,
    matched_account_id
from stitched;
create or replace view public.acquisition_resolved_attribution as
with identities as (
    select distinct resolved_identity_key
    from public.acquisition_touch_lineage
)
select
    identities.resolved_identity_key,
    latest_identity.stitched_profile_id as profile_id,
    latest_identity.stitched_account_id as account_id,
    latest_identity.lead_id,
    latest_identity.firebase_uid,
    latest_identity.lead_email,
    first_touch.id as first_touch_id,
    first_touch.occurred_at as first_touch_occurred_at,
    first_touch.channel as first_touch_channel,
    first_touch.source as first_touch_source,
    first_touch.source_id as first_touch_source_id,
    first_touch.medium as first_touch_medium,
    first_touch.campaign as first_touch_campaign,
    first_touch.referrer as first_touch_referrer,
    first_touch.partner_id as first_touch_partner_id,
    first_touch.creator_id as first_touch_creator_id,
    first_touch.referral_id as first_touch_referral_id,
    last_touch.id as last_touch_id,
    last_touch.occurred_at as last_touch_occurred_at,
    last_touch.channel as last_touch_channel,
    last_touch.source as last_touch_source,
    last_touch.source_id as last_touch_source_id,
    last_touch.medium as last_touch_medium,
    last_touch.campaign as last_touch_campaign,
    last_touch.referrer as last_touch_referrer,
    last_touch.partner_id as last_touch_partner_id,
    last_touch.creator_id as last_touch_creator_id,
    last_touch.referral_id as last_touch_referral_id,
    latest_interaction.id as latest_interaction_id,
    latest_interaction.occurred_at as latest_interaction_occurred_at,
    latest_interaction.channel as latest_interaction_channel,
    latest_interaction.source as latest_interaction_source,
    latest_interaction.source_id as latest_interaction_source_id,
    latest_interaction.medium as latest_interaction_medium,
    latest_interaction.campaign as latest_interaction_campaign,
    latest_interaction.referrer as latest_interaction_referrer,
    latest_interaction.partner_id as latest_interaction_partner_id,
    latest_interaction.creator_id as latest_interaction_creator_id,
    latest_interaction.referral_id as latest_interaction_referral_id,
    stats.touch_count,
    stats.interaction_count,
    stats.channels_seen,
    stats.sources_seen,
    stats.campaigns_seen,
    coalesce(
        latest_interaction.partner_id,
        last_touch.partner_id,
        first_touch.partner_id
    ) as partner_id,
    coalesce(
        latest_interaction.creator_id,
        last_touch.creator_id,
        first_touch.creator_id
    ) as creator_id,
    coalesce(
        latest_interaction.referral_id,
        last_touch.referral_id,
        first_touch.referral_id
    ) as referral_id
from identities
left join lateral (
    select *
    from public.acquisition_touch_lineage lineage
    where lineage.resolved_identity_key = identities.resolved_identity_key
    order by lineage.occurred_at desc, lineage.created_at desc, lineage.id desc
    limit 1
) latest_identity on true
left join lateral (
    select *
    from public.acquisition_touch_lineage lineage
    where lineage.resolved_identity_key = identities.resolved_identity_key
    order by
        case when lineage.touch_type = 'first_touch' then 0 else 1 end,
        lineage.occurred_at asc,
        lineage.created_at asc,
        lineage.id asc
    limit 1
) first_touch on true
left join lateral (
    select *
    from public.acquisition_touch_lineage lineage
    where lineage.resolved_identity_key = identities.resolved_identity_key
    order by
        case when lineage.touch_type = 'last_touch' then 0 else 1 end,
        lineage.occurred_at desc,
        lineage.created_at desc,
        lineage.id desc
    limit 1
) last_touch on true
left join lateral (
    select *
    from public.acquisition_touch_lineage lineage
    where lineage.resolved_identity_key = identities.resolved_identity_key
    order by
        case when lineage.touch_type = 'interaction' then 0 else 1 end,
        lineage.occurred_at desc,
        lineage.created_at desc,
        lineage.id desc
    limit 1
) latest_interaction on true
left join lateral (
    select
        count(*) as touch_count,
        count(*) filter (where lineage.touch_type = 'interaction') as interaction_count,
        array_remove(array_agg(distinct lineage.channel order by lineage.channel), null) as channels_seen,
        array_remove(array_agg(distinct lineage.source order by lineage.source), null) as sources_seen,
        array_remove(array_agg(distinct lineage.campaign order by lineage.campaign), null) as campaigns_seen
    from public.acquisition_touch_lineage lineage
    where lineage.resolved_identity_key = identities.resolved_identity_key
) stats on true;
create or replace view public.acquisition_channel_metrics as
select
    date_trunc(
        'day',
        coalesce(
            resolved.first_touch_occurred_at,
            resolved.last_touch_occurred_at,
            resolved.latest_interaction_occurred_at
        )
    ) as metric_day,
    coalesce(
        resolved.first_touch_channel,
        resolved.last_touch_channel,
        resolved.latest_interaction_channel
    ) as channel,
    coalesce(
        resolved.first_touch_source,
        resolved.last_touch_source,
        resolved.latest_interaction_source,
        'unknown'
    ) as source,
    coalesce(
        resolved.first_touch_campaign,
        resolved.last_touch_campaign,
        resolved.latest_interaction_campaign,
        'unattributed'
    ) as campaign,
    sum(resolved.touch_count) as touch_count,
    sum(resolved.interaction_count) as interaction_touch_count,
    count(*) as resolved_identity_count,
    count(distinct resolved.lead_id) filter (where resolved.lead_id is not null) as leads,
    count(distinct resolved.profile_id) filter (where resolved.profile_id is not null) as signups,
    count(distinct resolved.account_id) filter (where resolved.account_id is not null) as accounts,
    count(distinct resolved.lead_id) filter (
        where resolved.lead_id is not null
          and staged.status = 'qualified'
    ) as qualified_leads,
    count(*) filter (where resolved.partner_id is not null) as partner_attributed_identities,
    count(*) filter (where resolved.creator_id is not null) as creator_attributed_identities,
    count(*) filter (where resolved.referral_id is not null) as referral_attributed_identities,
    count(*) filter (where resolved.profile_id is not null and resolved.account_id is not null) as signup_to_account_conversions
from public.acquisition_resolved_attribution resolved
left join public.staged_leads staged
    on staged.id = resolved.lead_id
group by 1, 2, 3, 4;
grant select on public.acquisition_touch_lineage to service_role;
grant select on public.acquisition_resolved_attribution to service_role;
grant select on public.acquisition_channel_metrics to service_role;
