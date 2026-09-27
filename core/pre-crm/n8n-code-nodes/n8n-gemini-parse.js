/**
 * ============================================
 * n8n Code Node — Stage 6b: Parse & Validate Gemini Score
 * ============================================
 * Paste this into an n8n "Code" node (JavaScript mode).
 *
 * Purpose:
 *   Parse the "Call Gemini API" HTTP node response, validate the strict
 *   scoring shape, and hand a clean record to the "Update Lead Score"
 *   RPC node. No API key is touched here.
 *
 * Input:   $json  = Gemini generateContent response
 *          (candidates[0].content.parts[0].text = the JSON score)
 * Reads:   $('Score Lead (Gemini)') -> { lead_id }
 * Output:  [{ lead_id, icp_score, buying_intent,
 *             personalized_icebreaker, status }]
 *          or [] to end the branch silently (malformed / no text).
 * ============================================
 */

/** Parse and validate the Gemini response into a strict scoring shape. */
function parseGeminiResponse(raw) {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const parsed = JSON.parse(cleaned);
  const icp_score = Number(parsed.icp_score);
  const buying_intent = parsed.buying_intent;
  const personalized_icebreaker = parsed.personalized_icebreaker;

  if (
    Number.isNaN(icp_score) ||
    icp_score < 0 ||
    icp_score > 100 ||
    !['high', 'medium', 'low'].includes(buying_intent) ||
    typeof personalized_icebreaker !== 'string'
  ) {
    throw new Error('Gemini returned an unexpected scoring shape.');
  }

  return { icp_score, buying_intent, personalized_icebreaker };
}

export default function parseGeminiScore() {
  const response = $input.first().json;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    return []; // no usable text -> end branch silently
  }

  const score = parseGeminiResponse(text);
  const leadId = $('Score Lead (Gemini)').first().json.lead_id;
  const status = score.icp_score >= 70 ? 'qualified' : 'nurture';

  return [
    {
      lead_id: leadId,
      icp_score: score.icp_score,
      buying_intent: score.buying_intent,
      personalized_icebreaker: score.personalized_icebreaker,
      status,
    },
  ];
}
