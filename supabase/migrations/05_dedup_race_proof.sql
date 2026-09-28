-- ============================================
-- Pre-CRM Engine — Migration 05: race-proof dedup + email uniqueness
-- ============================================
-- Problem found during Stage 6 E2E (Aug 2026): two webhooks arriving within
-- ~1s both passed the get_or_create_lead SELECT (row not yet visible) and
-- both INSERTed — duplicate rows for the same email. event_id uniqueness
-- alone cannot guard this.
--
-- Fixes:
--   * de-duplicate existing rows (keep smallest id per email; lead_events
--     cascade-delete with the removed rows)
--   * unique index on lower(email) — hard DB-level guarantee
--   * get_or_create_lead rewritten with ON CONFLICT so concurrent inserts
--     are serialized: one wins, the loser returns the winner's row (is_new
--     correctly reflects who actually inserted)

-- ---------- 1. dedupe existing rows ----------
delete from public.staged_leads a
using public.staged_leads b
where a.email = b.email
  and a.id > b.id;
-- ---------- 2. hard uniqueness on email ----------
create unique index if not exists staged_leads_email_lower_unique
    on public.staged_leads (lower(email));
-- ---------- 3. race-proof get_or_create_lead ----------
drop function if exists public.get_or_create_lead(text, text, text, jsonb, jsonb);
create function public.get_or_create_lead(
    p_event_id text,
    p_email text,
    p_company_name text,
    p_raw_payload jsonb,
    p_firmographics jsonb
) returns table (lead_id bigint, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lead_id bigint;
    v_is_new boolean;
begin
    insert into public.staged_leads (event_id, email, company_name, raw_payload, firmographics, status)
    values (p_event_id, lower(p_email), p_company_name, p_raw_payload, p_firmographics, 'new')
    on conflict (lower(email)) do nothing
    returning id into v_lead_id;

    if v_lead_id is null then
        -- a concurrent insert won the race (or the lead already existed):
        -- return the existing row, never create a duplicate
        select id into v_lead_id
        from public.staged_leads
        where lower(email) = lower(p_email)
        order by id
        limit 1;

        v_is_new := false;
    else
        v_is_new := true;
    end if;

    return query select v_lead_id, v_is_new;
end;
$$;
-- ---------- 4. grants ----------
grant execute on function public.get_or_create_lead(text, text, text, jsonb, jsonb) to service_role;
