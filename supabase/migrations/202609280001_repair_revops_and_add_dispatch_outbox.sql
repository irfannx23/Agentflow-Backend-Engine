-- Controlled remediation: repair PQL routing ambiguity and add durable n8n delivery.
-- This migration is additive except for replacing one existing function body.

create or replace function public.assign_pql_sales_owner(
  p_signal_key text,
  p_lead_id bigint,
  p_signal_type text,
  p_trigger text default 'pql_product_trigger'
) returns table(
  lead_id bigint,
  assignment_id uuid,
  current_rep_id uuid,
  current_owner_type text,
  routing_status text,
  routing_reason text,
  reused boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_assignment public.sales_assignments%rowtype;
  v_selected_rep public.sales_reps%rowtype;
  v_new_assignment uuid;
begin
  if p_signal_key is null or btrim(p_signal_key) = '' then
    raise exception 'invalid_signal_key';
  end if;
  if p_lead_id is null then
    return query select null::bigint, null::uuid, null::uuid, null::text,
      'not_applicable'::text, 'pql_signal_without_lead'::text, false;
    return;
  end if;

  if p_signal_type not in ('PQL_REACHED', 'UPGRADE_INTENT') then
    return query select p_lead_id, null::uuid, null::uuid, null::text,
      'not_applicable'::text, 'signal_type_not_sales_handoff'::text, false;
    return;
  end if;

  select sa.* into v_existing_assignment
  from public.sales_assignments as sa
  where sa.lead_id = p_lead_id;

  if found and v_existing_assignment.current_rep_id is not null
     and v_existing_assignment.routing_status in ('assigned', 'handed_off', 'manually_overridden') then
    return query select p_lead_id, v_existing_assignment.id, v_existing_assignment.current_rep_id,
      v_existing_assignment.current_owner_type, v_existing_assignment.routing_status,
      coalesce(v_existing_assignment.routing_reason, 'existing_owner_reused'), true;
    return;
  end if;

  select rep.* into v_selected_rep
  from public.sales_reps as rep
  left join lateral (
    select count(*)::integer as active_load
    from public.sales_assignments as assignment
    where assignment.current_rep_id = rep.id
      and assignment.routing_status in ('assigned', 'handoff_pending', 'handed_off', 'manually_overridden')
  ) as load on true
  where rep.active = true
    and rep.role = 'sdr'
    and coalesce(load.active_load, 0) < rep.capacity
  order by coalesce(load.active_load, 0), rep.created_at, rep.rep_code
  limit 1;

  if v_selected_rep.id is null then
    return query select p_lead_id, v_existing_assignment.id,
      v_existing_assignment.current_rep_id, v_existing_assignment.current_owner_type,
      'retry_required'::text, 'no_available_sdr'::text, false;
    return;
  end if;

  insert into public.sales_assignments as target (
    lead_id, current_rep_id, current_owner_type,
    routing_status, routing_reason, eligible_for_sales
  ) values (
    p_lead_id, v_selected_rep.id, 'sdr', 'assigned', p_trigger, false
  )
  on conflict on constraint sales_assignments_lead_id_key do update set
    current_rep_id = excluded.current_rep_id,
    current_owner_type = excluded.current_owner_type,
    routing_status = 'assigned',
    routing_reason = excluded.routing_reason;

  select sa.id into v_new_assignment
  from public.sales_assignments as sa
  where sa.lead_id = p_lead_id;

  return query select p_lead_id, v_new_assignment, v_selected_rep.id, 'sdr'::text,
    'assigned'::text, p_trigger, false;
end;
$$;

create table if not exists public.workflow_dispatch_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.product_events(event_id) on delete cascade,
  workflow_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'permanent_failed')),
  retry_count integer not null default 0 check (retry_count >= 0),
  last_error text,
  next_attempt_at timestamptz not null default now(),
  dispatched_at timestamptz,
  permanent_failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, workflow_id)
);

create index if not exists workflow_dispatch_outbox_due_idx
  on public.workflow_dispatch_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'processing');

alter table public.workflow_dispatch_outbox enable row level security;

drop policy if exists service_role_all_workflow_dispatch_outbox on public.workflow_dispatch_outbox;
create policy service_role_all_workflow_dispatch_outbox
  on public.workflow_dispatch_outbox to service_role
  using (true) with check (true);

drop trigger if exists workflow_dispatch_outbox_set_updated_at on public.workflow_dispatch_outbox;
create trigger workflow_dispatch_outbox_set_updated_at
  before update on public.workflow_dispatch_outbox
  for each row execute function public.set_updated_at();

create or replace function public.claim_workflow_dispatches(
  p_event_id text default null,
  p_limit integer default 25
) returns table(
  id uuid,
  event_id text,
  workflow_id text,
  payload jsonb,
  retry_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select o.id
    from public.workflow_dispatch_outbox as o
    where (p_event_id is null or o.event_id = p_event_id)
      and (
        (o.status = 'pending' and o.next_attempt_at <= now())
        or (o.status = 'processing' and o.updated_at < now() - interval '2 minutes')
      )
    order by o.next_attempt_at, o.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.workflow_dispatch_outbox as o
  set status = 'processing', retry_count = o.retry_count + 1, last_error = null
  from due
  where o.id = due.id
  returning o.id, o.event_id, o.workflow_id, o.payload, o.retry_count;
end;
$$;

create or replace function public.resolve_workflow_dispatch(
  p_id uuid,
  p_succeeded boolean,
  p_permanent boolean default false,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workflow_dispatch_outbox as o
  set status = case
      when p_succeeded then 'succeeded'
      when p_permanent then 'permanent_failed'
      else 'pending'
    end,
    dispatched_at = case when p_succeeded then now() else o.dispatched_at end,
    permanent_failed_at = case when not p_succeeded and p_permanent then now() else null end,
    last_error = case when p_succeeded then null else left(coalesce(p_error, 'dispatch_failed'), 1000) end,
    next_attempt_at = case
      when p_succeeded or p_permanent then o.next_attempt_at
      else now() + make_interval(secs => least(3600, (15 * power(2, least(o.retry_count, 8)))::integer))
    end
  where o.id = p_id and o.status = 'processing';
end;
$$;

revoke all on table public.workflow_dispatch_outbox from anon, authenticated;
grant all on table public.workflow_dispatch_outbox to service_role;
revoke all on function public.claim_workflow_dispatches(text, integer) from public, anon, authenticated;
grant execute on function public.claim_workflow_dispatches(text, integer) to service_role;
revoke all on function public.resolve_workflow_dispatch(uuid, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.resolve_workflow_dispatch(uuid, boolean, boolean, text) to service_role;

comment on table public.workflow_dispatch_outbox is
  'Durable, idempotent delivery state for backend-to-n8n workflow dispatch.';

alter table public.outreach
  add column if not exists deal_processing_status text not null default 'pending'
    check (deal_processing_status in ('pending', 'crm_created', 'completed', 'failed')),
  add column if not exists deal_completed_at timestamptz,
  add column if not exists deal_last_error text;

create index if not exists outreach_reply_deal_pending_idx
  on public.outreach (reply_received_at, id)
  where status = 'replied' and deal_completed_at is null;

create or replace function public.get_replied_outreach(p_limit integer default 10)
returns table(ok boolean, rows jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'lead_id', o.lead_id,
    'email', o.email,
    'subject', o.subject,
    'company_name', s.company_name,
    'icp_score', s.icp_score,
    'reply_received_at', o.reply_received_at,
    'deal_id', o.deal_id,
    'deal_processing_status', o.deal_processing_status
  ) order by o.reply_received_at), '[]'::jsonb)
  into v_rows
  from (
    select candidate.*
    from public.outreach as candidate
    where candidate.status = 'replied'
      and candidate.deal_completed_at is null
    order by candidate.reply_received_at
    limit greatest(1, least(coalesce(p_limit, 10), 100))
  ) as o
  left join public.staged_leads as s on s.id = o.lead_id;

  return query select true, v_rows;
end;
$$;

create or replace function public.mark_deal_created(p_id bigint, p_deal_id text)
returns table(ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead_id bigint;
  v_previous_deal_id text;
begin
  select o.lead_id, o.deal_id into v_lead_id, v_previous_deal_id
  from public.outreach as o
  where o.id = p_id;

  update public.outreach as o
  set deal_id = coalesce(o.deal_id, p_deal_id),
      deal_processing_status = 'crm_created',
      deal_last_error = null
  where o.id = p_id;

  if v_lead_id is not null and v_previous_deal_id is null then
    insert into public.lead_events (lead_id, event_type, event_data)
    values (v_lead_id, 'lead.outreach.deal.created',
      jsonb_build_object('deal_id', p_deal_id, 'outreach_id', p_id));
  end if;

  return query select found;
end;
$$;

create or replace function public.mark_reply_deal_completed(p_id bigint)
returns table(ok boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.outreach as o
  set deal_processing_status = 'completed', deal_completed_at = now(), deal_last_error = null
  where o.id = p_id and o.deal_id is not null;
  return query select found;
end;
$$;

revoke all on function public.mark_reply_deal_completed(bigint) from public, anon, authenticated;
grant execute on function public.mark_reply_deal_completed(bigint) to service_role;

-- Rollback (manual, only after dependency/data review): restore the function body
-- from the pre-remediation schema snapshot, then drop claim_workflow_dispatches,
-- resolve_workflow_dispatch, and workflow_dispatch_outbox in that order.
