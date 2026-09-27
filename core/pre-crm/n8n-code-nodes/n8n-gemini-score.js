/**
 * ============================================
 * n8n Code Node — Stage 6a: Build Gemini Scoring Prompt
 * ============================================
 * Paste this into an n8n "Code" node (JavaScript mode).
 *
 * Purpose:
 *   Decide whether a NEW lead should be scored, and if so build the
 *   Gemini prompt from its firmographics. This node NEVER touches the
 *   API key — the actual API call is made by the "Call Gemini API"
 *   HTTP Request node (credential: Gemini API Key (dev)), and the
 *   response is validated by "Parse Gemini Score".
 *
 * Business rules (see .clinerules):
 *   * Only NEW leads are scored (duplicates would burn API quota re-scoring).
 *   * Leads without firmographic signal are skipped silently.
 *   * icp_score >= 70 -> status 'qualified', else -> 'nurture'
 *     (Module 4 routing happens later; Stage 6 only persists the score).
 *
 * Reads from:
 *   $('Normalize Lead Context')    -> { lead_id, is_new }
 *   $('Sanitize Lead')            -> { firmographics }
 *
 * Outputs (to "Call Gemini API"):
 *   [{ lead_id, prompt }]   -> score this lead
 *   []                      -> skip (duplicate / no firmographics)
 * ============================================
 */

/** Build the prompt that instructs Gemini to score the lead. */
function buildScoringPrompt(firmographics) {
  return [
    'You are a B2B RevOps lead-scoring assistant.',
    'Analyze the following enriched firmographic data for a prospective company.',
    'Return a STRICT JSON object (no markdown, no commentary) with exactly these keys:',
    '  - "icp_score": an integer from 0 to 100 representing how well the company fits our ICP.',
    '  - "buying_intent": one of "high", "medium", or "low" based on signals like tech stack maturity and monthly spend.',
    '  - "personalized_icebreaker": a short, professional, personalized opening message (max 2 sentences) referencing the company\'s tech stack and monthly spend.',
    '',
    'Firmographic data:',
    JSON.stringify(firmographics, null, 2),
    '',
    'Respond with only the JSON object.',
  ].join('\n');
}

export default function scoreLeadWithGemini() {
  const leadContext = $('Normalize Lead Context').first().json || {};
  // Firmographics come from the enrichment merger (Stage 4) — which passes
  // the sanitizer's firmographics through unchanged when enrichment is off.
  const enriched = $('Parse Enrichment').first().json;
  const firmographics = (enriched && enriched.firmographics) || {};

  // Only score brand-new leads: duplicates already got a timeline event.
  if (!leadContext.is_new) {
    return [];
  }

  // Need at least one firmographic signal to score meaningfully.
  const hasSignal =
    firmographics &&
    (firmographics.company_name ||
      firmographics.industry ||
      firmographics.employees ||
      firmographics.tech_stack ||
      firmographics.monthly_spend ||
      firmographics.domain);

  if (!hasSignal) {
    return []; // nothing to score -> end branch silently
  }

  return [
    {
      lead_id: leadContext.lead_id,
      prompt: buildScoringPrompt(firmographics),
    },
  ];
}
