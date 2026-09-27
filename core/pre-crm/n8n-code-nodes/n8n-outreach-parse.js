/**
 * ============================================
 * n8n Code Node — v2 M5: Parse Outreach Email
 * ============================================
 * Parse { subject, body } out of the Gemini outreach response, with a safe
 * fallback so a malformed/truncated response never breaks the send node.
 *
 * Reads:
 *   $('Call Gemini (Outreach)')   -> the Gemini generateContent response
 *   $('Build Outreach Email')     -> { lead_id, email, prompt }
 *
 * Outputs (to "Insert Outreach Row" / Brevo send):
 *   [{ lead_id, to_email, subject, body }]
 * ============================================
 */

function geminiText(resp) {
  try {
    const candidates = resp && resp.candidates;
    const parts = candidates && candidates[0] && candidates[0].content && candidates[0].content.parts;
    if (parts && parts[0] && typeof parts[0].text === 'string') return parts[0].text;
  } catch (e) { /* fall through */ }
  return '';
}

function extractJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch (e) { return null; }
}

function parseOutreach(resp) {
  const parsed = extractJson(geminiText(resp)) || {};
  const subject = String(parsed.subject || '').trim();
  const body = String(parsed.body || '').trim();
  if (subject && body) return { subject, body };
  return {
    subject: subject || 'A thought for your team',
    body: body || 'Hi there — I noticed your company and thought I could share a quick, relevant idea. Open to a short chat when timing suits.',
  };
}

export default function outreachParse() {
  const gemini = $('Call Gemini (Outreach)').first().json;
  const built = $('Build Outreach Email').first().json;
  const { subject, body } = parseOutreach(gemini);
  return [{ lead_id: built.lead_id, to_email: built.email, subject, body }];
}
