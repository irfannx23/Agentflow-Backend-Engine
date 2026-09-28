# AgentFlow Backend Engine

A production-oriented event-driven backend automation and RevOps intelligence
engine powering AgentFlow. It combines TypeScript, n8n, Supabase,
Firebase-authenticated events, AI enrichment/scoring, CRM integrations, and
durable workflow dispatch.

## What It Does

### 1. Pre-CRM / Lead Qualification Engine

```text
AgentFlow signup or inbound lead
  → secure backend event
  → lead ingestion and anti-abuse checks
  → sanitization and deduplication
  → Emailable verification and MX validation
  → Apollo organization enrichment
  → jurisdiction checks
  → Gemini ICP scoring
  → qualification, MQL/SQL evaluation, and routing
  → HubSpot, Slack, and controlled outreach actions
```

Signup data remains intentionally small. Company firmographics come primarily
from Apollo after email/domain verification and are normalized before scoring.
Gemini evaluates AgentFlow ICP fit from available evidence only. Firmographic
fit is not treated as buying intent: signup intent remains `unknown`, while
later AgentFlow product behavior can produce PQL and other RevOps signals.

Personal email domains, provider no-match responses, missing enrichment, and AI
failures never produce fabricated company data. The workflow records explicit
skip, low-confidence, verification, and provider-failure outcomes instead of
silently ending execution.

### 2. Reply-to-Deal Automation

```text
replied outreach
  → per-row contact lookup/upsert
  → recoverable deal creation
  → qualification reevaluation
  → sales ownership and CRM synchronization
  → Slack handoff
  → durable completion marker
```

Every polled row retains its own lead, outreach, company, email, CRM, and routing
context. Work remains recoverable until downstream qualification, routing, CRM,
and notification steps complete. Existing deal IDs are reused during recovery
so multi-row executions do not cross-link records.

### 3. RevOps Signal Intelligence

The engine evaluates persisted AgentFlow activity and database intelligence for:

- `PQL_REACHED`
- `EXPANSION_CANDIDATE`
- `ACCOUNT_AT_RISK`
- `HIGH_CHURN_RISK`
- `UPGRADE_INTENT`
- `BUDGET_PRESSURE`
- `ALLOWANCE_PRESSURE`
- `SIGNIFICANT_USAGE_GROWTH`
- `MEANINGFUL_INACTIVITY`
- `SUBSCRIPTION_ACTIVATED`

```text
AgentFlow product events
  → backend event persistence
  → qualification, health, and signal evaluation
  → durable RevOps workflow dispatch
  → idempotent signal claim
  → ownership, CRM, Slack, and customer-success actions
```

PQL handoff is limited to relevant product signals. Initial signup
firmographics and later behavioral intent remain separate concerns.

## Event Architecture

```text
AgentFlow
  │ Firebase-authenticated user action
  ▼
AgentFlow API route
  │ HMAC-signed request
  ▼
Backend event server (127.0.0.1:4310)
  │ validate → deduplicate → persist
  ▼
Supabase event store + workflow dispatch outbox
  │ claim → retry/backoff → resolve
  ▼
Authenticated n8n webhook
  │ workflow execution
  ├── Supabase RPCs
  ├── Emailable / Apollo / Gemini
  ├── HubSpot / Slack / Brevo
  └── local MX service
```

`user.registered` is adapted into Lead Qualification. `user.logged_in` is
persisted as an event but does not create a lead. Product events can generate
scoped RevOps dispatches using the event's account/workspace context.

## Reliability & Security

- HMAC verification with timestamp/replay protection for AgentFlow requests.
- A separate dispatch secret validated by n8n before database or provider work.
- Durable Supabase outbox states for pending, successful, retryable, and
  permanent-failure delivery.
- Event and lead deduplication with stable identifiers.
- Typed event, workflow, qualification, health, and signal contracts.
- Idempotent RPC claims and completion markers around recoverable work.
- Explicit HTTP timeouts and retry policies for safe reads/idempotent calls.
- No blind retries for email, Slack, or unprotected CRM writes.
- Classified provider failures and deterministic no-match outcomes.
- Server-only secrets and service-specific Docker environment allowlists.
- Loopback-only development ports and isolated Docker networking.
- Migration-controlled Supabase contracts with RLS expectations documented.

This project is reliability-focused and designed for recoverable workflow
execution. It is not represented as enterprise-certified or failure-proof.

## Technology Stack

- TypeScript and Node.js 22+
- n8n 2.34.5
- Supabase / PostgreSQL
- Firebase Auth event integration
- Docker / OrbStack
- Google Gemini
- Apollo organization enrichment
- Emailable verification
- HubSpot CRM
- Slack incoming webhooks
- Brevo transactional email
- LiteLLM with optional DeepSeek configuration
- REST APIs, webhooks, HMAC, and GitHub

## Repository Structure

```text
runtime/       HMAC event server, persistence, outbox, dispatch, and intelligence
workflows/     Three canonical n8n workflow definitions
builders/      Deterministic workflow generators and parity checks
validators/    Registry, topology, environment, and runtime-policy validation
integrations/  Provider metadata, credential adapters, MX service, and LiteLLM
registry/      Typed workflow, trigger, action, and integration catalogues
testing/       Unit, integration, workflow, event, and compatibility tests
docs/          Architecture, operations, provider, database, and demo guidance
supabase/      Historical schema baseline plus forward-only remediation migrations
```

## Local Development

Prerequisites: OrbStack or Docker, Node.js 22+, and pnpm 10+.

```bash
cd ~/Documents/agentflow-backend-engine
pnpm install
docker compose up -d
pnpm start:events
```

Run AgentFlow separately:

```bash
cd ~/Documents/AgentFlow
pnpm dev
```

Stop local backend services without deleting persistent data:

```bash
cd ~/Documents/agentflow-backend-engine
docker compose down
```

Never use `docker compose down -v` for this stack. Its external n8n volume
contains workflow state, settings, and execution history.

## Environment

Copy `.env.example` to the gitignored `.env` and populate values locally. The
configuration uses these variable names:

Backend runtime:

- `ENGINE_PORT`
- `AGENTFLOW_INTEGRATION_SECRET`

Supabase:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

n8n dispatch and local runtime:

- `N8N_LEAD_QUALIFICATION_DISPATCH_URL`
- `N8N_REPLY_TO_DEAL_DISPATCH_URL`
- `N8N_REVOPS_SIGNAL_DISPATCH_URL`
- `N8N_DISPATCH_SECRET`
- `N8N_HOST`, `N8N_PORT`, `N8N_PROTOCOL`
- `N8N_SECURE_COOKIE`, `N8N_BLOCK_ENV_ACCESS_IN_NODE`
- `WEBHOOK_URL`, `MX_SERVICE_PORT`

Verification and enrichment:

- `EMAIL_VERIFY_API_KEY`, `EMAIL_VERIFY_BASE_URL`
- `ENRICH_API_KEY`, `ENRICH_BASE_URL`

AI:

- `GEMINI_API_KEY`, `GEMINI_ENDPOINT`, `GEMINI_MODEL`
- `LITELLM_MASTER_KEY`, `LITELLM_PORT`
- `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` (optional)

CRM and notifications:

- `HUBSPOT_ACCESS_TOKEN`, `HUBSPOT_BASE_URL`
- `SLACK_WEBHOOK_URL`

Email delivery:

- `BREVO_API_KEY`, `BREVO_BASE_URL`
- `BREVO_SENDER_NAME`, `BREVO_SENDER_EMAIL`

Never expose the service-role key or provider credentials to client-side
variables, workflow exports, logs, or committed files.

## Testing

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm validate:engine
pnpm validate:legacy
pnpm build
git diff --check
docker compose config
docker compose ps
```

Coverage includes provider request/response contracts, AgentFlow event HMAC and
routing, outbox replay, duplicate suppression, multi-row Reply-to-Deal context,
all canonical RevOps signals, workflow topology/runtime policies, builder/JSON
parity, and synthetic local E2E behavior. Live workflow parity and provider
authentication are release checks; automated tests avoid real emails, Slack
messages, and CRM writes.

## Status

Verified locally:

- all three canonical workflows are registered, validated, and active in n8n;
- AgentFlow HMAC ingestion and durable dispatch are implemented;
- Lead Qualification uses verified/enriched AgentFlow ICP scoring;
- Reply-to-Deal recovery and per-row linkage are covered by tests;
- RevOps supports all ten canonical signal contracts;
- n8n, MX, LiteLLM, backend, Supabase, Apollo, Emailable, Gemini, and HubSpot
  connectivity have passed read-only health checks.

Remaining production hardening includes replacing the currently invalid Brevo
credential, validating safe Slack/CRM/email destinations, closing the remaining
CRM deal-create idempotency gap, and completing deployment-specific monitoring,
secret rotation, and load/failure testing. See `docs/demo-checklist.md` and
`docs/remediation/final-report-2026-09-28.md` for the latest evidence.
