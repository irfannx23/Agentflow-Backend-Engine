/**
 * ============================================
 * n8n Code Node — Stage 4: Merge Enrichment Into Firmographics
 * ============================================
 * Paste this into an n8n "Code" node (JavaScript mode).
 *
 * Purpose:
 *   Merge company enrichment data (Apollo organization response) into the
 *   lead's firmographics before Gemini scoring. Provider-agnostic: when the
 *   input carries an `organization` object the new fields win; otherwise
 *   the sanitizer's firmographics pass through unchanged (enrichment OFF).
 *
 * Business rules (see .clinerules):
 *   * Enrichment runs only for NEW + deliverable leads (the workflow gates
 *     it after verification) — never wastes credits on duplicates/bounces.
 *   * Enrichment never removes existing data — it only fills gaps.
 *
 * Reads:
 *   $input  = Call Enrich API response { organization: {...} }
 *             OR pass-through items (enrichment disabled path)
 *   $('Sanitize Lead')            -> { firmographics }   (base data)
 *   $('Dedup: Get or Create Lead') -> { lead_id }
 *
 * Output (to "Score Lead (Gemini)"):
 *   [{ lead_id, firmographics }]   (merged, or unchanged when no org data)
 * ============================================
 */

/**
 * Merge Apollo organization data into base firmographics.
 * Organization fields win when present; base data is never dropped.
 */
function mergeEnrichment(inputJson, baseFirmographics) {
  const org = inputJson && inputJson.organization;
  if (!org) {
    return baseFirmographics || {};
  }

  return {
    ...(baseFirmographics || {}),
    industry: org.industry || (baseFirmographics || {}).industry,
    employees: org.estimated_num_employees || (baseFirmographics || {}).employees,
    country: org.country || (baseFirmographics || {}).country,
    city: org.city || (baseFirmographics || {}).city,
    enriched_by: 'apollo',
  };
}

export default function parseEnrichment() {
  const input = $input.first().json;
  const sanitized = $('Sanitize Lead').first().json;
  const base = (sanitized && sanitized.firmographics) || {};
  const firmographics = mergeEnrichment(input, base);
  const leadId = $('Dedup: Get or Create Lead').first().json.lead_id;

  return [{ lead_id: leadId, firmographics }];
}
