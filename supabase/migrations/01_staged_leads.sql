-- ============================================
-- Pre-CRM Engine — Migration 01: staged_leads
-- ============================================
-- Staging table for inbound leads before sanitization,
-- scoring, and (gatekeeper-permitted) CRM write.
--
-- Business rules (see .clinerules):
--   * Identity stitching: check existing emails before insert.
--   * CRM Gatekeeper: only send to HubSpot when icp_score >= 70
--     AND email verified as deliverable.
--   * Sanitization: strip malformed text & personal domains
--     before scoring.

create table if not exists public.staged_leads (
    id              bigint generated always as identity primary key,
    event_id        text not null unique,
    email           text not null,
    company_name    text,
    raw_payload     jsonb not null default '{}'::jsonb,
    firmographics   jsonb not null default '{}'::jsonb,
    icp_score       integer,
    personalized_icebreaker text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
-- Indexes for fast lookups during identity stitching and
-- gatekeeper scoring queries.
create index if not exists staged_leads_email_idx
    on public.staged_leads (email);
create index if not exists staged_leads_icp_score_idx
    on public.staged_leads (icp_score);
-- Keep updated_at fresh on row updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;
drop trigger if exists staged_leads_set_updated_at on public.staged_leads;
create trigger staged_leads_set_updated_at
    before update on public.staged_leads
    for each row
    execute function public.set_updated_at();
-- Row-level security: enable and allow service_role full access.
alter table public.staged_leads enable row level security;
drop policy if exists "service_role_all" on public.staged_leads;
create policy "service_role_all"
    on public.staged_leads
    for all
    to service_role
    using (true)
    with check (true);
-- Grant table privileges to the API roles.
-- (Newer Supabase disables auto-expose, so explicit GRANTs are required.)
grant select, insert, update, delete on public.staged_leads to service_role;
grant usage, select on all sequences in schema public to service_role;
