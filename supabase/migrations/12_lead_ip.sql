-- ============================================
-- Pre-CRM Engine v2 — Migration 12: per-IP flood counter
-- ============================================
-- The anti-abuse gate (M0.5) needs to count how many leads arrive from the
-- same IP in a window (>30/10min = flood). staged_leads gains an `ip` column,
-- get_or_create_lead stores it (default null, so the v1 5-field call and the
-- v2 6-field call both still resolve via defaults), and count_leads_by_ip_since
-- lets the gate query it.

-- ---------- 1. ip column ----------
alter table public.staged_leads
    add column if not exists ip text;
create index if not exists staged_leads_ip_idx
    on public.staged_leads (ip, created_at);
-- ---------- 2. get_or_create_lead v3 (adds p_ip, source_type retained) ----------
drop function if exists public.get_or_create_lead(text, text, text, jsonb, jsonb, text);
create function public.get_or_create_lead(
    p_event_id text,
    p_email text,
    p_company_name text,
    p_raw_payload jsonb,
    p_firmographics jsonb,
    p_source_type text default 'inbound',
    p_ip text default null
) returns table (lead_id bigint, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lead_id bigint;
    v_is_new boolean;
begin
    insert into public.staged_leads (event_id, email, company_name, raw_payload, firmographics, status, source_type, ip)
    values (p_event_id, lower(p_email), p_company_name, p_raw_payload, p_firmographics, 'new', p_source_type, p_ip)
    on conflict (lower(email)) do nothing
    returning id into v_lead_id;

    if v_lead_id is null then
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
-- ---------- 3. count_leads_by_ip_since RPC ----------
create or replace function public.count_leads_by_ip_since(
    p_ip text,
    p_since timestamptz
) returns table (count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
    select count(*)::bigint
    from public.staged_leads
    where ip = p_ip
      and created_at >= p_since;
end;
$$;
-- ---------- 4. grants ----------
grant execute on function public.get_or_create_lead(text, text, text, jsonb, jsonb, text, text) to service_role;
grant execute on function public.count_leads_by_ip_since(text, timestamptz) to service_role;
