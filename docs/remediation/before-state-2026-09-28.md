# Controlled remediation snapshot — 2026-09-28

This snapshot contains configuration metadata only. It contains no credentials or customer rows.

## Repository state before remediation

Both repositories already contained uncommitted work. No reset, checkout, commit, or push was performed. The pre-existing backend changes covered `.env.example`, documentation, the Lead Qualification builder/JSON, MX/runtime/test files, and untracked Compose/runtime/Supabase files. AgentFlow already contained changes to its environment example, auth/event emission, account state, and tests. Those edits were preserved.

## Local runtime before remediation

- Compose project: `agentflow-backend-engine`
- Containers: `agentflow_n8n`, `agentflow_mx`, `agentflow_litellm`
- Persistent n8n volume: external `costpilot_n8n_data`; retained and not modified destructively
- Published ports were all-interface bindings before remediation.
- n8n had no Compose healthcheck and every service loaded the full backend `.env`.
- Backend event server listened on `127.0.0.1:4310`.

## n8n workflow snapshot

A complete nine-workflow export was written inside the existing n8n volume at:

`/home/node/.n8n/remediation-snapshot-20260928`

Before import:

| Workflow | ID | Active |
|---|---|---:|
| Lead Qualification candidate | `idce7uRAdybKu3PI` | no |
| Reply-to-Deal | `YKd8JZItw9IupV2z` | no |
| Product Signals (old active RevOps definition) | `Md7uChUMimNG5BFt` | yes |
| CostPilot RevOps Signal Orchestration | `revops-signal-orchestration` | no |
| Other legacy/prototype workflows | various | no |

The live database contained multiple inactive Lead Qualification copies. Only the selected canonical ID was later published; legacy copies remain inactive for rollback/history.

## Linked Supabase snapshot

A schema-only pre-change dump was captured at `/private/tmp/agentflow-backend-schema-before.sql`. Remote migration history contained versions `01` through `41`; `supabase migration fetch` restored those exact migration sources under `supabase/migrations/` without rewriting remote history.

The pre-change schema had 29 tables, 43 views, 33 functions/RPCs, 19 update triggers, service-role RLS policies, indexes, foreign keys, and check constraints. The workflow dependency graph was:

```text
AgentFlow event
  -> product_events
  -> evaluate_account_health -> customer_health_evaluations/current_customer_health
  -> generate_revops_signals -> revops_signals/revops_signal_queue
  -> n8n RevOps claims/results -> revops_signals

user.registered
  -> n8n Lead Qualification
  -> staged_leads -> lead_events
  -> qualification_evaluations
  -> sales_assignments -> sales_assignment_history
  -> outreach

Reply schedule/webhook
  -> outreach/get_replied_outreach
  -> HubSpot deal
  -> qualification_evaluations/sales_assignments
  -> outreach completion state
```

Pre-change database lint reproduced SQLSTATE `42702` in `assign_pql_sales_owner`, specifically `on conflict (lead_id)` conflicting with the function output variable named `lead_id`.
