-- CostPilot Phase 6 — Product Events + Lifecycle Intelligence hardening
-- Adds retry-safe event identity and an explicit trusted/untrusted boundary to
-- the existing product_events table. Lifecycle scores remain derived server-side
-- through the existing activation, qualification, and account health views/RPCs.

alter table public.product_events
    add column if not exists event_id text,
    add column if not exists occurred_at timestamptz not null default now(),
    add column if not exists event_trust_level text not null default 'untrusted';
alter table public.product_events
    drop constraint if exists product_events_event_id_nonempty_check;
alter table public.product_events
    add constraint product_events_event_id_nonempty_check
        check (event_id is null or length(trim(event_id)) > 0);
alter table public.product_events
    drop constraint if exists product_events_trust_level_check;
alter table public.product_events
    add constraint product_events_trust_level_check
        check (event_trust_level in ('trusted', 'untrusted'));
alter table public.product_events
    drop constraint if exists product_events_event_source_check;
alter table public.product_events
    add constraint product_events_event_source_check
        check (
            event_source is null
            or event_source in (
                'web_app',
                'server',
                'system',
                'usage_ingest_api',
                'billing',
                'n8n',
                'gateway'
            )
        );
do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'product_events_event_id_unique'
          and conrelid = 'public.product_events'::regclass
    ) then
        alter table public.product_events
            add constraint product_events_event_id_unique unique (event_id);
    end if;
end $$;
create index if not exists product_events_account_occurred_at_idx
    on public.product_events (account_id, occurred_at desc);
create index if not exists product_events_trust_source_idx
    on public.product_events (event_trust_level, event_source, occurred_at desc);
