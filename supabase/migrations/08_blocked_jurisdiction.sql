-- ============================================
-- Pre-CRM Engine — Migration 08: Stage 5 — blocked-jurisdiction disqualification
-- ============================================
-- Adds mark_lead_blocked RPC: disqualifies a lead because it is in an
-- unsupported jurisdiction (BLOCKED_JURISDICTIONS) and appends a
-- 'lead.blocked.jurisdiction' timeline event. Called by the n8n Stage 5
-- gate after enrichment reveals the lead's country.
-- (Leads are still stored — jurisdiction only blocks scoring/CRM, never ingestion.)

create or replace function public.mark_lead_blocked(
    p_lead_id bigint,
    p_country text
) returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.staged_leads
       set status = 'disqualified'
     where id = p_lead_id;

    insert into public.lead_events (lead_id, event_type, event_data)
    values (p_lead_id, 'lead.blocked.jurisdiction',
            jsonb_build_object('country', p_country, 'status', 'disqualified'));

    return query select true;
end;
$$;
grant execute on function public.mark_lead_blocked(bigint, text) to service_role;
