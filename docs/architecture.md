# Backend Architecture

Phase 4 business-engine details are documented in [Business Engines](business-engines.md), [Pre-CRM Engine](pre-crm-engine.md), [RevOps Signal Engine](revops-signal-engine.md), and the [Workflow Catalogue](workflow-catalogue.md).

`agentflow-backend-engine` is an independent automation platform. It has no source-code dependency on AgentFlow or CostPilot.

## Layering

1. `core` contains reusable contracts and product-neutral automation modules.
2. `registry` identifies available workflows and validates their capabilities.
3. `triggers`, `actions`, and `integrations` define reusable execution building blocks.
4. `builders` generate deterministic workflow structures.
5. `validators` reject invalid registry entries and n8n graphs.
6. `runtime` loads registered workflows, reads runtime configuration, and evaluates product events.
7. `engines` groups existing capabilities into Pre-CRM, GTM, and RevOps domains.
8. `workflows` stores the real migrated workflow JSON used for compatibility testing.
9. `builders` and `integrations/credential-adapters.ts` generate portable node parameters and environment-backed credential expressions.
10. `runtime/workflow-standardizer.ts` applies timeout, retry, and error policies to a runtime copy without rewriting source workflow logic.
11. `validators` enforce registry, topology, parameter, credential, environment, and n8n compatibility contracts.

The registries are metadata and validation boundaries. They do not execute marketing campaigns, send messages, or alter external systems by themselves.

## Independence boundary

- No imports reference AgentFlow or CostPilot source directories.
- No database migrations are owned or applied in Phase 2.
- Secrets are loaded only from runtime environment configuration.
- Workflow JSON remains compatible with the original n8n execution model.
