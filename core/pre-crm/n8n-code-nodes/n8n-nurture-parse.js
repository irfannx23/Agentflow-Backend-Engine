/**
 * ============================================
 * n8n Code Node — Module 4: Parse Nurture Email
 * ============================================
 * Paste this into an n8n "Code" node (JavaScript mode).
 *
 * Purpose:
 *   Extract { subject, body } from Gemini's strict-JSON nurture email
 *   response (defensive: tolerate markdown fences / stray text like the
 *   scoring parser does).
 *
 * Reads:
 *   $('Call Gemini (Nurture Email)') -> Gemini generateContent response
 *   $('Build Nurture Email')         -> { lead_id, email, company_name }
 *
 * Outputs (to "Send Nurture Email (Brevo)"):
 *   [{ lead_id, to_email, subject, body }]
 * ============================================
 */

/** Pull the text out of a Gemini generateContent response. */
function geminiText(raw) {
  try {
    const candidates = raw && raw.candidates;
    const parts = candidates && candidates[0] && candidates[0].content && candidates[0].content.parts;
    if (parts && parts[0] && typeof parts[0].text === 'string') return parts[0].text;
  } catch (e) { /* fall through */ }
  return '';
}

/** Defensively parse a JSON object out of the model text. */
function extractJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

export default function parseNurtureEmail() {
  const gemini = $('Call Gemini (Nurture Email)').first().json;
  const built = $('Build Nurture Email').first().json;

  const parsed = extractJson(geminiText(gemini)) || {};
  const subject = String(parsed.subject || '').trim();
  const body = String(parsed.body || '').trim();

  if (!subject || !body) {
    // Defensive: fall back to a templated message so the send node still works.
    return [{
      lead_id: built.lead_id,
      to_email: built.email,
      subject: subject || 'A quick thought for your team',
      body: body || 'Hi there — just checking in with a useful resource. Happy to share more when the timing is right.',
    }];
  }

  return [{
    lead_id: built.lead_id,
    to_email: built.email,
    subject,
    body,
  }];
}
