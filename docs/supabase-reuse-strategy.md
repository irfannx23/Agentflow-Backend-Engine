# Supabase Reuse Strategy

The existing GTM/RevOps Supabase project remains the database for this backend.

Phase 2 rules:

- Do not create another Supabase project.
- Do not reset local or remote data.
- Do not delete or replace tables, views, functions, policies, or RPCs.
- Do not copy the existing ordered migration history into this repository.
- Connect only through `SUPABASE_URL` and server-side `SUPABASE_SERVICE_ROLE_KEY` configuration.
- Treat existing RPC names used by workflow JSON as external compatibility contracts.
- Validate missing configuration before runtime access.

Future schema changes require a separate compatibility audit and explicit approval. They must be additive, preserve existing RPC behavior, and be applied to the linked project through an independently reviewed migration.
