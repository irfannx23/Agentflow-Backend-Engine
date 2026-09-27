> LEGACY / HISTORICAL REFERENCE
>
> This document remains useful historical/reference material for the original Pre-CRM engine.
>
> Current source of truth:
> `CODEX.md`, `TASK.md`, `STATE.md`, `ARCHITECTURE.md`, `Docs/Architecture/API_SPEC.md`, `CHANGELOG.md`, `README.md`, `FILE_STRUCTURE.md`

# Pre-CRM Engine — Complete Overview & Playbook

**Why this page is used:** This is the master reference for Project 1 of the Triple Gatekeeper Portfolio. If I ever forget how this was built — or a beginner/recruiter wants to understand it — this page explains the whole thing from zero: what it is, why it matters, how every piece works, how it was built step by step, and how to run it again.

---

## 1. What is this project? (30-second version)

A **Pre-CRM AI-powered lead engine**: a middleware gatekeeper that cleans, verifies, enriches, and AI-scores inbound leads *before* they ever touch the CRM.

Raw web-form leads are messy: fake emails, spam, duplicates, personal addresses, companies in unsupported jurisdictions. If you push those straight into HubSpot you get a polluted CRM, wasted money on paid contact seats, and sales reps chasing junk.

This engine sits in front of the CRM and decides: **who deserves to reach a human sales rep — and who doesn't.**

> One line for a recruiter: *"I built a 32-node automation pipeline that takes raw webhook leads through sanitization, email verification, deduplication, firmographic enrichment, anti-ICP filtering, and Gemini AI scoring — then automatically creates a HubSpot deal with a personalized icebreaker and alerts the sales team via Slack, while low-scoring leads get an AI-written nurture email. All on free tiers."*

---

## 2. The problem it solves

| Problem | Consequence without this engine |
|---|---|
| Raw, unverified leads into CRM | 30–40% duplicate/bad records → wasted rep time |
| Fake / disposable emails | Bounces, spam complaints, wasted outreach |
| Duplicate signups | Multiple contacts for one person → inflated costs |
| No scoring | Reps spend 50% of time on unqualified leads |
| Slow follow-up | 2–24h manual handoff → conversion drops up to 8x |
| Paid CRM seats | Paying HubSpot for every raw signup instead of only qualified leads |

---

## 3. Architecture at a glance

```
Inbound webhook (form / site event)
        │
        ▼
[Stage 0] Hookdeck — webhook reliability gateway (queue, retry, rate-limit)
        ▼
[Stage 1] Sanitize — email regex, block disposable/personal/student/competitor domains, strip malformed text
        ▼
[Stage 2] Verify — Emailable API: is the mailbox really deliverable?
        ▼
[Stage 3] Dedup — race-proof: one row per email, timeline events for duplicates
        ▼
[Stage 4] Enrich — Apollo: company firmographics by email domain (industry, size, HQ)
        ▼
[Stage 5] Anti-ICP — block unsupported jurisdictions (KP/IR/CU/SY/BY/RU/VE/MM/SD/ZW)
        ▼
[Stage 6] Score — Gemini AI: icp_score 0–100, buying_intent, personalized icebreaker
        ▼
[Module 4] Route —
        ├─ icp_score ≥ 70 → HubSpot deal + contact (associated) → Slack alert to sales
        └─ icp_score < 70 → Slack nurture notice → Gemini-written follow-up email via Brevo
```

**The engine is a 32-node n8n workflow.** Every stage is a gate: pass → next stage, fail → logged and stopped.

---

## 4. Tech stack (all free tiers, no credit card)

| Tool | Role | Free tier |
|---|---|---|
| **Hookdeck** | Webhook gateway: queueing, retries, rate-throttling | Free starter project |
| **n8n** | Workflow automation engine (Docker) | Self-hosted = free |
| **Supabase** (PostgreSQL) | Staging database: leads, timeline events, spam log | Local = free |
| **Emailable** | Email deliverability verification | 250 one-time credits |
| **Apollo** | Company enrichment by domain | Free starter plan |
| **Gemini 2.5-flash-lite** | AI scoring + AI-written emails | Free API tier |
| **HubSpot** | CRM: deal + contact creation | Free CRM plan |
| **Slack** | Sales alerts | Free plan + incoming webhook |
| **Brevo** | Nurture email sending | 300 emails/day free |

All signups accept a **personal email** — no business email, no credit card needed.

---

## 5. How each stage works (plain English)

### Stage 0 — Hookdeck (the front door)
Every form submits to one public URL (`https://hkdk.events/3at57n99zasz2d`). Hookdeck acknowledges instantly (200 OK so the user's browser is happy), queues the payload, and forwards it to n8n at a controlled rate. If n8n is down, the event sits in a dead-letter queue and retries — **zero lead leakage**.

### Stage 1 — Sanitize (the bouncer)
A JavaScript code node checks the email: valid format? Not a disposable domain (@tempmail.com, @mailinator.com…)? Not a personal domain (@gmail.com, @yahoo.com…)? Not a student or competitor domain? It also strips control characters and collapses messy whitespace. Rejected leads go to a `spam_log` with a reason. *17/17 unit tests.*

### Stage 2 — Verify (the identity check)
Calls Emailable: is this mailbox actually deliverable, or will it bounce? Only confirmed-deliverable emails pass. Everything else is tagged `unverified` and never scored or CRM'd — *conservative by design* (a "risky" verdict is treated as not deliverable). The normalizer understands Emailable, Abstract, Hunter, ZeroBounce, and mailboxlayer response shapes. *19/19 unit tests.*

### Stage 3 — Dedup (the memory)
Before inserting, checks: have we seen this email before? Uses a **race-proof** pattern — a unique index on `lower(email)` plus `ON CONFLICT DO NOTHING` — so even two webhooks arriving in the same second can't create a duplicate row. New lead → `lead.captured` event; duplicate → `lead.captured.duplicate` event on the existing lead. *This was a real bug we hit and fixed: concurrent inserts created duplicates.*

### Stage 4 — Enrich (the detective)
Takes the email domain (e.g. `duck.com`) and asks Apollo: what company is this? Returns industry, employee count, country, city. The data is merged into the lead's firmographics and **persisted on the lead** (so it survives even if the AI call fails later). Runs only for NEW + deliverable leads — never wastes credits on junk. *5/5 unit tests.*

### Stage 5 — Anti-ICP (the border patrol)
Two layers of jurisdiction blocking:
1. **At the door:** if the incoming payload itself carries a country in the blocklist (KP, IR, CU, SY, BY, RU, VE, MM, SD, ZW), it's rejected immediately.
2. **After enrichment:** Apollo sometimes reveals the country (it returns names like "Russia", not codes — we map names → ISO codes). A dedicated node catches these and disqualifies the lead.
Blocked leads are stored with status `disqualified` and a timeline event — **never scored, never CRM'd**. *17/17 + 30/30 unit tests.*

### Stage 6 — Score (the brain)
Gemini (2.5-flash-lite) reads the firmographics and returns strict JSON: `icp_score` (0–100), `buying_intent` (high/medium/low), and a personalized icebreaker (a custom opening line for the sales rep). Score ≥ 70 → `qualified`; < 70 → `nurture`. Duplicates are never re-scored (saves API quota).

### Module 4 — Route (the dispatcher)
- **Qualified (≥ 70):** upserts a HubSpot contact by email → creates a HubSpot deal associated to that contact → posts a Slack alert with company, score, intent, icebreaker, and the deal URL. **Speed-to-lead: seconds, not hours.**
- **Nurture (< 70):** posts a Slack notice → Gemini writes a short personalized follow-up email (subject + body) → Brevo sends it → timeline event `lead.nurture.email.sent`.

---

## 6. The playbook — how it was built, step by step

> This is the "how did I do this" record. If I'm rebuilding or explaining, this is the order and the lessons.

### Phase 1 — Foundations (V1.0)
1. Scaffolded Supabase local project: `staged_leads` table (email, company, raw payload, firmographics, icp_score…), indexes, RLS + service_role grants.
2. Wrote the sanitizer (Stage 1) as a standalone JS snippet with unit tests.
3. Set up n8n in Docker (OrbStack), imported a draft workflow: Webhook → Sanitize → IF → Supabase insert.
4. Wrote a webhook simulator for synthetic test payloads (never real PII in dev).
5. **Lesson:** newer Supabase doesn't auto-expose new tables to API roles — explicit `service_role` GRANTs are required.

### Phase 2 — Reliability + dedup (V2.0)
6. Added Hookdeck as the gateway (CLI login, source, tunnel). E2E through Hookdeck verified.
7. Migration 02: `status` column, `lead_events` timeline, `spam_log`, and RPC helpers (`get_or_create_lead`, `append_lead_event`, `log_spam`).
8. **Lesson:** Supabase RPCs that return void → HTTP 204 empty body → n8n's JSON parse throws and kills the branch. Every RPC now returns `[{ok:true}]`.
9. **Lesson:** dedup race — two concurrent inserts both passed the SELECT. Fix: unique index on `lower(email)` + `ON CONFLICT DO NOTHING`.

### Phase 3 — AI scoring (Stage 6)
10. Verified Gemini model availability by curl: **1.5-flash and 2.0-flash are retired (404)**; 2.5-flash works. Later moved to 2.5-flash-lite for quota reasons.
11. **Lesson:** 2.5-flash's default thinking mode burns the output budget → truncated JSON (`MAX_TOKENS`). Fix: `thinkingConfig: {thinkingBudget: 0}` + `maxOutputTokens: 512`.
12. **Lesson:** n8n Code-node sandbox has NO `process.env` and NO `this.getCredentials`. API keys must be passed via HTTP-node expressions: `={{ $env.GEMINI_API_KEY }}`, with `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` in compose (local dev only).
13. Built the scoring chain: Code node builds the prompt → HTTP node calls Gemini → Code node parses + validates strict JSON → RPC persists score/status/icebreaker + `lead.scored` event.

### Phase 4 — Email verification (Stage 2)
14. Tried Abstract (keys rejected server-side) and Hunter (needs a business email to sign up) → **pivoted to Emailable** (250 free credits, personal email OK).
15. Built env-gated verification: IF node activates only when `EMAIL_VERIFY_API_KEY` is set → provider call → normalize → `Is Deliverable?` gate. No key = gate off = old behavior preserved.
16. **Lesson:** modern providers mark most big-mailbox probes (Gmail/iCloud, role accounts) undeliverable/risky — the conservative "unverified" tagging is intentional CRM hygiene.

### Phase 5 — Enrichment (Stage 4)
17. Apollo requires the key in the **X-Api-Key header** (body/query rejected).
18. **Lesson (hard-won):** n8n 2.34.5 silently drops custom headers on most configs — httpHeaderAuth credentials, `options.headers`, v4 `headersUi` all fail silently. The ONLY working path: HTTP Request **typeVersion 2** with `jsonParameters: true` + `headerParametersJson`. (Verified with a local echo server + httpbin.)
19. Migration 07: `update_lead_score` gains `p_firmographics` so enriched data is persisted, not just used in the prompt.

### Phase 6 — Jurisdiction blocking (Stage 5)
20. Wired the sanitizer's long-unused `BLOCKED_JURISDICTIONS` list (door check on payload country) + a post-enrichment backstop node (Apollo's name-form country → ISO alias map).
21. Migration 08: `mark_lead_blocked` RPC → status `disqualified` + `lead.blocked.jurisdiction` event.
22. **Lesson:** every blocked-country email domain (yandex.ru, mail.ru, vk.com) is undeliverable/risky per Emailable anyway — so the door check is the primary shield in practice.

### Phase 7 — CRM routing (Module 4)
23. HubSpot: free CRM + private-app token (scopes: contacts + deals read/write). Slack: free workspace + incoming webhook URL.
24. **Lesson:** HubSpot deal→contact association type id is **3** (`deal_to_contact`) on standard portals — the commonly-documented 5 fails with `INVALID_FROM_OBJECT`. Verify via `GET /crm/v3/associations/deals/contacts/types`.
25. **Lesson:** Slack webhooks reply with plain-text `ok` — n8n nodes must use `responseFormat: text`, not json.

### Phase 8 — Nurture emails (Module 4 follow-up)
26. Brevo free tier (300/day, no CC, personal email as verified sender — must click the sender-verification email).
27. Built the nurture chain: env-gated IF → prompt builder → Gemini → parser (with fallback template) → Brevo send → timeline event.
28. **Lesson:** after a chain of HTTP nodes, `$json` is the LAST response (e.g. Brevo's messageId) — reference earlier nodes via `$('Node Name').first().json.field`.
29. **Lesson:** Gemini free-tier daily quota is real — 2.5-flash exhausted mid-session (429). Moved to **2.5-flash-lite** (separate, higher pool), centralized in `GEMINI_ENDPOINT` so switching models is a one-line .env edit.

---

## 7. How to run it again (bring-up order)

1. Start OrbStack (Docker daemon)
2. Use the configured hosted Supabase project as the source of truth; do not start an unrelated local database for a hosted demo stack.
3. `docker compose up -d` → n8n on `localhost:5678` (env vars interpolate from `.env`)
4. `Automation/Hookdeck/start_hookdeck.sh` → reconnects the Hookdeck tunnel (same source URL)
5. Post a test lead:
   - Local: `POST http://localhost:5678/webhook/hookdeck-lead-ingest`
   - Production path: `POST https://hkdk.events/3at57n99zasz2d`
6. Watch: execution in n8n → row in `staged_leads` → timeline events → HubSpot deal / Slack alert / Brevo email

**Secrets:** everything lives in the gitignored `.env` next to `docker-compose.yml`. Never commit it. `.env.example` documents every variable.

---

## 8. Key files map

| File | What it is |
|---|---|
| `workflows/pre-crm/lead-qualification.workflow.json` | The 69-node compatibility workflow generated by the Python builder |
| `builders/build_lead_qualification_workflow.py` | Rebuilds workflow JSON from code-node sources |
| `core/pre-crm/n8n-code-nodes/*.js` | Reusable sanitizer, verifier, enrichment, jurisdiction, AI, outreach, and nurture logic |
| `registry/workflows.ts` | Product-neutral workflow metadata and runtime requirements |
| `.env.example` | Environment-variable names with empty placeholder values |
| `docs/architecture.md` | Backend architecture and independence boundaries |
| `testing/legacy/pre-crm/test-*.cjs` | Preserved compatibility tests for copied modules |

---

## 9. Business impact & value pitch

| Metric | Legacy | With this engine |
|---|---|---|
| Lead loss during outages | Webhook drops | 99.99% guaranteed (Hookdeck queue + retry) |
| Speed-to-lead | 2–24 hours manual | Seconds (automated Slack + email) |
| CRM hygiene | 30–40% bad records | 100% staged + verified before sync |
| HubSpot cost | Pays for all raw signups | Only qualified (≥ 70) contacts |
| Rep efficiency | 50% time on junk | 100% on AI-scored, high-intent leads |

**Value pitch:** *"I built a Pre-CRM AI staging engine that guarantees 100% CRM pipeline hygiene, eliminates ghost leads, prevents webhook loss during outages, optimizes paid contact seat limits, and delivers instant speed-to-lead — proving end-to-end engineering across ingestion gateways (Hookdeck), workflow engines (n8n), staging databases (Supabase), AI intelligence (Gemini), commercial CRMs (HubSpot), email delivery (Brevo), and internal ops tools (Slack)."*

---

## 10. Verification evidence (so I can prove it works)

- **Full E2E through production path (Aug 2026):** POST to Hookdeck URL → n8n execution SUCCESS → lead stored (qualified, 85/high) → Apollo-enriched firmographics → HubSpot deal "DuckDuckGo Inc — PreCRM" + contact → Slack alert. All verified via live APIs.
- **Unit tests:** sanitizer 17/17, verify parser 19/19, enrichment 5/5, jurisdiction 30/30, nurture prompt 11/11, nurture parse 11/11.
- **Migrations:** 01–08 applied, all RPCs return `[{ok:true}]`.
- **Git history:** private repo `m-irfvnnn/pre-crm-engine` — every milestone committed + pushed.

---

## 11. What's next (roadmap, not built)

- AI Outbound Voice Call (Vapi/Retell/Bland AI) for high-intent leads
- SMS/WhatsApp outreach (Twilio)
- Provider waterfall for enrichment (Clay/Clearbit fallback)
- Hookdeck signing secret (payload verification)
- Production hardening: `N8N_BLOCK_ENV_ACCESS_IN_NODE` back to true with proper credentialing
