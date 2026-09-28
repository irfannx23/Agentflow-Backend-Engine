-- ============================================
-- Pre-CRM Engine v2 — Migration 13: mark_ready_to_push
-- ============================================
-- Outbound gate (M4) pass path. A lead that cleared every stage AND passes
-- the outbound-only gate (deliverable + MX-ok + icp_score >= 70) is marked
-- ready_to_push — the signal that the AI outreach loop (M5) should write +
-- send a first email. Returns one row (avoids the n8n 204/zero-item trap).

create or replace function public.mark_ready_to_push(
    p_lead_id bigint,
    p_reason text default null
) returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.staged_leads
       set status = 'ready_to_push'
     where id = p_lead_id;

    insert into public.lead_events (lead_id, event_type, event_data)
    values (p_lead_id, 'lead.ready_to_push',
            jsonb_build_object('reason', p_reason));

    return query select true;
end;
$$;
grant execute on function public.mark_ready_to_push(bigint, text) to service_role;
