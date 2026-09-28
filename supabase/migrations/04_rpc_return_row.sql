-- ============================================
-- Pre-CRM Engine — Migration 04: RPCs return a row (fixes n8n 204 trap)
-- ============================================
-- The void RPCs returned HTTP 204 No Content with an empty body, and the
-- n8n HTTP Request nodes use responseFormat: json — an empty body fails
-- JSON parsing, killing the branch AFTER the side effect (DB write) but
-- before any downstream node (Stage 6 scoring never fired, executions
-- showed status: error despite data being written).
--
-- Fix: redefine the three void RPCs to return table(ok boolean) with a
-- single row, mirroring the get_or_create_lead pattern (always exactly
-- one row — no zero-item trap, no empty-body parse error).

-- ---------- 1. append_lead_event ----------
drop function if exists public.append_lead_event(bigint, text, jsonb);
create function public.append_lead_event(
    p_lead_id bigint,
    p_event_type text,
    p_event_data jsonb default '{}'::jsonb
) returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.lead_events (lead_id, event_type, event_data)
    values (p_lead_id, p_event_type, p_event_data);

    return query select true;
end;
$$;
-- ---------- 2. log_spam ----------
drop function if exists public.log_spam(text, text, text, jsonb);
create function public.log_spam(
    p_event_id text,
    p_email text,
    p_reason text,
    p_raw_payload jsonb default '{}'::jsonb
) returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.spam_log (event_id, email, reason, raw_payload)
    values (p_event_id, p_email, p_reason, p_raw_payload);

    return query select true;
end;
$$;
-- ---------- 3. update_lead_score ----------
drop function if exists public.update_lead_score(bigint, integer, text, text, text);
create function public.update_lead_score(
    p_lead_id bigint,
    p_icp_score integer,
    p_buying_intent text default null,
    p_icebreaker text default null,
    p_status text default null
) returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.staged_leads
       set icp_score             = p_icp_score,
           buying_intent         = p_buying_intent,
           personalized_icebreaker = p_icebreaker,
           status                = coalesce(p_status, status)
     where id = p_lead_id;

    insert into public.lead_events (lead_id, event_type, event_data)
    values (p_lead_id, 'lead.scored',
            jsonb_build_object(
                'icp_score',       p_icp_score,
                'buying_intent',   p_buying_intent,
                'icebreaker',      p_icebreaker,
                'status',          p_status
            ));

    return query select true;
end;
$$;
-- ---------- 4. grants ----------
grant execute on function public.append_lead_event(bigint, text, jsonb) to service_role;
grant execute on function public.log_spam(text, text, text, jsonb) to service_role;
grant execute on function public.update_lead_score(bigint, integer, text, text, text) to service_role;
