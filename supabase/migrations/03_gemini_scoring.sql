-- ============================================
-- Pre-CRM Engine — Migration 03: Stage 6 — Gemini AI Scoring persistence
-- ============================================
-- Adds:
--   * buying_intent column on staged_leads (icp_score + personalized_icebreaker
--     already exist from migration 01; status from migration 02)
--   * update_lead_score RPC: persists the Gemini score on the lead and appends
--     a 'lead.scored' event to the timeline (identity-stitching continuity)
--
-- Business rules (see .clinerules):
--   * Only new leads are scored; duplicates are never re-scored.
--   * icp_score >= 70 -> status 'qualified', else -> 'nurture'
--     (Module 4 smart routing reads these later).
--   * The score is stored, the model decision is never stored raw.

-- ---------- 1. buying_intent column ----------
alter table public.staged_leads
    add column if not exists buying_intent text;
-- ---------- 2. update_lead_score RPC ----------
create or replace function public.update_lead_score(
    p_lead_id bigint,
    p_icp_score integer,
    p_buying_intent text default null,
    p_icebreaker text default null,
    p_status text default null
) returns void
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
end;
$$;
-- ---------- 3. grants ----------
grant execute on function public.update_lead_score(bigint, integer, text, text, text) to service_role;
