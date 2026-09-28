# Backend Supabase schema baseline

The linked project has historical migrations `01`–`41`, now preserved verbatim in `supabase/migrations/`. They are the legacy baseline and must not be rewritten. New work is forward-only and begins with `202609280001_repair_revops_and_add_dispatch_outbox.sql`.

The current reconstruction strategy is:

1. Apply migrations `01`–`41` in their recorded order for the historical schema.
2. Apply all timestamped remediation migrations after that baseline.
3. Treat this repository—not manual SQL—as the source for future function/table changes.
4. Use `supabase db push --dry-run --include-all` before applying linked changes.
5. Run `supabase db lint --linked --schema public --level error` after changes.
6. Never delete or squash the fetched baseline until a separately reviewed replacement baseline has been tested from an empty project.

## New remediation contracts

### `workflow_dispatch_outbox`

Unique key: `(event_id, workflow_id)`. States: `pending`, `processing`, `succeeded`, `permanent_failed`. The backend claims due work with `claim_workflow_dispatches` and resolves it with `resolve_workflow_dispatch`. Stale processing leases are recoverable and transient failures use bounded exponential backoff.

### Reply-to-Deal recovery

`outreach` now records `deal_processing_status`, `deal_completed_at`, and `deal_last_error`. `get_replied_outreach` returns incomplete work even after a durable CRM deal ID is recorded. `mark_reply_deal_completed` removes the row from polling only after qualification, routing, CRM sync, Slack, and Slack sync have completed.

### PQL owner routing

`assign_pql_sales_owner` preserves its public signature and behavior. Ambiguous references are removed by qualified aliases and `ON CONFLICT ON CONSTRAINT sales_assignments_lead_id_key`.

## Security expectations

- RLS remains enabled on all workflow-owned tables.
- The service-role key is server-only and available only to n8n/backend components that require it.
- New outbox/RPC access is revoked from `anon` and `authenticated`, then granted to `service_role`.
- AgentFlow/Firebase remains the identity authority. Backend identity tables are projections for intelligence joins, not authentication sources.
