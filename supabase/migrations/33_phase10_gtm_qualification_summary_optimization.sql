-- Phase 10 corrective migration: keep qualification and executive summary
-- reads on top of the latest persisted qualification evaluations rather than
-- rejoining the broader lead qualification signal assembly.

create index if not exists qualification_evaluations_lead_latest_cover_idx
    on public.qualification_evaluations (lead_id, evaluated_at desc, created_at desc, id desc);
create or replace view public.gtm_qualification_summary as
with latest as (
    select distinct on (qe.lead_id)
        qe.lead_id,
        qe.fit_score,
        qe.buying_intent,
        qe.mql_status,
        qe.sql_status,
        qe.pql_status,
        qe.priority_score,
        qe.priority_tier
    from public.qualification_evaluations qe
    where qe.lead_id is not null
    order by qe.lead_id, qe.evaluated_at desc, qe.created_at desc, qe.id desc
),
base as (
    select
        latest.lead_id,
        latest.fit_score,
        latest.buying_intent,
        latest.mql_status,
        latest.sql_status,
        latest.pql_status,
        latest.priority_score,
        latest.priority_tier,
        lead.status as lead_status
    from latest
    left join public.staged_leads lead
        on lead.id = latest.lead_id
)
select
    count(*)::integer as evaluated_leads,
    count(*) filter (where mql_status = 'qualified')::integer as mql_count,
    count(*) filter (where sql_status = 'sales_ready')::integer as sql_count,
    count(*) filter (where pql_status in ('product_qualified', 'product_activated'))::integer as pql_count,
    count(*) filter (where pql_status = 'product_activated')::integer as activated_pql_count,
    count(*) filter (where buying_intent = 'high')::integer as high_intent_count,
    count(*) filter (where priority_tier = 'urgent')::integer as urgent_priority_count,
    count(*) filter (where priority_tier = 'high')::integer as high_priority_count,
    count(*) filter (where lead_status = 'nurture')::integer as nurture_count,
    count(*) filter (where lead_status = 'disqualified')::integer as disqualified_count,
    round(avg(fit_score)::numeric, 2) as average_fit_score,
    round(avg(priority_score)::numeric, 2) as average_priority_score
from base;
grant select on public.gtm_qualification_summary to service_role;
