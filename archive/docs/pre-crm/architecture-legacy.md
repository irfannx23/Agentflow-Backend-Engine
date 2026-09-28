> LEGACY / HISTORICAL REFERENCE
>
> This document is not a current master project-memory file.
> This page is an archived design record. Its URLs and provider/runtime details are
> not deployment instructions. Canonical ingress is direct backend-to-n8n dispatch
> authenticated with `N8N_DISPATCH_SECRET`; see `docs/architecture.md`.
>
> Current source of truth:
> `CODEX.md`, `TASK.md`, `STATE.md`, `ARCHITECTURE.md`, `Docs/Architecture/API_SPEC.md`, `CHANGELOG.md`, `README.md`, `FILE_STRUCTURE.md`

# Archived Architecture — Data Flow & the 7-Stage Qualification Gate

**Why this file is used:** The technical deep-dive into how data moves through the system. Defines the "Pass/Fail" logic for every gate so the RevOps pipeline stays hygienic. Source of truth: `gtmops_architecture_blueprint.pdf` (V2.0).

## System overview

```
Webflow / Typeform / App Events
        │  raw webhook
        ▼
[Stage 0] Hookdeck Webhook Queue & Rate-Throttling   (Module 0)  ✅ IMPLEMENTED + VERIFIED
        │  https://hkdk.events/3at57n99zasz2d → tunnel → n8n webhook; ack 200 + retry/DLQ
        ▼
[Stage 1] Spam & Syntax Filter (n8n Code node)        ✅ IMPLEMENTED + VERIFIED
        │  pass → Stage 3 (dedup) · fail → spam_log
        ▼
[Stage 2] Email Deliverability & Verification          ✅ IMPLEMENTED + VERIFIED (Emailable)
        │  deliverable → Stage 6 · fail → tag 'Unverified'
        ▼
[Stage 3] Deduplication & Identity Stitching           ✅ IMPLEMENTED + VERIFIED
        │  RPC get_or_create_lead (race-proof ON CONFLICT + unique lower(email))
        ▼
[Stage 4] Waterfall Data Enrichment                    ✅ IMPLEMENTED + VERIFIED (Apollo)
        │  org enrich by domain → firmographics merged + persisted before scoring
        ▼
[Stage 5] Anti-ICP Hard Exclusion                      ✅ IMPLEMENTED + VERIFIED
        │  door check (payload country) + post-enrichment backstop (Apollo country)
        │  pass → AI Scoring · fail → 'Disqualified'
        ▼
[Stage 6] AI ICP & Intent Scoring (Gemini)             ✅ IMPLEMENTED + VERIFIED
        │  GEMINI_MODEL → icp_score/fit + signup intent unknown + evidence
        │  score ≥ 70 → status 'qualified' · < 70 → 'nurture'
        ▼
[Module 4] Smart Routing & Speed-to-Lead               ✅ IMPLEMENTED + VERIFIED
        │  icp_score >= 70 → HubSpot deal (contact + association) + Slack alert
        │  else → nurture (Slack notice, no CRM touch)
```

## The 7 stages — pass/fail logic

### Stage 0 — Hookdeck Webhook Queue & Rate-Throttling (Module 0) ✅ IMPLEMENTED + VERIFIED
- **What:** Entry point for ALL inbound webhooks. Instantly acknowledges the submission (200 OK) to the frontend while queueing payloads.
- **Setup:** CLI logged in via `hookdeck ci --api-key $HOOKDECK_API_KEY` (project `Event Gateway Starter`); source `hookdeck-lead-ingest` created; tunnel via `hookdeck listen 5678 hookdeck-lead-ingest --path /webhook/hookdeck-lead-ingest` (helper: `Automation/Hookdeck/start_hookdeck.sh`).
- **Public URL:** `https://hkdk.events/3at57n99zasz2d` → forwards to `http://localhost:5678/webhook/hookdeck-lead-ingest`. Put this URL in frontend forms instead of the raw n8n webhook.
- **Verified:** live E2E through Hookdeck — ack 200, event delivered, lead scored (qualified), n8n execution SUCCESS.
- **Pass:** payload forwarded to n8n at controlled rate (prevents 429s on n8n/LLM APIs).
- **Downstream outage:** held in Hookdeck Dead-Letter Queue, automatic retry.
- **Status:** tunnel is session-bound — restart with `Automation/Hookdeck/start_hookdeck.sh` after reboot.

### Stage 1 — Spam & Syntax Filter (n8n) ✅ IMPLEMENTED + VERIFIED
- **What:** regex email structure check, disposable-provider blocklist (20 domains), personal-domain blocklist (15 domains), student/academic domains, competitor domains, malformed-text/control-char stripping.
- **Pass:** `sanitized: true` → Stage 3 (dedup).
- **Fail:** `sanitized: false` + `reason` (email_missing / email_invalid_format / temporary_email_provider / personal_domain / student_domain / competitor_domain) → logged to `spam_log` via the `log_spam` RPC.
- **Code:** `core/pre-crm/n8n-code-nodes/n8n-ingestion-sanitize.js` (mirrored in `workflows/pre-crm/lead-qualification.workflow.json`).

### Stage 2 — Email Deliverability & Verification ✅ IMPLEMENTED + VERIFIED (Emailable)
- **What:** live mailbox check before scoring/CRM. The `Verify Email?` IF node activates ONLY when `EMAIL_VERIFY_API_KEY` is set in the n8n container env, and only for NEW leads (duplicates are never re-verified — saves credits).
- **Pass:** deliverable → Stage 6 scoring (verified: test@duck.com → scored qualified).
- **Fail:** `mark_lead_unverified` RPC → status `unverified` + `lead.verification.failed` timeline event (lead kept in DB, never scored or sent to CRM — verified with a fake domain).
- **Provider:** Emailable (`https://api.emailable.com/v1/verify`, 250 free credits, any-email signup). Normalizer is provider-agnostic (Emailable/Abstract/Hunter/ZeroBounce/mailboxlayer — 19/19 unit tests).
- **Caveat:** big-mailbox probes (Gmail/iCloud/Outlook, role accounts) often return undeliverable/risky — the conservative unverified tagging is intentional CRM hygiene.

### Stage 3 — Deduplication & Identity Stitching ✅ IMPLEMENTED + VERIFIED
- **What:** `get_or_create_lead` RPC looks up `staged_leads` by lowercased email; returns the existing row or inserts a new one — always exactly one row back (no n8n zero-item trap).
- **New contact:** inserted with status `new` (`is_new: true`) → Stage 6 scoring.
- **Existing contact:** `is_new: false` → `lead.captured.duplicate` appended to the timeline — no duplicates.
- **Race-proof (migration 05):** unique index `staged_leads_email_lower_unique` + `ON CONFLICT (lower(email)) DO NOTHING` — two webhooks in the same second can't create two rows.
- **Foundation:** `staged_leads_email_idx` index, `event_id` unique.

### Stage 4 — Waterfall Data Enrichment ✅ IMPLEMENTED + VERIFIED (Apollo)
- **What:** Apollo organization enrichment by email domain, merged into firmographics before AI scoring. The `Enrich Company?` IF node activates only when `ENRICH_API_KEY` is set AND the lead has an email domain — and only runs for NEW + deliverable leads (never wastes credits on duplicates/bounces).
- **Call:** `POST https://api.apollo.io/v1/organizations/enrich` with `{domain}` + `X-Api-Key` header (n8n HTTP Request typeVersion 2 + `headerParametersJson` — the ONLY custom-header path that works in n8n 2.34.5).
- **Merge (5/5 unit tests):** org `industry` / `estimated_num_employees` / `country` / `city` fill gaps; form-provided firmographics are never dropped; tagged `enriched_by: apollo`.
- **Persist (migration 07):** `update_lead_score` stores the merged firmographics on the lead — verified live (DuckDuckGo org persisted, then scored qualified).
- **Fallback:** if no org data or enrichment off → form firmographics pass through unchanged.

### Stage 5 — Anti-ICP Hard Exclusion ✅ IMPLEMENTED + VERIFIED
- **What:** hard disqualification: personal email domains (already blocked earlier), student domains, competitor domains, and unsupported jurisdictions (KP/IR/CU/SY/BY/RU/VE/MM/SD/ZW).
- **Jurisdiction enforcement — two layers:**
  1. **Door check (sanitizer, Stage 1):** payload carrying `country_code` or `country` in a blocked jurisdiction → rejected with reason `blocked_jurisdiction` → spam_log, zero credits spent.
  2. **Post-enrichment backstop (Stage 5 node):** `Check Jurisdiction` maps enrichment-revealed country (Apollo returns country as a NAME, e.g. "Russia" → RU via alias map) → `Jurisdiction OK?` IF → `Block Jurisdiction` RPC (`mark_lead_blocked`, migration 08).
- **Pass:** qualified → AI Scoring.
- **Fail:** stored, status `disqualified`, `lead.blocked.jurisdiction` timeline event — NEVER scored or CRM'd.

### Stage 6 — AI ICP & Intent Scoring (Gemini) ✅ IMPLEMENTED + VERIFIED
- **What:** `Score Lead (Gemini)` builds a strict-JSON prompt from normalized firmographics → `Call Gemini API` POSTs to `{GEMINI_ENDPOINT}/{GEMINI_MODEL}:generateContent` using the `x-goog-api-key` header → `Parse Gemini Score` validates the AgentFlow ICP response.
- **Returns:** `icp_score` (0–100), `fit` (high|medium|low), `buying_intent` (`unknown` at signup), evidence, factual summary, and `personalized_icebreaker`. Database intent is persisted as `NULL` (unknown); the explicit AgentFlow contract is stored in the firmographic qualification audit object.
- **Score ≥ 70:** status `qualified` → Module 4 promotes to HubSpot CRM. **Score < 70:** status `nurture`.
- **Skips:** duplicate leads (never re-scored) and leads without firmographic signal.
- **Status:** verified live — new lead scored end-to-end; all executions SUCCESS.

## Module 4 — Smart Routing & Speed-to-Lead ✅ CORE IMPLEMENTED + VERIFIED

**Live now (verified end-to-end, Aug 2026):**
- `CRM Ready?` IF after scoring: `icp_score >= 70` (deliverability already guaranteed upstream by Stage 2) → HubSpot chain; else → `Slack Alert: Nurture` (no CRM touch).
- HubSpot chain: `HubSpot: Upsert Contact` (`POST /crm/v3/objects/contacts?&idProperty=email` — upsert by email) → `HubSpot: Create Deal` (`POST /crm/v3/objects/deals`, inline `deal_to_contact` association **type 3**) → `Slack Alert: Qualified Lead` with score/intent/icebreaker/deal URL (speed-to-lead).
- Verified live: test20@duck.com → scored 75/qualified → HubSpot deal "DuckDuckGo Inc — PreCRM" + contact + association + Slack alert; test1@rediffmail.com → scored 0/nurture → Slack nurture notice, NO deal. Both executions SUCCESS.
- **Nurture follow-up (live, Aug 2026):** nurture leads (score < 70) get a Gemini-written follow-up email via Brevo (free tier, 300/day, personal email sender OK) — env-gated on `BREVO_API_KEY`; sent → `lead.nurture.email.sent` timeline event. Verified: contact@rediffmail.com → Gemini wrote "Quick thought on retail efficiency" → Brevo 201 → event logged.

**Roadmap channels (V3.0 vision, not yet built):**

| Channel | Trigger | Engine | SLA |
|---|---|---|---|
| AI Outbound Voice Call | score ≥ 70 + valid phone + high intent | Vapi / Retell / Bland AI via n8n | < 30s |
| SMS / WhatsApp | score ≥ 70 + mobile preference | Twilio / WhatsApp Business API | < 45s |
| Context-Aware AI Email | all qualified (≥ 70) | Claude/Gemini copy + Resend API | < 60s |
| Sales Rep Slack Escalation | high-value (> $20k) / custom handoff | n8n → Slack #sales-hot-transfers | < 15s |

Plus **Dynamic Overflow Triage (HITL)**: if AEs are busy → AI Sales Rep handles prospect; 3-bullet summary + ICP score + pain points pushed to Slack; rep clicks "Takeover Chat" (Retool/Slack) for live control.

## Core tables

### `public.staged_leads` (implemented)
| Column | Type | Notes |
|---|---|---|
| id | bigint identity PK | |
| event_id | text UNIQUE | dedup key |
| email | text NOT NULL | normalized, lowercased; UNIQUE on lower(email) since migration 05 |
| company_name | text | |
| raw_payload | jsonb | original webhook body |
| firmographics | jsonb | enrichment output (Stage 4) |
| icp_score | integer | Stage 6 output |
| buying_intent | text | Nullable database representation; `NULL` means unknown at signup |
| personalized_icebreaker | text | Stage 6 output |
| status | text default 'new' | new / duplicate / unverified / disqualified / nurture / qualified |
| created_at / updated_at | timestamptz | trigger keeps updated_at fresh |

RLS enabled; `service_role` has full access; indexes on email + icp_score + status.

**Also implemented (migrations 02–05):** `lead_events` (append-only timeline: lead.captured / lead.captured.duplicate / lead.scored), `spam_log` (Stage 1 rejections), RPCs `get_or_create_lead`, `append_lead_event`, `log_spam`, `update_lead_score` — all return exactly one row (`[{ok:true}]` for the void ones) so n8n never hits the zero-item / empty-body trap.
