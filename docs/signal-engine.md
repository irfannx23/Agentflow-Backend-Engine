# AgentFlow Product Signal Engine

The signal engine evaluates persisted AgentFlow product events. It does not invent behavior, inspect secrets, send campaigns, or execute CRM sequences.

Signals cover activation, adoption, expansion, retention, revenue, risk, power-user, customer-success, and operational conditions. Every signal definition includes its trigger condition, business value, recommended operational response, and priority.

Aggregate signals use deterministic windows:

- Repeated repair: three repairs on one project within seven days.
- Power-user activity: ten core workflow actions by one user within thirty days.
- Large workflow: at least 50 generated nodes.
- Multiple integrations: at least three connected integrations reported by the connection event.

The runtime returns detected signal records only. Downstream systems decide whether and how to act.
