/** Parse and validate the strict AgentFlow signup ICP contract. */
function parseGeminiResponse(raw) {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  const icpScore = Number(parsed.icp_score);

  if (
    !Number.isInteger(icpScore) ||
    icpScore < 0 ||
    icpScore > 100 ||
    !['high', 'medium', 'low'].includes(parsed.fit) ||
    parsed.buying_intent !== 'unknown' ||
    typeof parsed.qualification_reason !== 'string' ||
    !parsed.qualification_reason.trim() ||
    typeof parsed.company_summary !== 'string' ||
    typeof parsed.personalized_icebreaker !== 'string'
  ) {
    throw new Error('gemini_response_unexpected_agentflow_icp_shape');
  }

  return {
    icp_score: icpScore,
    fit: parsed.fit,
    buying_intent: 'unknown',
    qualification_reason: parsed.qualification_reason.trim(),
    company_summary: parsed.company_summary.trim(),
    personalized_icebreaker: parsed.personalized_icebreaker.trim(),
  };
}

function extractGeminiText(response) {
  const finishReason = response.candidates?.[0]?.finishReason;
  if (response.promptFeedback?.blockReason || finishReason === 'SAFETY') {
    throw new Error(`gemini_safety_block:${response.promptFeedback?.blockReason || finishReason}`);
  }
  if (!Array.isArray(response.candidates) || response.candidates.length === 0) {
    throw new Error('gemini_response_missing_candidates');
  }
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`gemini_response_missing_text:${finishReason || 'unknown'}`);
  return text;
}

export default function parseGeminiScore() {
  const response = $input.first().json || {};
  const text = extractGeminiText(response);

  let score;
  try {
    score = parseGeminiResponse(text);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('gemini_response_')) throw error;
    throw new Error(`gemini_response_invalid_json:${error instanceof Error ? error.message : 'unknown'}`);
  }

  const scoringContext = $('Score Lead (Gemini)').first().json || {};
  return [{
    lead_id: scoringContext.lead_id,
    ...score,
    enrichment_status: scoringContext.enrichment_status,
    scoring_status: 'completed',
    status: score.icp_score >= 70 ? 'qualified' : 'nurture',
  }];
}
