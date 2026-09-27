/**
 * AI cold-email generation + parsing for the outbound outreach loop (M5).
 *
 * buildOutreachPrompt composes the Gemini instruction from the lead's
 * firmographics + relevance. parseOutreach defensively extracts a strict JSON
 * { subject, body } from the model text, falling back to a safe template so a
 * malformed response never crashes the send node.
 *
 * Pure — no I/O, unit-tested via scripts/test-outreach-generate.cjs.
 */

/** Build the Gemini prompt for a personalized first-touch cold email. */
export function buildOutreachPrompt(input: {
  email: string;
  name?: string | null;
  role?: string | null;
  company: string;
  firmographics?: Record<string, unknown> | null;
  icp_score?: number | null;
}): string {
  const firmo = input.firmographics && typeof input.firmographics === 'object' ? input.firmographics : {};
  const industry = (firmo.industry as string) || 'your industry';
  const size = (firmo.employees as string | number | undefined) || 'your size';
  const country = (firmo.country as string) || '';
  const name = input.name || 'there';
  const role = input.role || 'your team';

  return [
    'You are a B2B RevOps SDR writing a short, personalized FIRST outreach email.',
    `Write a professional cold email to ${input.company} (${industry}, ~${size} employees${country ? ', ' + country : ''}).`,
    `Recipient: ${name}${role ? ' (' + role + ')' : ''}.`,
    `Relevance score (ICP fit): ${input.icp_score ?? 'n/a'}/100.`,
    'Rules:',
    '  - Max 90 words; one clear value proposition; no links, no attachments, no hype.',
    '  - Reference one signal from their company/role naturally (not generic).',
    '  - End with a single low-pressure question.',
    'Return a STRICT JSON object (no markdown, no commentary) with exactly:',
    '  - "subject": a short subject line (max 8 words),',
    '  - "body": the email body as a single string with \\n line breaks.',
    '',
    'Lead context:',
    `  company: ${input.company}`,
    `  industry: ${industry}`,
    `  employees: ${size}`,
    `  country: ${country || 'n/a'}`,
    `  name: ${name}`,
    `  role: ${role}`,
  ].join('\n');
}

/** Extract the model text from a Gemini generateContent response. */
function geminiText(resp: unknown): string {
  try {
    const r = resp as any;
    const candidates = r?.candidates;
    const parts = candidates?.[0]?.content?.parts;
    if (parts?.[0] && typeof parts[0].text === 'string') return parts[0].text;
  } catch {
    /* fall through */
  }
  return '';
}

/** Defensively parse a JSON object out of the model text. */
export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(json)?/i, '')
    .replace(/```$/, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Parse { subject, body } out of a Gemini response, with a safe fallback. */
export function parseOutreach(resp: unknown): { subject: string; body: string } {
  const parsed = extractJson(geminiText(resp)) || {};
  const subject = String(parsed.subject || '').trim();
  const body = String(parsed.body || '').trim();
  if (subject && body) return { subject, body };
  return {
    subject: subject || 'A thought for your team',
    body: body || 'Hi there — I noticed your company and thought I could share a quick, relevant idea. Open to a short chat when timing suits.',
  };
}
