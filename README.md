# agentflow-backend-engine

`agentflow-backend-engine` is an independent, product-neutral automation backend for reusable Pre-CRM, GTM, RevOps, AI, and n8n workflow capabilities.

The repository owns workflow definitions, typed registries, triggers, actions, integrations, runtime validation, builders, generators, product-signal intelligence, and compatibility tests. It does not depend on the AgentFlow, CostPilot, or OrbisWeave source trees.

## Current scope

- Three migrated n8n workflows: lead qualification, reply-to-deal, and RevOps signal orchestration
- Reusable Pre-CRM code-node modules
- GTM acquisition and outbound foundations
- Auditable Pre-CRM qualification intelligence across all existing processing stages
- RevOps lifecycle, customer-health, revenue, retention, expansion, risk, usage, and signal intelligence
- Workflow, trigger, action, and integration registries
- Real product-event and audited database-signal catalogues without synthetic events
- Structural n8n validation and compatibility checks
- Existing Supabase project reuse through environment configuration only

## Architecture

```text
core/          Reusable domain contracts and copied automation modules
workflows/     Registered workflow JSON and templates
triggers/      Reusable trigger definitions
actions/       Reusable action definitions
integrations/  Integration definitions and adapters
registry/      Typed workflow and capability registries
runtime/       Workflow loading, business intelligence, signals, and runtime configuration
builders/      Deterministic workflow builders
validators/    Registry and n8n workflow validation
generators/    Reserved artifact generators
engines/       Pre-CRM, GTM, and RevOps module catalogs
testing/       Platform tests and preserved legacy tests
docs/          Architecture and migration documentation
```

## Commands

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Supabase

The backend reuses the existing GTM/RevOps Supabase project. This repository does not create, reset, or own a replacement project. Database migrations, schema, RPC contracts, RLS, authentication, and production data remain untouched by Phase 4.

## Status

Phase 4 completes the backend intelligence platform while retaining migrated workflows and Supabase contracts as the source of truth. See `docs/business-engines.md`, `docs/signal-catalogue.md`, and `docs/workflow-catalogue.md`.
