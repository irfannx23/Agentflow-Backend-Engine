/** Create a persisted, non-fabricated outcome when Apollo has no match. */
function buildLowConfidenceQualification(context) {
  return {
    lead_id: context.lead_id,
    icp_score: 0,
    fit: 'low',
    buying_intent: 'unknown',
    qualification_reason: 'Insufficient firmographic evidence: Apollo did not return a reliable organization match.',
    company_summary: '',
    personalized_icebreaker: '',
    enrichment_status: context.enrichment_status || 'not_found',
    scoring_status: 'skipped',
    confidence: 'low',
    status: 'nurture',
  };
}

export default function lowConfidenceQualification() {
  return [buildLowConfidenceQualification($input.first().json || {})];
}
