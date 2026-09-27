# Signal Catalogue

Runtime definitions in `core/product-signals.ts` cover real signup, login, onboarding, dashboard, provider connection, usage sync, insight, budget, alert, upgrade, project sharing, and AI generation events. Detection retains source event IDs.

| Database signal | Category | Existing authority |
| --- | --- | --- |
| `PQL_REACHED` | Revenue | qualification evaluations |
| `EXPANSION_CANDIDATE` | Expansion | current customer health |
| `ACCOUNT_AT_RISK` | Risk | current customer health |
| `HIGH_CHURN_RISK` | Risk | current customer health |
| `UPGRADE_INTENT` | Revenue | product events |
| `BUDGET_PRESSURE` | Risk | current-month budget status |
| `ALLOWANCE_PRESSURE` | Risk | provider usage limits |
| `SIGNIFICANT_USAGE_GROWTH` | Usage intelligence | account health signal assembly |
| `MEANINGFUL_INACTIVITY` | Retention | account health signal assembly |
| `SUBSCRIPTION_ACTIVATED` | Activation | account plans |

`core/revops/signal-catalogue.ts` is the combined machine-readable catalogue. New entries must cite an existing product event or database contract and include deterministic tests.
