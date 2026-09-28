-- ============================================
-- Pre-CRM Engine v2 — Migration 14: outreach RPCs
-- ============================================
-- AI-outreach ledger writes (M5). The outreach table (migration 10) already
-- exists; these RPCs let n8n insert a generated email and update status/lead.
-- Each returns exactly one row (avoids the n8n 204/zero-item traps).

-- ---------- 1. insert_outreach ----------
create or replace function public.insert_outreach(
    p_lead_id bigint,
    p_email text,
    p_subject text,
    p_body text,
    p_status text default 'queued'
) returns table (id bigint, ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id bigint;
begin
    insert into public.outreach (lead_id, email, subject, body, status)
    values (p_lead_id, p_email, p_subject, p_body, p_status)
    returning outreach.id into v_id;

    return query select v_id, true;
end;
$$;
-- ---------- 2. mark_outreach_sent ----------
create or replace function public.mark_outreach_sent(
    p_id bigint
) returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.outreach
       set status = 'sent',
           sent_at = now()
     where id = p_id;

    return query select true;
end;
$$;
-- ---------- 3. mark_lead_emailed ----------
create or replace function public.mark_lead_emailed(
    p_lead_id bigint
) returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.staged_leads
       set status = 'emailed'
     where id = p_lead_id;

    insert into public.lead_events (lead_id, event_type, event_data)
    values (p_lead_id, 'lead.outreach.email.sent',
            jsonb_build_object('status', 'emailed'));

    return query select true;
end;
$$;
-- ---------- 4. grants ----------
grant execute on function public.insert_outreach(bigint, text, text, text, text) to service_role;
grant execute on function public.mark_outreach_sent(bigint) to service_role;
grant execute on function public.mark_lead_emailed(bigint) to service_role;
