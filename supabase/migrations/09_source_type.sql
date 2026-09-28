-- ============================================
-- Pre-CRM Engine v2 — Migration 09: source_type dual-mode routing
-- ============================================
-- v2 unifies inbound + outbound on the same core. Leads are tagged with a
-- source_type so the engine can branch the OUTPUT route:
--   * 'inbound'          -> v1 path (HubSpot deal+contact, nurture) [untouched]
--   * 'outbound_scraped' -> outbound gate -> AI outreach loop (v2)
--
-- get_or_create_lead gains a p_source_type param (default 'inbound') so the
-- EXISTING v1 n8n call body (5 fields) still resolves via the default — the
-- running v1 workflow keeps working without a rebuild. Drop+create: adding a
-- param changes the function signature (SQLSTATE 42P13 otherwise).

-- ---------- 1. source_type column on staged_leads ----------
alter table public.staged_leads
    add column if not exists source_type text not null default 'inbound';
alter table public.staged_leads
    add constraint staged_leads_source_type_check
    check (source_type in ('inbound', 'outbound_scraped'));
create index if not exists staged_leads_source_type_idx
    on public.staged_leads (source_type);
-- ---------- 2. get_or_create_lead v2 (source_type-aware, race-proof) ----------
drop function if exists public.get_or_create_lead(text, text, text, jsonb, jsonb);
create function public.get_or_create_lead(
    p_event_id text,
    p_email text,
    p_company_name text,
    p_raw_payload jsonb,
    p_firmographics jsonb,
    p_source_type text default 'inbound'
) returns table (lead_id bigint, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lead_id bigint;
    v_is_new boolean;
begin
    insert into public.staged_leads (event_id, email, company_name, raw_payload, firmographics, status, source_type)
    values (p_event_id, lower(p_email), p_company_name, p_raw_payload, p_firmographics, 'new', p_source_type)
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
-- ---------- 3. grants ----------
grant execute on function public.get_or_create_lead(text, text, text, jsonb, jsonb, text) to service_role;
