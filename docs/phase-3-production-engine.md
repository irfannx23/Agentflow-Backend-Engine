# Phase 3 Production Automation Engine

Phase 3 standardizes the extracted workflows without replacing their business logic or changing any Supabase contract.

## Runtime model

The JSON in `workflows/` remains the source of truth. `loadPortableWorkflow` creates a runtime copy and adds operational settings that are safe to derive: execution order, request timeout, explicit error behavior, and retries only for GET or allowlisted idempotent RPC operations. Non-idempotent provider writes are never automatically retried.

## Workflow contract

Every registered workflow declares its semantic version, owner, description, integrations, credentials, required and optional environment variables, input and output schemas, validation expectations, health checks, runtime policy, documentation, and repair-compatibility guarantees.

## Parameter and credential generation

`builders/n8n-node-builders.ts` generates portable HTTP nodes, environment expressions, JSON bodies, timeouts, retry settings, and error behavior. `integrations/credential-adapters.ts` generates environment-backed credential headers. Adapters contain variable names and expressions only; they never contain secret values.

## Validation boundaries

Validation covers registry references, workflow topology, node identity, HTTP parameters, expression form, unresolved placeholders, likely hardcoded secrets, environment declaration, credential-adapter compatibility, timeouts, and retry completeness.

## RevOps reuse

Database signal contracts mirror the signal types already produced by `generate_revops_signals`: PQL, expansion, account risk, churn risk, upgrade intent, budget and allowance pressure, usage growth, inactivity, and subscription activation. The engine normalizes persisted signals; it does not duplicate or replace database thresholds.

## Compatibility

- Existing workflow node names and connections remain unchanged.
- Existing RPC names and payload contracts remain unchanged.
- No database migration is owned by this repository.
- Auth, billing, RLS, policies, production data, and Supabase structure remain outside Phase 3.
