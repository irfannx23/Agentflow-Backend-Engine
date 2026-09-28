-- ============================================
-- Pre-CRM Engine v2 — Migration 15: reply -> deal RPCs
-- ============================================
-- M6: the reply->deal cron (n8n workflow id=2, every 15 min) polls for
-- replied outreach rows that don't have a HubSpot deal yet, creates the
-- deal, and records its id on the outreach row. The partial index from
-- migration 10 (status='replied' AND deal_id IS NULL) serves the poll.
-- Each RPC returns exactly one row (avoids the n8n 204/zero-item traps).

-- ---------- 1. get_replied_outreach ----------
-- Returns replied outreach rows lacking a deal_id as a SINGLE jsonb array
-- (one row per call -> no zero-item trap). Joined to staged_leads so the
-- cron has company name / icp score for the deal without a second lookup.
create or replace function public.get_replied_outreach(
    p_limit int default 10
) returns table (ok boolean, rows jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_rows jsonb;
begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id',               o.id,
        'lead_id',          o.lead_id,
        'email',            o.email,
        'subject',          o.subject,
        'company_name',     s.company_name,
        'icp_score',        s.icp_score,
        'reply_received_at', o.reply_received_at
    ) order by o.reply_received_at), '[]'::jsonb)
    into v_rows
    from public.outreach o
    left join public.staged_leads s on s.id = o.lead_id
    where o.status = 'replied'
      and o.deal_id is null
    limit p_limit;

    return query select true, v_rows;
end;
$$;
-- ---------- 2. mark_deal_created ----------
-- Records the HubSpot deal id on an outreach row + a timeline event so the
-- whole reply->deal journey is observable (mirrors mark_lead_emailed).
create or replace function public.mark_deal_created(
    p_id bigint,
    p_deal_id text
) returns table (ok boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_lead_id bigint;
begin
    select lead_id into v_lead_id
      from public.outreach
     where id = p_id;

    update public.outreach
       set deal_id = p_deal_id
     where id = p_id;

    if v_lead_id is not null then
        insert into public.lead_events (lead_id, event_type, event_data)
        values (v_lead_id, 'lead.outreach.deal.created',
                jsonb_build_object('deal_id', p_deal_id, 'outreach_id', p_id));
    end if;

    return query select true;
end;
$$;
-- ---------- 3. grants ----------
grant execute on function public.get_replied_outreach(int) to service_role;
grant execute on function public.mark_deal_created(bigint, text) to service_role;
