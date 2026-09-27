# Business Engines

The platform has two composable business layers over the migrated n8n workflows and existing Supabase contracts.

The Pre-CRM engine records an auditable result for ingestion, verification, enrichment, qualification, scoring, AI qualification, routing, deduplication, jurisdiction, anti-abuse, email verification, reply detection, outreach, nurture, and CRM preparation. It treats the current code nodes and RPC results as authoritative.

The RevOps engine combines existing qualification evaluations, customer-health evaluations, persisted RevOps signals, plan state, and real product events. It produces normalized qualification, lifecycle, customer, and signal intelligence. Missing evidence is returned as `not_evaluated`; it is never replaced with an invented score or business rule.

`runtime/intelligence-engine.ts` is the read-only composition boundary. It performs no database writes and does not alter workflow execution.
