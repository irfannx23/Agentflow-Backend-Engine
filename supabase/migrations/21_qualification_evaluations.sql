-- ============================================
-- CostPilot Phase 4 — Unified qualification evaluations
-- ============================================
-- Reuses the existing Pre-CRM scoring/runtime and adds:
--   * one explainable qualification evaluation history table
--   * one signal-assembly view over existing lead/acquisition/product data
--   * one evaluation RPC that derives MQL / SQL / PQL-compatible states
--   * analytics-ready current-state / metrics views
--
-- The existing Gemini scorer remains the canonical fit/intent engine.

create extension if not exists pgcrypto;
create table if not exists public.qualification_evaluations (
    id                    uuid primary key default gen_random_uuid(),
    lead_id               bigint references public.staged_leads (id) on delete cascade,
    profile_id            uuid references public.profiles (id) on delete set null,
    account_id            uuid references public.accounts (id) on delete set null,
    evaluation_type       text not null default 'runtime',
    source_runtime        text not null default 'precrm_n8n',
    rule_version          text not null default 'phase4_v1',
    fit_score             integer,
    buying_intent         text,
    acquisition_channel   text,
    acquisition_source    text,
    acquisition_campaign  text,
    lead_status           text,
    mql_status            text not null,
    sql_status            text not null,
    pql_status            text not null,
    crm_ready             boolean not null default false,
    outbound_ready        boolean not null default false,
    priority_score        integer not null default 0,
    priority_tier         text not null,
    explanation           text not null,
    evaluation_reasons    jsonb not null default '{}'::jsonb,
    engagement_summary    jsonb not null default '{}'::jsonb,
    product_summary       jsonb not null default '{}'::jsonb,
    acquisition_summary   jsonb not null default '{}'::jsonb,
    evaluated_at          timestamptz not null default now(),
    created_at            timestamptz not null default now(),
    constraint qualification_evaluations_type_check
        check (evaluation_type in ('runtime', 'verification_failed', 'jurisdiction_blocked', 'score_update', 'outbound_ready', 'outreach_sent', 'nurture_sent', 'deal_created')),
    constraint qualification_evaluations_runtime_check
        check (source_runtime in ('precrm_n8n', 'reply_deal_workflow', 'system')),
    constraint qualification_evaluations_intent_check
        check (buying_intent is null or buying_intent in ('high', 'medium', 'low')),
    constraint qualification_evaluations_channel_check
        check (acquisition_channel is null or acquisition_channel in ('inbound', 'plg', 'outbound', 'partner', 'creator', 'referral')),
    constraint qualification_evaluations_mql_check
        check (mql_status in ('qualified', 'nurture', 'disqualified')),
    constraint qualification_evaluations_sql_check
        check (sql_status in ('sales_ready', 'awaiting_engagement', 'nurture', 'disqualified')),
    constraint qualification_evaluations_pql_check
        check (pql_status in ('insufficient_product_signals')),
    constraint qualification_evaluations_priority_check
        check (priority_tier in ('urgent', 'high', 'medium', 'low')),
    constraint qualification_evaluations_reason_object_check
        check (jsonb_typeof(evaluation_reasons) = 'object'),
    constraint qualification_evaluations_engagement_object_check
        check (jsonb_typeof(engagement_summary) = 'object'),
    constraint qualification_evaluations_product_object_check
        check (jsonb_typeof(product_summary) = 'object'),
    constraint qualification_evaluations_acquisition_object_check
        check (jsonb_typeof(acquisition_summary) = 'object'),
    constraint qualification_evaluations_identity_required
        check (lead_id is not null or profile_id is not null or account_id is not null)
);
create index if not exists qualification_evaluations_lead_evaluated_at_idx
    on public.qualification_evaluations (lead_id, evaluated_at desc);
create index if not exists qualification_evaluations_profile_evaluated_at_idx
    on public.qualification_evaluations (profile_id, evaluated_at desc);
create index if not exists qualification_evaluations_account_evaluated_at_idx
    on public.qualification_evaluations (account_id, evaluated_at desc);
create index if not exists qualification_evaluations_mql_idx
    on public.qualification_evaluations (mql_status, evaluated_at desc);
create index if not exists qualification_evaluations_sql_idx
    on public.qualification_evaluations (sql_status, evaluated_at desc);
create index if not exists qualification_evaluations_priority_idx
    on public.qualification_evaluations (priority_tier, priority_score desc, evaluated_at desc);
alter table public.qualification_evaluations enable row level security;
drop policy if exists "service_role_all_qualification_evaluations" on public.qualification_evaluations;
create policy "service_role_all_qualification_evaluations"
    on public.qualification_evaluations
    for all
    to service_role
    using (true)
    with check (true);
grant select, insert, update, delete on public.qualification_evaluations to service_role;
create or replace view public.lead_qualification_signal_assembly as
with base as (
    select
        l.id as lead_id,
        l.email as lead_email,
        l.company_name,
        l.source_type,
        l.status as lead_status,
        l.icp_score,
        l.buying_intent,
        l.personalized_icebreaker,
        l.firmographics,
        l.raw_payload,
        l.created_at as lead_created_at,
        l.updated_at as lead_updated_at,
        resolved.resolved_identity_key,
        resolved.profile_id as resolved_profile_id,
        resolved.account_id as resolved_account_id,
        resolved.firebase_uid as resolved_firebase_uid,
        resolved.first_touch_channel,
        resolved.first_touch_source,
        resolved.first_touch_campaign,
        resolved.last_touch_channel,
        resolved.last_touch_source,
        resolved.last_touch_campaign,
        resolved.latest_interaction_channel,
        resolved.latest_interaction_source,
        resolved.latest_interaction_campaign,
        resolved.touch_count as acquisition_touch_count,
        resolved.interaction_count as acquisition_interaction_count,
        resolved.channels_seen as acquisition_channels_seen,
        resolved.sources_seen as acquisition_sources_seen,
        resolved.campaigns_seen as acquisition_campaigns_seen,
        resolved.partner_id,
        resolved.creator_id,
        resolved.referral_id
    from public.staged_leads l
    left join public.acquisition_resolved_attribution resolved
        on resolved.lead_id = l.id
),
stitched as (
    select
        base.*,
        coalesce(base.resolved_profile_id, matched_profile.id) as profile_id,
        coalesce(base.resolved_account_id, matched_account.account_id) as account_id,
        coalesce(base.resolved_firebase_uid, matched_profile.firebase_uid) as firebase_uid,
        matched_profile.email as profile_email
    from base
    left join lateral (
        select
            p.id,
            p.firebase_uid,
            p.email,
            p.created_at
        from public.profiles p
        where (
            base.resolved_profile_id is not null
            and p.id = base.resolved_profile_id
        ) or (
            base.resolved_profile_id is null
            and p.email is not null
            and lower(p.email) = lower(base.lead_email)
        )
        order by
            case when base.resolved_profile_id is not null and p.id = base.resolved_profile_id then 0 else 1 end,
            p.created_at asc
        limit 1
    ) matched_profile on true
    left join lateral (
        select
            am.account_id,
            am.created_at,
            am.is_owner
        from public.account_members am
        where am.profile_id = coalesce(base.resolved_profile_id, matched_profile.id)
        order by am.is_owner desc, am.created_at asc
        limit 1
    ) matched_account on true
)
select
    stitched.lead_id,
    stitched.lead_email,
    stitched.company_name,
    stitched.source_type,
    stitched.lead_status,
    stitched.icp_score,
    stitched.buying_intent,
    stitched.personalized_icebreaker,
    stitched.firmographics,
    stitched.raw_payload,
    stitched.lead_created_at,
    stitched.lead_updated_at,
    stitched.resolved_identity_key,
    stitched.profile_id,
    stitched.account_id,
    stitched.firebase_uid,
    stitched.profile_email,
    account.name as account_name,
    account.primary_domain as account_primary_domain,
    account.onboarding_status,
    coalesce(stitched.latest_interaction_channel, stitched.last_touch_channel, stitched.first_touch_channel) as acquisition_channel,
    coalesce(stitched.latest_interaction_source, stitched.last_touch_source, stitched.first_touch_source) as acquisition_source,
    coalesce(stitched.latest_interaction_campaign, stitched.last_touch_campaign, stitched.first_touch_campaign) as acquisition_campaign,
    stitched.first_touch_channel,
    stitched.first_touch_source,
    stitched.first_touch_campaign,
    stitched.last_touch_channel,
    stitched.last_touch_source,
    stitched.last_touch_campaign,
    stitched.latest_interaction_channel,
    stitched.latest_interaction_source,
    stitched.latest_interaction_campaign,
    stitched.acquisition_touch_count,
    stitched.acquisition_interaction_count,
    stitched.acquisition_channels_seen,
    stitched.acquisition_sources_seen,
    stitched.acquisition_campaigns_seen,
    stitched.partner_id,
    stitched.creator_id,
    stitched.referral_id,
    onboarding.company_size as onboarding_company_size,
    onboarding.estimated_monthly_spend as onboarding_estimated_monthly_spend,
    onboarding.provider_count as onboarding_provider_count,
    onboarding.providers as onboarding_providers,
    onboarding.completed_at as onboarding_completed_at,
    product.product_event_count,
    product.signup_count,
    product.login_count,
    product.onboarding_started_count,
    product.onboarding_completed_count,
    product.dashboard_viewed_count,
    product.last_product_event_at,
    timeline.lead_event_count,
    timeline.last_lead_event_at,
    timeline.verification_failed_count,
    timeline.blocked_jurisdiction_count,
    timeline.nurture_email_count,
    timeline.ready_to_push_count,
    timeline.outbound_gate_fail_count,
    timeline.outreach_email_event_count,
    timeline.outreach_deal_event_count,
    outreach.outreach_count,
    outreach.outreach_sent_count,
    outreach.outreach_reply_count,
    outreach.outreach_deal_count,
    outreach.last_outreach_sent_at,
    outreach.last_reply_received_at
from stitched
left join public.accounts account
    on account.id = stitched.account_id
left join lateral (
    select
        o.company_size,
        o.estimated_monthly_spend,
        o.providers,
        jsonb_array_length(o.providers) as provider_count,
        o.completed_at,
        o.updated_at
    from public.onboarding_responses o
    where (
        stitched.profile_id is not null
        and o.profile_id = stitched.profile_id
    ) or (
        stitched.profile_id is null
        and stitched.account_id is not null
        and o.account_id = stitched.account_id
    )
    order by o.completed_at desc nulls last, o.updated_at desc
    limit 1
) onboarding on true
left join lateral (
    select
        count(*)::integer as product_event_count,
        count(*) filter (where pe.event_name = 'signup')::integer as signup_count,
        count(*) filter (where pe.event_name = 'login')::integer as login_count,
        count(*) filter (where pe.event_name = 'onboarding_started')::integer as onboarding_started_count,
        count(*) filter (where pe.event_name = 'onboarding_completed')::integer as onboarding_completed_count,
        count(*) filter (where pe.event_name = 'dashboard_viewed')::integer as dashboard_viewed_count,
        max(pe.created_at) as last_product_event_at
    from public.product_events pe
    where (
        stitched.profile_id is not null
        and pe.profile_id = stitched.profile_id
    ) or (
        stitched.profile_id is null
        and stitched.account_id is not null
        and pe.account_id = stitched.account_id
    ) or (
        stitched.profile_id is null
        and stitched.account_id is null
        and stitched.firebase_uid is not null
        and pe.firebase_uid = stitched.firebase_uid
    )
) product on true
left join lateral (
    select
        count(*)::integer as lead_event_count,
        max(le.created_at) as last_lead_event_at,
        count(*) filter (where le.event_type = 'lead.verification.failed')::integer as verification_failed_count,
        count(*) filter (where le.event_type = 'lead.blocked.jurisdiction')::integer as blocked_jurisdiction_count,
        count(*) filter (where le.event_type = 'lead.nurture.email.sent')::integer as nurture_email_count,
        count(*) filter (where le.event_type = 'lead.ready_to_push')::integer as ready_to_push_count,
        count(*) filter (where le.event_type = 'lead.outbound.gate.failed')::integer as outbound_gate_fail_count,
        count(*) filter (where le.event_type = 'lead.outreach.email.sent')::integer as outreach_email_event_count,
        count(*) filter (where le.event_type = 'lead.outreach.deal.created')::integer as outreach_deal_event_count
    from public.lead_events le
    where le.lead_id = stitched.lead_id
) timeline on true
left join lateral (
    select
        count(*)::integer as outreach_count,
        count(*) filter (where o.status = 'sent')::integer as outreach_sent_count,
        count(*) filter (where o.status = 'replied')::integer as outreach_reply_count,
        count(*) filter (where o.deal_id is not null)::integer as outreach_deal_count,
        max(o.sent_at) as last_outreach_sent_at,
        max(o.reply_received_at) as last_reply_received_at
    from public.outreach o
    where o.lead_id = stitched.lead_id
) outreach on true;
grant select on public.lead_qualification_signal_assembly to service_role;
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
    v_rule_version text := 'phase4_v1';
    v_fit integer := 0;
    v_intent text := 'low';
    v_disqualified boolean := false;
    v_marketing_signal boolean := false;
    v_engagement_signal boolean := false;
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
        or coalesce(s.dashboard_viewed_count, 0) > 0;
    v_engagement_signal := coalesce(s.outreach_reply_count, 0) > 0
        or coalesce(s.outreach_deal_count, 0) > 0
        or coalesce(s.nurture_email_count, 0) > 0
        or coalesce(s.ready_to_push_count, 0) > 0;
    v_marketing_signal := v_inbound_or_partner_signal
        or v_product_signal
        or coalesce(s.acquisition_interaction_count, 0) > 0;

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
        'pql_driver', 'insufficient_product_signals',
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
        'last_product_event_at', s.last_product_event_at
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
        when v_mql_status = 'qualified' then 'Lead is MQL because fit and intent meet the formal marketing-qualified threshold, but it still needs stronger sales engagement.'
        else 'Lead remains in nurture because current fit, intent, and engagement signals do not justify sales qualification.'
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
create or replace view public.lead_current_qualification as
with latest as (
    select distinct on (qe.lead_id)
        qe.*
    from public.qualification_evaluations qe
    where qe.lead_id is not null
    order by qe.lead_id, qe.evaluated_at desc, qe.created_at desc, qe.id desc
)
select
    signals.lead_id,
    signals.lead_email,
    signals.company_name,
    signals.source_type,
    signals.lead_status,
    signals.profile_id,
    signals.account_id,
    signals.firebase_uid,
    signals.acquisition_channel,
    signals.acquisition_source,
    signals.acquisition_campaign,
    latest.id as evaluation_id,
    latest.evaluation_type,
    latest.source_runtime,
    latest.rule_version,
    latest.fit_score,
    latest.buying_intent,
    latest.mql_status,
    latest.sql_status,
    latest.pql_status,
    latest.crm_ready,
    latest.outbound_ready,
    latest.priority_score,
    latest.priority_tier,
    latest.explanation,
    latest.evaluation_reasons,
    latest.engagement_summary,
    latest.product_summary,
    latest.acquisition_summary,
    latest.evaluated_at
from public.lead_qualification_signal_assembly signals
left join latest
    on latest.lead_id = signals.lead_id;
create or replace view public.qualification_channel_metrics as
select
    coalesce(current_qualification.acquisition_channel, 'unknown') as acquisition_channel,
    coalesce(current_qualification.acquisition_source, 'unknown') as acquisition_source,
    count(*) as leads,
    count(*) filter (where current_qualification.mql_status = 'qualified') as mql_leads,
    count(*) filter (where current_qualification.sql_status = 'sales_ready') as sql_leads,
    count(*) filter (where current_qualification.lead_status = 'nurture') as nurture_leads,
    count(*) filter (where current_qualification.priority_tier = 'urgent') as urgent_priority_leads,
    count(*) filter (where current_qualification.priority_tier = 'high') as high_priority_leads
from public.lead_current_qualification current_qualification
group by 1, 2;
grant select on public.lead_current_qualification to service_role;
grant select on public.qualification_channel_metrics to service_role;
