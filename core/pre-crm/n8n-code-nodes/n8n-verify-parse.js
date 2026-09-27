/**
 * ============================================
 * n8n Code Node — Stage 2b: Parse Email Verification Result
 * ============================================
 * Paste this into an n8n "Code" node (JavaScript mode).
 *
 * Purpose:
 *   Normalize the verification provider's response into a single
 *   { deliverable, verdict } decision. Provider-agnostic — handles
 *   Emailable (state), Abstract (deliverability), Hunter (data.result),
 *   and ZeroBounce (status) shapes.
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

/** Normalize an Emailable / Abstract / Hunter / ZeroBounce verification response. */
function parseVerifyResponse(raw) {
  const data = (raw && (raw.data || raw)) || {};

  // Emailable: { state: "deliverable"|"undeliverable"|"risky"|"unknown", reason }
  const state = String(data.state || '').toLowerCase();

  // Abstract: { deliverability: "DELIVERABLE"|"UNDELIVERABLE"|"UNKNOWN"|"RISKY", is_disposable_email: bool, ... }
  const deliverability = String(data.deliverability || '').toLowerCase();

  // Hunter:   { data: { status, result } }
  // ZeroBounce: { status, sub_status }
  const status = String(data.status || '').toLowerCase();
  const result = String(data.result || '').toLowerCase();

  // Mailboxlayer: { format_valid, mx_found, smtp_check, catch_all, disposable, ... }
  const smtpOk = data.smtp_check === true || data.smtp_check === 'true';

  const deliverable =
    state === 'deliverable' ||
    (deliverability === 'deliverable' && !data.is_disposable_email) ||
    result === 'deliverable' ||
    status === 'valid' ||
    (data.format_valid === true && smtpOk && data.catch_all !== true && !data.disposable);

  // verdict is debug info; the deliverable boolean is the decision.
  const verdict = deliverable
    ? 'deliverable'
    : state || deliverability || result || status || 'unknown';

  return { deliverable, verdict };
}

export default function parseVerification() {
  const raw = $input.first().json;
  const parsed = parseVerifyResponse(raw);

  return [{ deliverable: parsed.deliverable, verdict: parsed.verdict }];
}
