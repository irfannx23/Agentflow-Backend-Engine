/**
 * ============================================
 * n8n Code Node — Stage 2b: Parse Email Verification Result
 * ============================================
 * Paste this into an n8n "Code" node (JavaScript mode).
 *
 * Purpose:
 *   Normalize the canonical Emailable response into a deterministic
 *   { deliverable, verdict, verification_status } decision.
 *
 *   deliverable = true ONLY for confirmed-deliverable verdicts:
 *     Emailable:  state === "deliverable"
 *     Abstract:   deliverability === "DELIVERABLE" && not disposable
 *     Hunter:     result === "deliverable"
 *     ZeroBounce: status === "valid"
 *   catch-all / risky / unknown / disposable -> NOT deliverable
 *   (conservative by design for CRM hygiene).
 *
 * Input:   $json = provider response
 * Output:  [{ deliverable: boolean, verdict: string }]
 * ============================================
 */

/** Normalize an Emailable single-verification response. */
function parseVerifyResponse(raw) {
  const data = (raw && raw.data) || raw || {};
  const state = String(data.state || '').toLowerCase();
  if (!state) throw new Error('emailable_response_missing_state');
  if (!['deliverable', 'undeliverable', 'risky', 'unknown'].includes(state)) {
    throw new Error(`emailable_response_invalid_state:${state}`);
  }
  return {
    deliverable: state === 'deliverable',
    verdict: state,
    verification_status: 'completed',
    reason: typeof data.reason === 'string' ? data.reason : null,
  };
}

export default function parseVerification() {
  const raw = $input.first().json;
  const parsed = parseVerifyResponse(raw);

  return [parsed];
}
