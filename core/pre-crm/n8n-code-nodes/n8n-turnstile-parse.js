/**
 * ============================================
 * n8n Code Node — Turnstile siteverify result parser
 * ============================================
 * Parses the Cloudflare Turnstile siteverify response from the preceding
 * HTTP Request node and turns it into a gate decision.
 *
 *   { success: true }  -> pass
 *   { success: false } -> drop (turnstile_failed)
 *
 * The "no token on an inbound lead" case is handled upstream by an IF node
 * (inbound + TURNSTILE_SECRET_KEY set + no token -> drop 'turnstile_missing').
 * Outbound scraped leads skip Turnstile entirely (no form in front of them).
 *
 * Outputs one item: the response + { turnstile_ok, abuse_gate, abuse_reason }.
 * ============================================
 */

/** Pure decision logic — unit-tested via scripts/test-anti-abuse.cjs. */
function evaluateTurnstile(response) {
  const ok = !!response && response.success === true;
  return {
    turnstile_ok: ok,
    abuse_gate: ok ? 'pass' : 'drop',
    abuse_reason: ok ? null : 'turnstile_failed',
  };
}

export default function turnstileParse() {
  const { turnstile_ok, abuse_gate, abuse_reason } = evaluateTurnstile($json);
  return [{ ...$json, turnstile_ok, abuse_gate, abuse_reason }];
}
