# AgentFlow Product Signal Engine

The signal engine evaluates persisted AgentFlow product events. It does not invent behavior, inspect secrets, send campaigns, or execute CRM sequences.

Signals cover activation, adoption, expansion, retention, revenue, risk, power-user, customer-success, and operational conditions. Every signal definition includes its trigger condition, business value, recommended operational response, and priority.

Aggregate signals use deterministic windows:

- Repeated repair: three repairs on one project within seven days.
- Power-user activity: ten core workflow actions by one user within thirty days.
- Large workflow: at least 50 generated nodes.
- Multiple integrations: at least three connected integrations reported by the connection event.

The runtime returns detected signal records only. Downstream systems decide whether and how to act.

The engine also normalizes signals already persisted by the existing Supabase `generate_revops_signals` capability. Supported database signal contracts are `PQL_REACHED`, `EXPANSION_CANDIDATE`, `ACCOUNT_AT_RISK`, `HIGH_CHURN_RISK`, `UPGRADE_INTENT`, `BUDGET_PRESSURE`, `ALLOWANCE_PRESSURE`, `SIGNIFICANT_USAGE_GROWTH`, `MEANINGFUL_INACTIVITY`, and `SUBSCRIPTION_ACTIVATED`.

Database health scores, inactivity windows, usage-growth thresholds, and expansion rules remain authoritative in Supabase. The TypeScript engine deliberately does not recreate them.
