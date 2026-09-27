/**
 * ============================================
 * n8n Code Node — Position 0: Anti-Abuse Gate
 * ============================================
 * Anti-bot / cost-protection gate. Runs BEFORE any paid/costly stage
 * (sanitize, verify, enrich, score), so a bot flood never burns Emailable
 * credits, Apollo quota, or Gemini tokens, and never backs up the queue.
 *
 * All checks are free (zero API calls):
 *   1. honeypot  — bots fill hidden fields; humans never see them
 *   2. too_fast  — a sub-second (or future) submitted_at is a bot, not a human
 *   3. ip_flood  — >30 leads from the same IP in 10 min (count passed in)
 *   4. daily_cap — circuit breaker: >500 leads/day pauses ALL + alerts (count passed in)
 *
 * The two DB-backed counts (ip_flood_count, daily_count) are fetched by
 * preceding HTTP RPC nodes and merged onto the item; this Code node stays pure.
 *
 * Outputs a single item: the lead unchanged + { abuse_gate, abuse_reason }.
 *   abuse_gate = 'pass' (continue) | 'drop' (record_abuse + end branch)
 * ============================================
 */

/** Pure decision logic — unit-tested via scripts/test-anti-abuse.cjs. */
function evaluateAntiAbuse(payload, counts) {
  // 1. Honeypot
  if (payload && payload.hp && String(payload.hp).trim() !== '') {
    return { action: 'drop', reason: 'honeypot' };
  }
  // 2. Too-fast / future timestamp
  if (payload && payload.submitted_at) {
    const t = Date.parse(payload.submitted_at);
    if (!isNaN(t)) {
      const ageMs = Date.now() - t;
      if (ageMs < 1000) return { action: 'drop', reason: 'too_fast' };
    }
  }
  const ipFlood = counts && typeof counts.ipFloodCount === 'number' ? counts.ipFloodCount : 0;
  const daily   = counts && typeof counts.dailyCount === 'number'   ? counts.dailyCount   : 0;
  // 3. Per-IP flood
  if (ipFlood >= 30) return { action: 'drop', reason: 'ip_flood' };
  // 4. Daily circuit breaker
  if (daily >= 500) return { action: 'drop', reason: 'daily_cap' };
  return { action: 'pass', reason: null };
}

export default function antiAbuseGate() {
  // n8n webhook wraps the request as { headers, body, query, params } — unwrap
  // so we always evaluate against the lead object (mirrors the sanitizer).
  const raw = $json || {};
  const lead = raw.body && typeof raw.body === 'object' ? raw.body : raw;
  const payload =
    lead && lead.raw_payload && typeof lead.raw_payload === 'object' ? lead.raw_payload : lead;
  const counts = {
    ipFloodCount: lead && typeof lead.ip_flood_count === 'number' ? lead.ip_flood_count : undefined,
    dailyCount:   lead && typeof lead.daily_count === 'number'   ? lead.daily_count   : undefined,
  };
  const { action, reason } = evaluateAntiAbuse(payload, counts);
  // Preserve the envelope for the sanitizer (which also unwraps .body).
  return [{ ...$json, abuse_gate: action, abuse_reason: reason }];
}
