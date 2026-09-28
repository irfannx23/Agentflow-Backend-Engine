# Database Ownership

The engine reuses the audited backend Supabase project. Historical schema is retained
as a repository baseline; new changes are forward-only migrations under
`supabase/migrations/`.

Pre-CRM owns lead staging, lead events, verification and enrichment results, qualification evaluations, sales assignments, outreach, abuse records, and their existing RPC access paths. RevOps owns customer-health evaluations, account plan, usage and budget views, product events, and persisted revenue-operation signals. Accounts, profiles, workspace and project identity, product events, and integration synchronization are shared infrastructure.

Contracts under `core/revops/contracts` mirror RPC and view outputs. Supabase remains
the authority for qualification, delivery, and health rules. The 2026-09 remediation
migration repairs `assign_pql_sales_owner`, adds the workflow dispatch outbox, and
adds recoverable Reply-to-Deal claim/completion RPCs. No cleanup DROP is part of the
release. See [Schema Baseline](schema-baseline.md) and
[Supabase Cleanup Plan](supabase-cleanup-plan.md).
