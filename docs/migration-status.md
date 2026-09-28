# Current Migration Status

## Canonical and repository-controlled

- Lead Qualification n8n workflow
- Reply-to-Deal n8n workflow
- RevOps Signal Orchestration n8n workflow
- Pre-CRM n8n code-node modules
- Lead acquisition and outbound foundations
- Qualification, routing, and retention contracts
- MX and LiteLLM integration helpers
- Provider contract tests and synthetic fixtures

## Remediated

- Repository and builder paths
- Authenticated backend webhook gates and durable dispatch outbox
- Provider request contracts, timeouts, and retry/error policy
- AgentFlow-specific firmographic ICP scoring
- Reply-to-Deal per-item linkage and recovery semantics
- Scoped RevOps signals and PQL-only handoff
- Deterministic builders and canonical JSON validation

## Intentionally outside this repository

- Product UI and APIs
- Authentication and billing
- Product-specific telemetry prototypes
- Production environment files

Historical database objects remain documented and are not destructively removed.
Production load, provider sandbox, and failure-injection validation remain hardening
work; registry status therefore remains `degraded`, not `healthy`.
