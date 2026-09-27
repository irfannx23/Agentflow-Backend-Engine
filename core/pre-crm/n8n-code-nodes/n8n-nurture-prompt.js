/**
 * ============================================
 * n8n Code Node — Module 4: Build Nurture Email Prompt
 * ============================================
 * Paste this into an n8n "Code" node (JavaScript mode).
 *
 * Purpose:
 *   For a NURTURE lead (icp_score < 70, not CRM-ready), build a Gemini
 *   prompt that writes a short, personalized follow-up email. Runs only
 *   on the nurture branch, and only when BREVO_API_KEY is set (env-gated).
 *
 * Business rules (see .clinerules):
 *   * Nurture leads are NOT sent to HubSpot — they get an email instead.
 *   * Gemini writes the copy (subject + body), keeps it short and human.
 *   * No API key is touched in this node — the HTTP node does the call.
 *
 * Reads:
 *   $('Sanitize Lead')            -> { email, company_name, firmographics }
 *   $('Parse Gemini Score')       -> { icp_score, buying_intent, personalized_icebreaker }
 *   $('Dedup: Get or Create Lead')-> { lead_id }
 *
 * Outputs (to "Call Gemini (Nurture Email)"):
 *   [{ lead_id, prompt, email, company_name }]
 * ============================================
 */

/** Build the prompt that instructs Gemini to write the nurture email. */
function buildNurturePrompt(leadInfo, scoreInfo, firmographics) {
  return [
    'You are a B2B RevOps assistant writing a nurture follow-up email.',
    'The prospect is not yet ready to buy but is worth staying in touch with.',
    'Write a SHORT, friendly, professional email (max 120 words) that:',
    '  - references their company/industry signal naturally,',
    '  - offers one useful, low-pressure value point,',
    '  - ends with a soft question (not a sales pitch).',
    'Return a STRICT JSON object (no markdown, no commentary) with exactly:',
    '  - "subject": a short subject line (max 8 words),',
    '  - "body": the email body as a single string with \\n line breaks.',
    '',
    'Lead context:',
    JSON.stringify({
      company: leadInfo.company_name,
      email: leadInfo.email,
      icp_score: scoreInfo.icp_score,
      buying_intent: scoreInfo.buying_intent,
      icebreaker: scoreInfo.personalized_icebreaker,
      firmographics: firmographics || {},
    }, null, 2),
    '',
    'Respond with only the JSON object.',
  ].join('\n');
}

export default function buildNurtureEmailPrompt() {
  const lead = $('Sanitize Lead').first().json;
  const score = $('Parse Gemini Score').first().json;
  const dedup = $('Dedup: Get or Create Lead').first().json;

  return [{
    lead_id: dedup.lead_id,
    email: lead.email,
    company_name: lead.company_name,
    prompt: buildNurturePrompt(
      { company_name: lead.company_name, email: lead.email },
      { icp_score: score.icp_score, buying_intent: score.buying_intent, personalized_icebreaker: score.personalized_icebreaker },
      lead.firmographics
    ),
  }];
}
