# Runtime

The runtime loads immutable workflow JSON, applies portable HTTP policies in memory, validates topology and parameters, and returns an n8n-compatible definition. Source workflow JSON is not rewritten.

Credential adapters generate environment expressions only. Integration parameter generation validates that every referenced environment name belongs to the selected integration and applies its registered timeout, retry, error, and credential policy.

The intelligence runtime accepts already-fetched contract records and product events. It is deterministic and side-effect free. Observability records operation names, duration, and structured failure status without logging payloads or secret values.
