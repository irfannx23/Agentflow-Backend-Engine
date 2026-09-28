# Backend Architecture

`agentflow-backend-engine` is the event automation and RevOps intelligence service
behind AgentFlow. The repositories deploy independently and communicate through a
versioned, HMAC-authenticated event contract.

## Layering

1. `core` contains typed event, qualification, and automation contracts.
2. `registry` identifies available workflows and validates their capabilities.
3. `triggers`, `actions`, and `integrations` define reusable execution building blocks.
4. `builders` generate deterministic workflow structures.
5. `validators` reject invalid registry entries and n8n graphs.
6. `runtime` loads registered workflows, reads runtime configuration, and evaluates product events.
7. `engines` groups existing capabilities into Pre-CRM, GTM, and RevOps domains.
8. `workflows` stores the canonical JSON imported into n8n.
9. `builders` and `integrations/credential-adapters.ts` generate portable node parameters and environment-backed credential expressions.
10. Canonical JSON persists timeout, retry, and error policies; `runtime/workflow-standardizer.ts` verifies/normalizes portable copies.
11. `validators` enforce registry, topology, parameter, credential, environment, and n8n compatibility contracts.

The registries are metadata and validation boundaries. They do not execute marketing campaigns, send messages, or alter external systems by themselves.

## Runtime path

```text
AgentFlow → HMAC event server → Supabase event/outbox → authenticated n8n webhook
          → provider/RPC operations → explicit workflow outcome
```

Lead signup qualification uses verified identity plus normalized Apollo
firmographics. Product behavior is evaluated separately by RevOps and is the source
of PQL/expansion/risk signals.

## Repository boundary

- No source imports cross into the AgentFlow application repository.
- Backend database changes are forward-only and repository-controlled under `supabase/migrations/`.
- Secrets are loaded only from runtime environment configuration.
- Workflow JSON remains compatible with the original n8n execution model.
