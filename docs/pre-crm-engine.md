# Pre-CRM Engine

## Processing model

`Lead Ingestion → Deduplication → Anti-Abuse → Email Verification → Jurisdiction → Enrichment → Scoring → Qualification → Routing → Outreach/Nurture/CRM Preparation`

Reply Detection feeds the existing Reply-to-Deal workflow. Each stage retains its current code-node or Supabase RPC authority; `core/pre-crm/contracts/pre-crm-engine.ts` only compiles stage outcomes into an audit record.

## Production contract

Every capability result contains a decision, explanation, source, and evidence identifiers. Qualification readiness requires successful ingestion, deduplication, anti-abuse, email verification, and jurisdiction checks. CRM and outreach readiness additionally require the corresponding authoritative flags returned by the existing qualification contract.

The compiler rejects duplicate stages, missing explanations or sources, blank event IDs, and invalid timestamps. It does not write records, recalculate provider verdicts, or replace workflow gates.

## Qualification intelligence

`buildQualificationIntelligence` preserves the RPC's fit score, priority score and tier, MQL/SQL/PQL status, CRM/outbound readiness, explanation, rule version, source runtime, and timestamp. Behavioral score, intent details, and confidence are exposed only when present in audited summary fields. Missing values remain `null` or empty.

Signup scoring is AgentFlow ICP fit, not buying intent. Apollo organization data
is normalized before Gemini; missing values are not fabricated. Gemini must
return `buying_intent: "unknown"`, which is persisted as database `NULL`.
MQL/SQL use firmographic and engagement evidence, while PQL remains reserved for
later AgentFlow product behavior handled by RevOps.
