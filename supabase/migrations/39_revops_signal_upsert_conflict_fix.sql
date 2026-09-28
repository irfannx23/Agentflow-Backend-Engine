-- CostPilot Phase 7 follow-up — disambiguate revops signal upsert conflict.

create or replace function public.upsert_revops_signal(
    p_signal_key text,
    p_account_id uuid,
    p_lead_id bigint,
    p_signal_type text,
    p_source text,
    p_context jsonb
)
returns table (
    id uuid,
    signal_key text,
    signal_type text,
    status text,
    priority text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_owner_type text := public.revops_signal_owner_type(p_signal_type);
    v_owner record;
begin
    if p_account_id is null then
        raise exception 'p_account_id is required';
    end if;

    select *
    into v_owner
    from public.resolve_revops_owner(v_owner_type);

    return query
    insert into public.revops_signals (
        signal_key,
        account_id,
        lead_id,
        signal_type,
        priority,
        source,
        status,
        owner_type,
        sales_rep_id,
        internal_team_id,
        context
    ) values (
        p_signal_key,
        p_account_id,
        p_lead_id,
        p_signal_type,
        public.revops_signal_priority(p_signal_type),
        coalesce(nullif(btrim(p_source), ''), 'lifecycle_engine'),
        'pending',
        v_owner_type,
        v_owner.sales_rep_id,
        v_owner.internal_team_id,
        coalesce(p_context, '{}'::jsonb)
    )
    on conflict on constraint revops_signals_signal_key_key do update
    set
        lead_id = coalesce(excluded.lead_id, public.revops_signals.lead_id),
        priority = excluded.priority,
        source = excluded.source,
        owner_type = excluded.owner_type,
        sales_rep_id = excluded.sales_rep_id,
        internal_team_id = excluded.internal_team_id,
        context = excluded.context,
        updated_at = now()
    where public.revops_signals.status in ('pending', 'processing', 'failed')
    returning
        public.revops_signals.id,
        public.revops_signals.signal_key,
        public.revops_signals.signal_type,
        public.revops_signals.status,
        public.revops_signals.priority;
end;
$$;
grant execute on function public.upsert_revops_signal(text, uuid, bigint, text, text, jsonb) to service_role;
