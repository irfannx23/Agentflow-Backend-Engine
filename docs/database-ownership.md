# Database Ownership

The engine reuses the audited Supabase project; Phase 4 adds no schema or data changes.

Pre-CRM owns lead staging, lead events, verification and enrichment results, qualification evaluations, sales assignments, outreach, abuse records, and their existing RPC access paths. RevOps owns customer-health evaluations, account plan, usage and budget views, product events, and persisted revenue-operation signals. Accounts, profiles, workspace and project identity, product events, and integration synchronization are shared infrastructure.

Contracts under `core/revops/contracts` mirror existing RPC and view outputs. Supabase remains the authority for qualification and health rules. Contract changes require a separately approved database phase; application code must not silently reinterpret them.
