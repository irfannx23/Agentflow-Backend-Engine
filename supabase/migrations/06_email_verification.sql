-- ============================================
-- Pre-CRM Engine — Migration 06: Stage 2 — email verification tagging
-- ============================================
-- Adds mark_lead_unverified RPC: flags a lead status='unverified' and
-- appends a 'lead.verification.failed' timeline event. Called by the
-- n8n Stage 2 gate when the provider says the mailbox is not deliverable.
-- (Leads are still stored — verification only blocks scoring/CRM, never ingestion.)

create or replace function public.mark_lead_unverified(
    p_lead_id bigint
) returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.staged_leads
       set status = 'unverified'
     where id = p_lead_id;

    insert into public.lead_events (lead_id, event_type, event_data)
    values (p_lead_id, 'lead.verification.failed',
            jsonb_build_object('status', 'unverified'));

    return query select true;
end;
$$;
grant execute on function public.mark_lead_unverified(bigint) to service_role;
