> LEGACY / HISTORICAL REFERENCE
>
> This AI-scoring reference is retained for historical context and should not be treated as a master project-memory file.
>
> Current source of truth:
> `CODEX.md`, `TASK.md`, `STATE.md`, `ARCHITECTURE.md`, `Docs/Architecture/API_SPEC.md`, `CHANGELOG.md`, `README.md`, `FILE_STRUCTURE.md`

# Gemini.md — AI Intelligence (Module 3) Scoring Logic

**Why this file is used:** Repository for the AI scoring logic — prompts and output contracts — so the "best" version that worked in testing is never lost, and the AI agent can refine scoring without breaking the schema.

> Note: the V2.0 blueprint names Claude (Anthropic) as the AI provider, but the implemented module uses **Gemini** (`gemini-1.5-flash`) per `.clinerules` (DeepSeek for orchestration, Gemini for AI Scoring & Intelligence). Keep this file in sync with whichever provider is active.

## Module purpose
Given enriched firmographic data for a prospective company, return a structured qualification:
- `icp_score`: integer 0–100 (how well the company fits the ICP)
- `buying_intent`: `"high" | "medium" | "low"`
- `personalized_icebreaker`: short professional opening (max 2 sentences) referencing tech stack + monthly spend

## System prompt (current version, from `core/revops/contracts/ai-qualification-score.ts`)

```
You are a B2B RevOps lead-scoring assistant.
Analyze the following enriched firmographic data for a prospective company.
Return a STRICT JSON object (no markdown, no commentary) with exactly these keys:
  - "icp_score": an integer from 0 to 100 representing how well the company fits our ICP.
  - "buying_intent": one of "high", "medium", or "low" based on signals like tech stack maturity and monthly spend.
  - "personalized_icebreaker": a short, professional, personalized opening message (max 2 sentences) referencing the company's tech stack and monthly spend.

Firmographic data:
<JSON>

Respond with only the JSON object.
```

## API call configuration
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent` (env: `GEMINI_ENDPOINT`)
- Auth: `?key=${GEMINI_API_KEY}` (from env, never hardcoded)
- `temperature: 0.2` · `maxOutputTokens: 512`

## Output contract (validated by `parseGeminiResponse`)
```json
{
  "icp_score": 88,
  "buying_intent": "high",
  "personalized_icebreaker": "Notice AI Labs spends $20k+ on AI tooling. CostPulse can cap token spikes automatically."
}
```
Validation rules: icp_score must be a number 0–100; buying_intent must be one of high/medium/low; icebreaker must be a string. Markdown code fences in the raw response are stripped before parsing. Any violation throws — the n8n flow should treat a throw as "scoring failed, hold in staging".

## Usage in n8n
```js
// The n8n workflow embeds the registered prompt and response parser modules.
// Server-side TypeScript consumers may import scoreLeadWithGemini from:
// core/revops/contracts/ai-qualification-score.ts
```
✅ Wired into `workflows/pre-crm/lead-qualification.workflow.json` through the copied n8n code-node modules.

## Prompt evolution log
| Version | Change | Result |
|---|---|---|
| v1 (current) | Initial strict-JSON scoring prompt | Pending first live test |
