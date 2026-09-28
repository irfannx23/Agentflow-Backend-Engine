/** Build AgentFlow's signup ICP prompt from normalized firmographics only. */
function buildScoringPrompt(firmographics) {
  return [
    'You are the lead qualification intelligence layer for AgentFlow, an AI-powered workflow automation platform.',
    '',
    'Evaluate the prospective organization using ONLY the firmographic and enrichment information supplied.',
    '',
    'AgentFlow is relevant to organizations that could benefit from:',
    '- AI-powered workflow automation',
    '- n8n/API/integration automation',
    '- repetitive operational-process automation',
    '- GTM/RevOps automation',
    '- AI workflow generation/orchestration',
    '- multi-system integration',
    '',
    'Assess company fit using available evidence such as industry, employee count, geography, organization description, growth or funding indicators, technologies only when explicitly supplied, and other supplied enrichment attributes.',
    '',
    'Return STRICT JSON with exactly these keys:',
    '{"icp_score":0,"fit":"low","buying_intent":"unknown","qualification_reason":"","company_summary":"","personalized_icebreaker":""}',
    '',
    'Rules:',
    '- icp_score must be an integer from 0 to 100.',
    '- fit must be "high", "medium", or "low" and must agree with the score and evidence.',
    '- buying_intent must be "unknown". Firmographic fit is not buying intent.',
    '- qualification_reason must be a brief evidence-based explanation.',
    '- company_summary must be brief and factual.',
    '- personalized_icebreaker must be 1-2 professional sentences using known data only.',
    '- Never invent missing information.',
    '- Never infer budget, monthly spend, pain points, or purchase intent.',
    '- Never invent technology usage. Mention technologies only when they appear in the supplied object.',
    '- Missing enrichment must reduce confidence and fit rather than cause fabrication.',
    '- Personal email domains without reliable organization enrichment are low-confidence and must not produce invented company data.',
    '- No markdown and no commentary outside the JSON object.',
    '',
    'Normalized firmographic data:',
    JSON.stringify(firmographics, null, 2),
  ].join('\n');
}

export default function scoreLeadWithGemini() {
  const leadContext = $('Normalize Lead Context').first().json || {};
  const enriched = $('Parse Enrichment').first().json || {};
  const firmographics = enriched.firmographics || {};

  if (!leadContext.is_new) {
    return [{
      lead_id: leadContext.lead_id,
      scoring_required: false,
      deterministic_qualification: false,
      scoring_status: 'skipped',
      status: 'skipped',
      reason: 'duplicate_lead',
    }];
  }

  const hasReliableOrganization = enriched.enrichment_status === 'matched'
    && Boolean(
      firmographics.company_name ||
      firmographics.domain ||
      firmographics.industry ||
      firmographics.employee_count ||
      firmographics.country ||
      firmographics.company_description ||
      firmographics.total_funding ||
      firmographics.technologies
    );

  if (!hasReliableOrganization) {
    return [{
      lead_id: leadContext.lead_id,
      scoring_required: false,
      deterministic_qualification: true,
      scoring_status: 'low_confidence',
      enrichment_status: enriched.enrichment_status || 'not_found',
      status: 'nurture',
      reason: 'insufficient_firmographic_evidence',
      firmographics,
    }];
  }

  return [{
    lead_id: leadContext.lead_id,
    scoring_required: true,
    deterministic_qualification: false,
    scoring_status: 'pending',
    enrichment_status: enriched.enrichment_status,
    firmographics,
    prompt: buildScoringPrompt(firmographics),
  }];
}
