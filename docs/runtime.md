# Runtime

The repository workflow JSON is the import artifact and already contains timeout, retry, and error behavior. `runtime/workflow-standardizer.ts` remains a validation/portable-copy safeguard; tests require raw JSON to pass the same runtime-policy validation.

Credential adapters generate environment expressions only. Integration parameter generation validates that every referenced environment name belongs to the selected integration and applies its registered timeout, retry, error, and credential policy.

The intelligence runtime accepts already-fetched contract records and product events. It is deterministic and side-effect free. Observability records operation names, duration, and structured failure status without logging payloads or secret values.

AgentFlow events are persisted before delivery work is enqueued. `workflow_dispatch_outbox` makes duplicate input idempotent while preserving retryable failed dispatches. The backend drains due work every 15 seconds and moves permanent 4xx/configuration failures to an explicit terminal state.
