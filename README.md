# agentflow-backend-engine

`agentflow-backend-engine` is an independent, product-neutral automation backend for reusable Pre-CRM, GTM, RevOps, AI, and n8n workflow capabilities.

The repository owns workflow definitions, typed registries, triggers, actions, integrations, runtime validation, builders, generators, product-signal intelligence, and compatibility tests. It does not depend on the AgentFlow or CostPilot source trees.

## Current scope

- Three migrated n8n workflows: lead qualification, reply-to-deal, and RevOps signal orchestration
- Reusable Pre-CRM code-node modules
- GTM acquisition and outbound foundations
- RevOps qualification, routing, retention, and signal contracts
- Workflow, trigger, action, and integration registries
- AgentFlow product-event signal definitions without campaign execution
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
runtime/       Workflow loading, product signals, and runtime configuration
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

The backend reuses the existing GTM/RevOps Supabase project. This repository does not create, reset, or own a replacement project. Database migrations and production data remain untouched during Phase 2.

## Status

Phase 2 establishes architecture and compatibility boundaries only. Workflow optimization begins only after explicit approval.
