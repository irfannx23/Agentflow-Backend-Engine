-- ============================================
-- CostPilot — Retool sales owner field compatibility
-- ============================================
-- Retool Sales expects customer-friendly owner fields. Keep the existing queue
-- contract intact while adding owner_name/owner_email and MQL/SQL booleans.

create or replace view public.current_sales_queue as
with outreach_rollup as (
    select
        o.lead_id,
        count(*)::integer as outreach_count,
        count(*) filter (where o.status in ('sent', 'replied'))::integer as outreach_sent_count,
        count(*) filter (where o.status = 'replied' or o.reply_received_at is not null)::integer as outreach_reply_count,
        count(*) filter (where o.deal_id is not null)::integer as outreach_deal_count,
        max(o.sent_at) as last_outreach_sent_at,
        max(o.reply_received_at) as last_reply_received_at,
        max(coalesce(o.reply_received_at, o.sent_at, o.updated_at, o.created_at)) as last_outreach_activity_at
    from public.outreach o
    group by o.lead_id
),
latest_qualification as (
    select distinct on (qe.lead_id)
        qe.lead_id,
        qe.evaluated_at
    from public.qualification_evaluations qe
    where qe.lead_id is not null
    order by qe.lead_id, qe.evaluated_at desc, qe.created_at desc, qe.id desc
)
select
    sa.id as assignment_id,
    sa.lead_id,
    sa.profile_id,
    sa.account_id,
    l.email as lead_email,
    l.company_name,
    acc.name as account_name,
    l.source_type,
    sa.acquisition_channel,
    sa.acquisition_source,
    sa.fit_score,
    sa.buying_intent,
    sa.mql_status,
    sa.sql_status,
    sa.priority_tier,
    sa.priority_score,
    sa.segment,
    sa.geography,
    sa.current_owner_type,
    sa.current_rep_id,
    rep.rep_code,
    rep.full_name as rep_name,
    sa.routing_status,
    sa.routing_reason,
    sa.manual_override,
    sa.manual_override_reason,
    sa.needs_ae_handoff,
    sa.crm_sync_status,
    sa.slack_sync_status,
    coalesce(
        oroll.last_reply_received_at,
        oroll.last_outreach_sent_at,
        oroll.last_outreach_activity_at,
        sa.last_routed_at,
        q.evaluated_at,
        l.updated_at,
        l.created_at
    ) as last_interaction_at,
    greatest(
        extract(epoch from (now() - coalesce(sa.assigned_at, sa.last_routed_at, q.evaluated_at, l.created_at))) / 3600.0,
        0
    ) as aging_hours,
    case
        when sa.routing_status = 'retry_required' then 'retry_sales_sync'
        when sa.current_owner_type = 'ae' and (coalesce(oroll.outreach_deal_count, 0) > 0 or coalesce(oroll.outreach_reply_count, 0) > 0) then 'advance_deal'
        when sa.needs_ae_handoff then 'handoff_to_ae'
        when sa.current_owner_type = 'sdr' and coalesce(sa.acquisition_channel, '') = 'outbound' and coalesce(oroll.outreach_sent_count, 0) = 0 then 'send_outreach'
        when sa.current_owner_type = 'sdr' and coalesce(sa.acquisition_channel, '') in ('inbound', 'partner', 'creator', 'referral', 'plg') then 'qualify_and_contact'
        when sa.routing_status = 'unassigned' and sa.eligible_for_sales then 'assign_rep'
        else 'review'
    end as next_action,
    case
        when coalesce(oroll.outreach_deal_count, 0) > 0 then 'deal_created'
        when coalesce(oroll.outreach_reply_count, 0) > 0 then 'reply_received'
        when coalesce(oroll.outreach_sent_count, 0) > 0 then 'outreach_sent'
        else 'no_deal'
    end as deal_state,
    sa.assigned_at,
    sa.handoff_at,
    sa.last_routed_at,
    coalesce(team.full_name, rep.full_name) as owner_name,
    team.email as owner_email,
    (sa.mql_status = 'qualified') as is_mql,
    (sa.sql_status = 'sales_ready') as is_sql
from public.sales_assignments sa
join public.staged_leads l
    on l.id = sa.lead_id
left join public.accounts acc
    on acc.id = sa.account_id
left join public.sales_reps rep
    on rep.id = sa.current_rep_id
left join public.internal_team team
    on team.sales_rep_id = sa.current_rep_id
left join outreach_rollup oroll
    on oroll.lead_id = sa.lead_id
left join latest_qualification q
    on q.lead_id = sa.lead_id
where sa.eligible_for_sales = true;
create or replace view public.sdr_sales_queue as
select *
from public.current_sales_queue
where current_owner_type = 'sdr'
  and routing_status in ('assigned', 'manually_overridden', 'handoff_pending', 'handed_off');
create or replace view public.ae_sales_queue as
select *
from public.current_sales_queue
where current_owner_type = 'ae'
  and routing_status in ('assigned', 'manually_overridden', 'handoff_pending', 'handed_off');
create or replace view public.unassigned_sales_queue as
select *
from public.current_sales_queue
where current_rep_id is null
   or routing_status in ('unassigned', 'retry_required');
create or replace view public.hot_sales_leads as
select *
from public.current_sales_queue
where sql_status = 'sales_ready'
  and priority_tier in ('urgent', 'high')
order by priority_score desc, assigned_at asc nulls first, last_routed_at desc;
create or replace view public.sales_handoff_queue as
select *
from public.current_sales_queue
where needs_ae_handoff = true
   or routing_status in ('handoff_pending', 'handed_off');
grant select on public.current_sales_queue to service_role;
grant select on public.sdr_sales_queue to service_role;
grant select on public.ae_sales_queue to service_role;
grant select on public.unassigned_sales_queue to service_role;
grant select on public.hot_sales_leads to service_role;
grant select on public.sales_handoff_queue to service_role;
