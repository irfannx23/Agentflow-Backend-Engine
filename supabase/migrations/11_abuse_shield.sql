-- ============================================
-- Pre-CRM Engine v2 — Migration 11: abuse shield
-- ============================================
-- Anti-bot / cost-protection layer (M0.5). Records every dropped/flood
-- event so the engine can log who/what it blocked (honeypot, too-fast,
-- per-IP flood, daily circuit breaker, Turnstile failures) and prove the
-- protection in demos. Dropped events are logged, never silently lost.
--
-- RPCs (each returns exactly one row — avoids the n8n 204/zero-item traps):
--   * record_abuse(p_reason, p_ip, p_email, p_payload)        -> ok
--   * count_abuse_since(p_reason, p_since, p_ip)              -> count
--   * count_events_since(p_since)                             -> count (daily circuit breaker)

create table if not exists public.abuse_events (
    id          bigint generated always as identity primary key,
    reason      text not null,
        -- honeypot | too_fast | ip_flood | daily_cap | turnstile_missing | turnstile_failed
    ip          text,
    email       text,
    payload     jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);
create index if not exists abuse_events_created_idx
    on public.abuse_events (created_at desc);
create index if not exists abuse_events_reason_idx
    on public.abuse_events (reason);
-- ---------- RPC: record an abuse event ----------
create or replace function public.record_abuse(
    p_reason text,
    p_ip text default null,
    p_email text default null,
    p_payload jsonb default '{}'::jsonb
) returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.abuse_events (reason, ip, email, payload)
    values (p_reason, p_ip, p_email, p_payload);

    return query select true;
end;
$$;
-- ---------- RPC: count abuse events (per reason, optional IP, since time) ----------
create or replace function public.count_abuse_since(
    p_reason text,
    p_since timestamptz,
    p_ip text default null
) returns table (count bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
    select count(*)::bigint
    from public.abuse_events
    where reason = p_reason
      and created_at >= p_since
      and (p_ip is null or ip = p_ip);
end;
$$;
-- ---------- RPC: count ALL leads created since time (daily circuit breaker) ----------
create or replace function public.count_events_since(
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
    where created_at >= p_since;
end;
$$;
-- ---------- RLS: service_role full access (mirror other tables) ----------
alter table public.abuse_events enable row level security;
drop policy if exists "service_role_all_abuse" on public.abuse_events;
create policy "service_role_all_abuse"
    on public.abuse_events for all to service_role using (true) with check (true);
grant select, insert, update, delete on public.abuse_events to service_role;
grant execute on function public.record_abuse(text, text, text, jsonb) to service_role;
grant execute on function public.count_abuse_since(text, timestamptz, text) to service_role;
grant execute on function public.count_events_since(timestamptz) to service_role;
