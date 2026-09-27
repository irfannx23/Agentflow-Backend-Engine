/**
 * ============================================
 * n8n Code Node — v2 M5: Build Outreach Email Prompt
 * ============================================
 * For a ready_to_push OUTBOUND lead, build the Gemini prompt that writes a
 * personalized first-touch cold email. Runs only on the outbound ready_to_push
 * branch. No API key is touched here — the HTTP node does the call.
 *
 * Reads:
 *   $('Sanitize Lead')            -> { email, name, role, company_name, email_domain }
 *   $('Parse Gemini Score')       -> { icp_score, ... }
 *   $('Parse Enrichment')         -> { firmographics }
 *   $('Dedup: Get or Create Lead')-> { lead_id }
 *
 * Outputs (to "Call Gemini (Outreach)"):
 *   [{ lead_id, email, prompt }]
 * ============================================
 */

function buildOutreachPrompt(lead, score, firmographics) {
  const firmo = firmographics && typeof firmographics === 'object' ? firmographics : {};
  const industry = firmo.industry || 'your industry';
  const size = firmo.employees || 'your size';
  const country = firmo.country || '';
  const name = lead.name || 'there';
  const role = lead.role || 'your team';
  return [
    'You are a B2B RevOps SDR writing a short, personalized FIRST outreach email.',
    `Write a professional cold email to ${lead.company_name || lead.email_domain} (${industry}, ~${size} employees${country ? ', ' + country : ''}).`,
    `Recipient: ${name}${role ? ' (' + role + ')' : ''}.`,
    `Relevance score (ICP fit): ${score.icp_score ?? 'n/a'}/100.`,
    'Rules:',
    '  - Max 90 words; one clear value proposition; no links, no attachments, no hype.',
    '  - Reference one signal from their company/role naturally (not generic).',
    '  - End with a single low-pressure question.',
    'Return a STRICT JSON object (no markdown, no commentary) with exactly:',
    '  - "subject": a short subject line (max 8 words),',
    '  - "body": the email body as a single string with \\n line breaks.',
    '',
    'Lead context:',
    `  company: ${lead.company_name || lead.email_domain}`,
    `  industry: ${industry}`,
    `  employees: ${size}`,
    `  country: ${country || 'n/a'}`,
    `  name: ${name}`,
    `  role: ${role}`,
  ].join('\n');
}

export default function outreachPrompt() {
  const lead = $('Sanitize Lead').first().json;
  const score = $('Parse Gemini Score').first().json;
  const firmo = $('Parse Enrichment').first().json.firmographics || {};
  const leadId = $('Dedup: Get or Create Lead').first().json.lead_id;
  const prompt = buildOutreachPrompt(lead, score, firmo);
  return [{ lead_id: leadId, email: lead.email, company_name: lead.company_name || lead.email_domain, prompt }];
}
