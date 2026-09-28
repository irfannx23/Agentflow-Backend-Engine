-- ============================================
-- Pre-CRM Engine — Migration 02: Dedup, Timeline & Spam Log
-- ============================================
-- Stage 3 (Deduplication & Identity Stitching) and Stage 1
-- fail-logging support.
--
-- Adds:
--   * status column on staged_leads ('new' | 'duplicate' | 'unverified'
--     | 'disqualified' | 'nurture' | 'qualified')
--   * lead_events: append-only event timeline per lead (identity stitching)
--   * spam_log: where Stage 1 rejected payloads get logged instead of dropped
--
-- Business rules (see .clinerules):
--   * Identity stitching: check existing emails before creating records.
--   * Never create duplicates — append events to the existing record.
--   * Rejected leads are logged, not silently lost.

-- ---------- 1. status column on staged_leads ----------
alter table public.staged_leads
    add column if not exists status text not null default 'new';
create index if not exists staged_leads_status_idx
    on public.staged_leads (status);
-- ---------- 2. lead_events (identity stitching timeline) ----------
create table if not exists public.lead_events (
    id          bigint generated always as identity primary key,
    lead_id     bigint not null references public.staged_leads (id) on delete cascade,
    event_type  text not null,               -- e.g. 'lead.captured', 'form.submitted', 'pricing.visited'
    event_data  jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);
create index if not exists lead_events_lead_id_idx
    on public.lead_events (lead_id);
create index if not exists lead_events_created_at_idx
    on public.lead_events (created_at desc);
-- ---------- 3. spam_log (Stage 1 rejections) ----------
create table if not exists public.spam_log (
    id          bigint generated always as identity primary key,
    event_id    text,
    email       text,
    reason      text not null,               -- email_invalid_format | temporary_email_provider | personal_domain | student_domain | competitor_domain | malformed_payload
    raw_payload jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);
create index if not exists spam_log_created_at_idx
    on public.spam_log (created_at desc);
-- ---------- 4. helper: find or create lead by email (identity stitching) ----------
-- Returns the staged_leads id for an email. If a row already exists it is
-- returned (no duplicate created); otherwise a new row is inserted with
-- status 'new'. Returns (lead_id, is_new) so callers can append the right
-- event type to the timeline.
create or replace function public.get_or_create_lead(
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
    select id into v_lead_id
    from public.staged_leads
    where lower(email) = lower(p_email)
    order by id
    limit 1;

    v_is_new := v_lead_id is null;

    if v_is_new then
        insert into public.staged_leads (event_id, email, company_name, raw_payload, firmographics, status)
        values (p_event_id, lower(p_email), p_company_name, p_raw_payload, p_firmographics, 'new')
        returning id into v_lead_id;
    end if;

    return query select v_lead_id, v_is_new;
end;
$$;
-- ---------- 5. helper: append an event to a lead's timeline ----------
create or replace function public.append_lead_event(
    p_lead_id bigint,
    p_event_type text,
    p_event_data jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.lead_events (lead_id, event_type, event_data)
    values (p_lead_id, p_event_type, p_event_data);
end;
$$;
-- ---------- 6. helper: log a Stage 1 rejection ----------
create or replace function public.log_spam(
    p_event_id text,
    p_email text,
    p_reason text,
    p_raw_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.spam_log (event_id, email, reason, raw_payload)
    values (p_event_id, p_email, p_reason, p_raw_payload);
end;
$$;
-- ---------- 7. RLS: service_role full access on new tables ----------
alter table public.lead_events enable row level security;
alter table public.spam_log enable row level security;
drop policy if exists "service_role_all_events" on public.lead_events;
create policy "service_role_all_events"
    on public.lead_events for all to service_role using (true) with check (true);
drop policy if exists "service_role_all_spam" on public.spam_log;
create policy "service_role_all_spam"
    on public.spam_log for all to service_role using (true) with check (true);
grant select, insert, update, delete on public.lead_events to service_role;
grant select, insert, update, delete on public.spam_log to service_role;
grant usage, select on all sequences in schema public to service_role;
