-- ============================================
-- Pre-CRM Engine v2 — Migration 10: outreach ledger
-- ============================================
-- Outbound AI-outreach history (v2 Stage E). Tracks every AI-generated cold
-- email sent to a ready_to_push lead, its status, and whether the prospect
-- replied (which then creates a HubSpot deal via the reply->deal route).
--
-- Status flow: queued -> sent -> (failed) | replied
--   * queued   - generated, not yet dispatched
--   * sent     - dispatched via Brevo
--   * failed   - dispatch error (logged, never silently lost)
--   * replied  - prospect replied -> triggers deal creation
--
-- deal_id holds the HubSpot deal id once the reply->deal route runs, so the
-- cron can pick only rows still needing a deal.

create table if not exists public.outreach (
    id                bigint generated always as identity primary key,
    lead_id           bigint not null references public.staged_leads (id) on delete cascade,
    email             text not null,
    subject           text not null,
    body              text not null,
    status            text not null default 'queued'
        check (status in ('queued', 'sent', 'failed', 'replied')),
    sent_at           timestamptz,
    next_followup_at  timestamptz,
    reply_received_at timestamptz,
    deal_id           text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
create index if not exists outreach_lead_id_idx
    on public.outreach (lead_id);
create index if not exists outreach_status_idx
    on public.outreach (status);
create index if not exists outreach_replied_unprocessed_idx
    on public.outreach (status)
    where status = 'replied' and deal_id is null;
-- Keep updated_at fresh on updates.
create trigger outreach_set_updated_at
    before update on public.outreach
    for each row
    execute function public.set_updated_at();
-- ---------- RLS: service_role full access (mirror lead_events/spam_log) ----------
alter table public.outreach enable row level security;
drop policy if exists "service_role_all_outreach" on public.outreach;
create policy "service_role_all_outreach"
    on public.outreach for all to service_role using (true) with check (true);
grant select, insert, update, delete on public.outreach to service_role;
grant usage, select on all sequences in schema public to service_role;
