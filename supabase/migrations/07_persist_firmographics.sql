-- ============================================
-- Pre-CRM Engine — Migration 07: persist enriched firmographics
-- ============================================
-- update_lead_score gains an optional p_firmographics param so the merged
-- (enriched) firmographics are stored on the lead, not just used in the
-- Gemini prompt. (Drop+create: adding a param changes the signature.)

drop function if exists public.update_lead_score(bigint, integer, text, text, text);
create function public.update_lead_score(
    p_lead_id bigint,
    p_icp_score integer,
    p_buying_intent text default null,
    p_icebreaker text default null,
    p_status text default null,
    p_firmographics jsonb default null
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
           status                = coalesce(p_status, status),
           firmographics         = coalesce(p_firmographics, firmographics)
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
grant execute on function public.update_lead_score(bigint, integer, text, text, text, jsonb) to service_role;
