/**
 * ============================================
 * n8n Code Node — Outbound Gate (v2 M4)
 * ============================================
 * Runs ONLY for source_type='outbound_scraped' leads, after scoring. Decides
 * whether the lead is ready for the AI-outreach loop.
 *
 * Pass ONLY if: MX-ok (domain has a live mail server) AND icp_score >= 70.
 * Deliverability is already guaranteed upstream (only verified leads reach
 * scoring), so the gate here is MX + relevance. A no-MX or low-score lead is
 * kept staged with a logged reason, never emailed.
 *
 * Reads:
 *   $json (current item) = the MX sidecar response { domain, hasMx, records, error }
 *   $('Parse Gemini Score') = { icp_score, ... }
 *
 * Outputs: [{ outbound_gate: 'pass'|'fail', outbound_reason, icp_score }]
 * ============================================
 */

export default function outboundGate() {
  const mx = $json || {};
  const score = $('Parse Gemini Score').first().json || {};
  const icp = typeof score.icp_score === 'number' ? score.icp_score : 0;

  if (!mx.hasMx) {
    return [{ outbound_gate: 'fail', outbound_reason: 'no_mx', mx_domain: mx.domain || null, mx_error: mx.error || null, icp_score: icp }];
  }
  if (icp < 70) {
    return [{ outbound_gate: 'fail', outbound_reason: 'low_score', icp_score: icp }];
  }
  return [{ outbound_gate: 'pass', outbound_reason: null, icp_score: icp }];
}
