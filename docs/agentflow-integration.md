# AgentFlow Integration

## Architecture

```text
AgentFlow action
  → Firebase ID token
  → AgentFlow /api/events identity verification
  → HMAC-signed event envelope
  → agentflow-backend-engine /v1/events
  → product_events in existing Supabase
  → qualification / health / lifecycle / signal evaluation
  → optional n8n workflow dispatch
```

The repositories remain independent. AgentFlow owns action capture and Firebase identity verification. The backend owns contract validation, trusted persistence, intelligence evaluation, and n8n dispatch.

## Event contract

Every event contains `eventId`, `event`, `timestamp`, `userId`, nullable `projectId`, nullable `workspaceId`, `metadata`, `source: "agentflow"`, and `version: "1.0"`. AgentFlow supplies the action fields; its server route replaces `userId` with the verified Firebase identity and supplies source/version. The backend rejects unsupported names, malformed identifiers, timestamps, metadata, sources, and versions.

Server-to-server requests include `x-agentflow-timestamp` and `x-agentflow-signature`. The signature is HMAC-SHA256 over `<timestamp>.<raw body>`. Signatures older than five minutes are rejected.

## Backend endpoints

- `GET /health` returns local service readiness.
- `POST /v1/events` authenticates, validates, stores, evaluates, and dispatches a canonical event.

The event is stored in the existing `product_events` table using `event_id`, `event_name`, `event_properties`, `event_source`, `event_trust_level`, `firebase_uid`, and `occurred_at`. The persistence adapter uses the table's existing `web_app` source and `trusted` trust-level vocabulary, while retaining `integrationSource: "agentflow"` and the original contract name in `event_properties`. Signal-capable dotted contract names are normalized to the existing underscore event vocabulary. No migration or schema change is required.

## Signal flow

Product actions are normalized to existing runtime event names only when a real signal definition exists. The backend then optionally calls existing `evaluate_lead_qualification`, `evaluate_account_health`, and `generate_revops_signals` RPCs when `leadId` or `accountId` is present in verified event metadata. Missing business evidence remains unevaluated.

## Workflow dispatch

| Workflow | Dispatch behavior |
| --- | --- |
| Lead Qualification | Authenticated `agentflow-lead-qualification` webhook through `N8N_LEAD_QUALIFICATION_DISPATCH_URL`; only `user.registered` is adapted from AgentFlow, using real signup identity fields. |
| Reply-to-Deal | Additive `agentflow-reply-to-deal` webhook through `N8N_REPLY_TO_DEAL_DISPATCH_URL`; the existing schedule remains authoritative. |
| RevOps Signal Orchestration | Additive `agentflow-revops-signals` webhook; automatically dispatched when event evaluation produces runtime or persisted RevOps signals. |

Dispatch URLs are configuration boundaries. Every backend-facing webhook validates
`X-AgentFlow-Dispatch-Secret` before database or provider work. Scheduled/manual
entry points remain available where applicable. An unset URL produces an explicit
configuration failure rather than an unauthenticated fallback.

`user.registered` is the sole authentication event adapted into Lead Qualification input. The adapter uses the canonical event ID for idempotency, requires the real registration email, marks the lead as `source: "agentflow_signup"` and `source_type: "inbound"`, and passes only available identity/event context in `raw_payload`. `user.logged_in` never creates a lead. The registration payload enters the existing webhook before Anti-Abuse Gate and Sanitize Lead, so no verification, deduplication, enrichment, qualification, or routing stage is bypassed.

## Local development

1. Configure backend `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AGENTFLOW_INTEGRATION_SECRET`, and the required n8n dispatch URLs.
2. Configure AgentFlow `AGENTFLOW_BACKEND_URL=http://127.0.0.1:4310` and the same `AGENTFLOW_INTEGRATION_SECRET`.
3. Start local n8n and ensure configured dispatch URLs resolve to the existing workflow entry points.
4. Run `pnpm start:events` in the backend.
5. Run `pnpm dev` in AgentFlow.

Never expose the integration secret, Supabase service-role key, or n8n dispatch secret through `NEXT_PUBLIC_` variables.

## Testing

Backend tests simulate login, project creation, generation, download, repair, import, and archive. They verify contract validation, authenticated envelope handling, persistence adapter calls, signal output, n8n dispatch, and the observability stages `incoming → stored/validation → qualification → signals → dispatch → completed`.

Run `pnpm test` in each repository. Live Supabase and n8n smoke tests require local credentials and are intentionally separate from deterministic CI tests.
