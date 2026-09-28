# AgentFlow controlled remediation report — 2026-09-28

## Executive result

The canonical local runtime is materially safer and all three workflows are imported, hash-matched, active, and protected by HTTP 401 dispatch-secret gates. Backend event delivery is durable. The linked database migration is applied and lint-clean. AgentFlow and backend validation suites pass.

The system is **not production-ready** and the full Lead Qualification Loom path is **not yet demo-ready** because the configured Brevo credential returns 401 and safe sandbox CRM/Slack/email destinations were not proven. No real email, Slack message, CRM contact, or CRM deal was created during remediation.

## Fixed

- Removed the duplicate HMAC-secret definition without exposing either value.
- Canonicalized Emailable, Gemini, Apollo, HubSpot contact upsert, and Brevo request shapes.
- Selected an authenticated available Gemini model through `GEMINI_MODEL` and removed model hardcoding.
- Added explicit provider timeouts, safe retry policies, and explicit parser failures/skips.
- Persisted runtime policies in importable workflow JSON.
- Added stable backend webhook authentication and 401 responses before DB/provider nodes.
- Added real anti-abuse counters from existing RPCs.
- Added RFC 7505 null-MX handling.
- Fixed Reply-to-Deal per-item linkage and durable downstream recovery after CRM creation.
- Scoped RevOps backend runs to dispatched account IDs, retained all ten signals, and gated PQL handoff.
- Fixed `assign_pql_sales_owner` SQLSTATE 42702 through a migration.
- Added durable backend-to-n8n outbox delivery with retry/permanent-failure state.
- Scoped Docker environments by service, added n8n healthcheck, and bound ports to loopback.
- Restored the complete remote migration baseline and documented non-destructive cleanup.
- Removed Hookdeck from the canonical active path; retained its variables as explicitly legacy.

## Remaining blockers

1. **Brevo:** configured key returns HTTP 401. User must replace it and verify the sender.
2. **Safe destinations:** HubSpot authentication and pipeline/stage reads pass, but an explicit sandbox must be confirmed before a write E2E. Slack has no non-sending health endpoint.
3. **Deal create exactly-once:** local recovery prevents downstream loss after a known CRM result, but a network timeout after HubSpot accepts a deal create can still duplicate because HubSpot has no repository-configured unique deal property/idempotency key. Production requires an audited unique property or reconciliation search.
4. **DeepSeek:** optional key is missing. LiteLLM itself is healthy and advertises its alias, but DeepSeek inference is not configured. The three canonical workflows do not depend on it.
5. **Operations:** outbox retry runs inside the backend process. Production deployment still needs monitoring/alerts and a documented permanent-failure replay procedure.
6. **Database cleanup:** no destructive cleanup was approved or executed. Legacy account/cost/provider objects remain because active views/RPCs still reference them.

## Provider status

| Provider/service | Status | Evidence |
|---|---|---|
| Apollo | PASS | read-only auth health HTTP 200; no enrichment credit spent |
| Emailable | PASS (auth) | account HTTP 200; verification mocked to avoid using a real address/credit |
| Gemini | PASS | configured model read HTTP 200 |
| HubSpot | PASS (read-only) | account HTTP 200; deal pipelines HTTP 200; `default/appointmentscheduled` exists |
| Slack | UNVERIFIED | no non-sending webhook health method |
| Brevo | FAIL | account HTTP 401 |
| Supabase | PASS | PostgREST HTTP 200; post-migration lint has zero errors |
| MX | PASS | health HTTP 200 and contract tests, including null MX |
| LiteLLM | PASS (proxy only) | liveness/models HTTP 200 |
| DeepSeek upstream | NOT CONFIGURED | optional key missing |

## Environment result

All canonical required variables are set and URL-shaped variables parse as URLs. Duplicate-key scan is clean. `DEEPSEEK_API_KEY` is missing but optional. Hookdeck variables remain set but are classified legacy/unused by the canonical workflows. No secrets are exposed through AgentFlow `NEXT_PUBLIC_*` variables. `.env` remains ignored and is not listed for commit.

## Workflow status

| Workflow | Live ID | Active | Canonical/live hash | Readiness |
|---|---|---:|---|---|
| Lead Qualification | `idce7uRAdybKu3PI` | yes | `536b1a335e68` match | local contract functional; full demo blocked by Brevo/safe destinations |
| Reply-to-Deal | `YKd8JZItw9IupV2z` | yes | `1d0ccf084fc2` match | polling has zero pending rows; multi-row/recovery tests pass |
| RevOps Signal Orchestration | `Md7uChUMimNG5BFt` | yes | `39291f156586` match | RPC repair verified; scoped/signal tests pass |

Registered production webhook paths are unique: `agentflow-lead-qualification`, `agentflow-reply-to-deal`, `agentflow-revops-signals`, plus the intentional Lead outbound path. All three backend paths return 401 without the dispatch secret.

## Database migration

Applied: `202609280001_repair_revops_and_add_dispatch_outbox.sql`.

It repairs the PQL function, adds the dispatch outbox/RPCs, adds Reply-to-Deal completion state/RPC, and changes no existing customer row destructively. A null-lead no-write PQL probe returns HTTP 200 with `not_applicable`. No DROP statement was executed.

## Files in the remediation change set

Core/runtime: `runtime/event-pipeline.ts`, `runtime/event-server.ts`, `runtime/supabase-event-store.ts`, `runtime/workflow-standardizer.ts`, `core/revops/contracts/ai-qualification-score.ts`, the three edited Pre-CRM code-node snippets, MX service/check files, LiteLLM config, registry/catalog files, `.env.example`, `docker-compose.yml`, `.dockerignore`, and the MX Dockerfile.

Workflows/builders: `builders/build_lead_qualification_workflow.py`, `builders/build_reply_to_deal_workflow.py`, `builders/build_revops_signal_workflow.py`, and all three canonical workflow JSON files.

Database: `supabase/.gitignore`, fetched baseline migrations `01` through `41`, and `supabase/migrations/202609280001_repair_revops_and_add_dispatch_outbox.sql`.

Tests/validators: `testing/event-integration.test.ts`, `testing/production-engine.test.ts`, `testing/registry.test.ts`, `testing/remediation-contracts.test.ts`, `testing/legacy/pre-crm/test-verify-parse.cjs`, and `validators/validate_pre_crm_workflows.cjs`.

Operational scripts: `scripts/normalize-local-env.mjs`, `scripts/prepare-n8n-import.mjs`, `scripts/provider-health.mjs`, and `scripts/safe-event-e2e.mjs`.

Documentation: `README.md`, `docs/agentflow-integration.md`, `docs/architecture.md`, `docs/integrations.md`, `docs/runtime.md`, `docs/phase-3-production-engine.md`, the two updated Pre-CRM knowledge documents, `docs/schema-baseline.md`, `docs/supabase-cleanup-plan.md`, `docs/demo-checklist.md`, and `docs/remediation/*`.

Some listed tracked/untracked files existed in the dirty worktree before remediation; no attempt was made to erase or attribute away the user's prior edits. AgentFlow source files were not edited in this pass.

## Profile ownership

AgentFlow/Firebase should remain authoritative. Backend `public.profiles` is a non-authoritative projection, but it is still referenced by FKs, qualification/sales views, acquisition reporting, and account intelligence. It must remain until those dependencies are migrated and a later drop migration is explicitly approved.

## Validation

- AgentFlow: typecheck PASS, lint PASS, 43 tests PASS, production build PASS, diff check PASS.
- Backend: typecheck PASS, lint PASS, 40 tests PASS, production-engine 14 tests PASS, legacy validators PASS, Emailable 8/8, MX 8/8, build PASS, Compose config PASS, diff check PASS.
- Runtime: AgentFlow, backend, n8n, MX, and LiteLLM HTTP 200; all Compose services healthy and loopback-bound.
- Synthetic HMAC E2E: first `user.logged_in` accepted/persisted with zero dispatches; replay marked duplicate with zero dispatches.
- Unauthorized n8n E2E: all three canonical paths return 401.
- No external-message/CRM-write E2E was performed.

## Readiness matrix

| Subsystem | Demo-ready | Locally functional | Production-ready |
|---|---|---|---|
| AgentFlow event emission | yes | yes | no — deployment/monitoring review remains |
| Backend event/HMAC/outbox | yes | yes | no — operational replay/alerting remains |
| Lead Qualification | no | partial | no |
| Reply-to-Deal | conditional | yes by mock/contract tests | no — CRM create timeout idempotency gap |
| RevOps | conditional | yes by DB/contract tests | no |
| Backend Supabase | yes | yes | no — legacy cleanup/ownership work remains |
| Docker local runtime | yes | yes | no — local Compose is not a production deployment |
| LiteLLM | proxy demo only | proxy healthy | no — upstream key missing |

## Recommended commit sequence (not executed)

1. `chore(supabase): restore legacy migration baseline`
2. `fix(database): add dispatch outbox and workflow recovery contracts`
3. `fix(runtime): make n8n delivery durable and authenticated`
4. `fix(workflows): repair lead qualification provider contracts`
5. `fix(workflows): repair reply-to-deal item linkage and recovery`
6. `fix(workflows): scope revops and gate PQL handoff`
7. `chore(docker): isolate service environments and healthchecks`
8. `test: add remediation contract and replay coverage`
9. `docs: add schema baseline cleanup plan and demo runbook`

Review and split pre-existing dirty changes carefully before staging. Do not use `git add .` until `.env` and Supabase `.temp` exclusions have been verified.
