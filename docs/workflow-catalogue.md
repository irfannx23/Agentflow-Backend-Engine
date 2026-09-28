# Workflow Catalogue

## Lead Qualification (`pre-crm.lead-qualification`, v1.3.0)

Authenticated webhook ingestion, database-backed anti-abuse, sanitation,
deduplication, Emailable/MX verification, Apollo enrichment, jurisdiction checks,
AgentFlow ICP scoring, qualification, routing, outreach or nurture, CRM preparation,
and explicit audit outcomes. Signup ICP fit never fabricates buying intent or PQL.

## Reply to Deal (`pre-crm.reply-to-deal`, v1.3.0)

Scheduled or authenticated-webhook reply detection, per-row contact/deal handling,
qualification refresh, routing synchronization, completion tracking, and Slack
notification. Rows are recoverable until critical downstream work completes.

## RevOps Signal Orchestration (`revops.signal-orchestration`, v1.3.0)

Scheduled all-account evaluation or scoped event-driven handling of the ten canonical
signals, followed by claimed/idempotent CRM and Slack steps. PQL sales-owner handoff
runs only for PQL-relevant signals.

Registry definitions declare metadata, credentials, environment, schemas,
validation, health, runtime policies, documentation, and n8n compatibility.
Canonical JSON is reproducible from builders and is the only import source of truth.
