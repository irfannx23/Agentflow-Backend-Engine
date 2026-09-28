-- ============================================
-- CostPilot Phase 10 — GTM funnel optimization
-- ============================================
-- Rebuilds the lead/acquisition funnel assemblies from persisted tables only
-- so lifecycle and acquisition analytics stay responsive under the historical
-- demo cohort.

create or replace view public.gtm_lead_funnel_assembly as
with paid_accounts as (
    select
        bt.account_id,
        bool_or(bt.payment_status = 'success' and bt.verification_status = 'verified') as has_verified_payment,
        max(bt.verified_at) filter (
            where bt.payment_status = 'success'
              and bt.verification_status = 'verified'
        ) as paid_at
    from public.billing_transactions bt
    where bt.account_id is not null
    group by bt.account_id
),
latest_qualification as (
    select distinct on (qe.lead_id)
        qe.lead_id,
        qe.profile_id,
        qe.account_id,
        qe.fit_score,
        qe.buying_intent,
        qe.priority_score,
        qe.priority_tier,
        qe.mql_status,
        qe.sql_status,
        qe.pql_status,
        qe.acquisition_channel,
        qe.acquisition_source,
        qe.acquisition_campaign,
        qe.evaluated_at
    from public.qualification_evaluations qe
    where qe.lead_id is not null
    order by qe.lead_id, qe.evaluated_at desc, qe.created_at desc, qe.id desc
),
first_touch as (
    select distinct on (t.lead_id)
        t.lead_id,
        t.identity_key,
        t.channel,
        t.source,
        t.campaign,
        t.occurred_at
    from public.acquisition_touches t
    where t.lead_id is not null
    order by t.lead_id,
        case when t.touch_type = 'first_touch' then 0 else 1 end,
        t.occurred_at asc,
        t.created_at asc,
        t.id asc
),
last_touch as (
    select distinct on (t.lead_id)
        t.lead_id,
        t.channel,
        t.source,
        t.campaign,
        t.occurred_at
    from public.acquisition_touches t
    where t.lead_id is not null
    order by t.lead_id,
        case when t.touch_type = 'last_touch' then 0 else 1 end,
        t.occurred_at desc,
        t.created_at desc,
        t.id desc
),
latest_interaction as (
    select distinct on (t.lead_id)
        t.lead_id,
        t.channel,
        t.source,
        t.campaign,
        t.occurred_at
    from public.acquisition_touches t
    where t.lead_id is not null
    order by t.lead_id,
        case when t.touch_type = 'interaction' then 0 else 1 end,
        t.occurred_at desc,
        t.created_at desc,
        t.id desc
),
outreach_rollup as (
    select
        o.lead_id,
        bool_or(o.status in ('sent', 'replied')) as has_sent,
        bool_or(o.status = 'replied' or o.reply_received_at is not null) as has_reply,
        bool_or(o.deal_id is not null) as has_deal,
        max(coalesce(o.reply_received_at, o.sent_at, o.updated_at, o.created_at)) as last_outreach_at
    from public.outreach o
    group by o.lead_id
)
select
    l.id as lead_id,
    l.created_at as acquired_at,
    coalesce(
        q.acquisition_channel,
        first_touch.channel,
        last_touch.channel,
        latest_interaction.channel,
        case when l.source_type = 'outbound_scraped' then 'outbound' else 'inbound' end,
        'unknown'
    ) as acquisition_channel,
    coalesce(
        q.acquisition_source,
        first_touch.source,
        last_touch.source,
        latest_interaction.source,
        'unknown'
    ) as acquisition_source,
    coalesce(
        q.acquisition_campaign,
        first_touch.campaign,
        last_touch.campaign,
        latest_interaction.campaign,
        'unattributed'
    ) as acquisition_campaign,
    q.profile_id,
    q.account_id,
    q.fit_score,
    q.buying_intent,
    q.priority_score,
    q.priority_tier,
    q.mql_status,
    q.sql_status,
    q.pql_status,
    sa.routing_status,
    sa.eligible_for_sales,
    sa.current_owner_type,
    sa.current_rep_id,
    sa.manual_override,
    case
        when coalesce(oroll.has_deal, false) then 'deal_created'
        when coalesce(oroll.has_reply, false) then 'reply_received'
        when coalesce(oroll.has_sent, false) then 'outreach_sent'
        else 'no_deal'
    end as deal_state,
    coalesce(oroll.last_outreach_at, sa.last_routed_at, q.evaluated_at, l.created_at) as last_sales_touch_at,
    coalesce(activation.activation_score, 0) as activation_score,
    coalesce(activation.activated, false) as activated,
    activation.activated_at,
    activation.time_to_value_hours,
    health.health_score,
    health.health_state,
    health.churn_risk,
    health.expansion_state,
    health.evaluated_at as health_evaluated_at,
    coalesce(paid_accounts.has_verified_payment, false) as paid_account,
    paid_accounts.paid_at,
    (q.mql_status = 'qualified') as is_mql,
    (q.sql_status = 'sales_ready') as is_sql,
    (sa.lead_id is not null and coalesce(sa.eligible_for_sales, false) = true) as is_routed,
    (
        coalesce(oroll.has_deal, false)
        or coalesce(oroll.has_reply, false)
        or coalesce(sa.needs_ae_handoff, false) = true
        or coalesce(sa.routing_status, '') in ('handoff_pending', 'handed_off')
    ) as is_sales_engaged,
    coalesce(oroll.has_deal, false) as has_deal,
    (q.profile_id is not null) as is_signup,
    (q.account_id is not null) as has_account,
    (q.pql_status in ('product_qualified', 'product_activated')) as is_pql,
    (health.health_state = 'healthy') as is_healthy,
    (health.expansion_state in ('expansion_candidate', 'upgrade_ready', 'sales_followup')) as is_expansion_ready
from public.staged_leads l
left join latest_qualification q
    on q.lead_id = l.id
left join first_touch
    on first_touch.lead_id = l.id
left join last_touch
    on last_touch.lead_id = l.id
left join latest_interaction
    on latest_interaction.lead_id = l.id
left join public.sales_assignments sa
    on sa.lead_id = l.id
left join outreach_rollup oroll
    on oroll.lead_id = l.id
left join public.account_activation_state activation
    on activation.account_id = q.account_id
left join public.current_customer_health health
    on health.account_id = q.account_id
left join paid_accounts
    on paid_accounts.account_id = q.account_id;
grant select on public.gtm_lead_funnel_assembly to service_role;
create or replace view public.gtm_acquisition_funnel_assembly as
with paid_accounts as (
    select
        bt.account_id,
        bool_or(bt.payment_status = 'success' and bt.verification_status = 'verified') as has_verified_payment
    from public.billing_transactions bt
    where bt.account_id is not null
    group by bt.account_id
),
latest_qualification as (
    select distinct on (qe.lead_id)
        qe.lead_id,
        qe.profile_id,
        qe.account_id,
        qe.mql_status,
        qe.sql_status,
        qe.pql_status
    from public.qualification_evaluations qe
    where qe.lead_id is not null
    order by qe.lead_id, qe.evaluated_at desc, qe.created_at desc, qe.id desc
),
first_touch as (
    select distinct on (t.lead_id)
        t.lead_id,
        t.identity_key,
        t.channel as first_touch_channel,
        t.source as first_touch_source,
        t.campaign as first_touch_campaign,
        t.occurred_at as first_touch_occurred_at
    from public.acquisition_touches t
    where t.lead_id is not null
    order by t.lead_id,
        case when t.touch_type = 'first_touch' then 0 else 1 end,
        t.occurred_at asc,
        t.created_at asc,
        t.id asc
),
last_touch as (
    select distinct on (t.lead_id)
        t.lead_id,
        t.channel as last_touch_channel,
        t.source as last_touch_source,
        t.campaign as last_touch_campaign
    from public.acquisition_touches t
    where t.lead_id is not null
    order by t.lead_id,
        case when t.touch_type = 'last_touch' then 0 else 1 end,
        t.occurred_at desc,
        t.created_at desc,
        t.id desc
),
latest_interaction as (
    select distinct on (t.lead_id)
        t.lead_id,
        t.channel as latest_interaction_channel,
        t.source as latest_interaction_source,
        t.campaign as latest_interaction_campaign
    from public.acquisition_touches t
    where t.lead_id is not null
    order by t.lead_id,
        case when t.touch_type = 'interaction' then 0 else 1 end,
        t.occurred_at desc,
        t.created_at desc,
        t.id desc
)
select
    coalesce(first_touch.identity_key, 'lead:' || l.id::text) as resolved_identity_key,
    l.id as lead_id,
    q.profile_id,
    q.account_id,
    first_touch.first_touch_channel,
    first_touch.first_touch_source,
    first_touch.first_touch_campaign,
    last_touch.last_touch_channel,
    last_touch.last_touch_source,
    last_touch.last_touch_campaign,
    coalesce(
        first_touch.first_touch_channel,
        last_touch.last_touch_channel,
        latest_interaction.latest_interaction_channel,
        case when l.source_type = 'outbound_scraped' then 'outbound' else 'inbound' end,
        'unknown'
    ) as acquisition_channel,
    coalesce(
        first_touch.first_touch_source,
        last_touch.last_touch_source,
        latest_interaction.latest_interaction_source,
        'unknown'
    ) as acquisition_source,
    coalesce(
        first_touch.first_touch_campaign,
        last_touch.last_touch_campaign,
        latest_interaction.latest_interaction_campaign,
        'unattributed'
    ) as acquisition_campaign,
    first_touch.first_touch_occurred_at as acquired_at,
    q.mql_status,
    q.sql_status,
    q.pql_status,
    activation.activated,
    health.expansion_state,
    coalesce(paid_accounts.has_verified_payment, false) as paid_account
from public.staged_leads l
left join latest_qualification q
    on q.lead_id = l.id
left join first_touch
    on first_touch.lead_id = l.id
left join last_touch
    on last_touch.lead_id = l.id
left join latest_interaction
    on latest_interaction.lead_id = l.id
left join public.account_activation_state activation
    on activation.account_id = q.account_id
left join public.current_customer_health health
    on health.account_id = q.account_id
left join paid_accounts
    on paid_accounts.account_id = q.account_id;
grant select on public.gtm_acquisition_funnel_assembly to service_role;
