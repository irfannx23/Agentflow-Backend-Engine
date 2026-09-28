/** AgentFlow signup ICP scoring through Gemini. */

const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface GeminiScore {
  icp_score: number
  fit: 'high' | 'medium' | 'low'
  buying_intent: 'unknown'
  qualification_reason: string
  company_summary: string
  personalized_icebreaker: string
}

export interface Firmographics {
  company_name?: string
  domain?: string
  industry?: string
  industries?: string[]
  employee_count?: number
  country?: string
  region?: string
  city?: string
  company_description?: string
  founded_year?: number
  total_funding?: number
  latest_funding_stage?: string
  latest_funding_round_date?: string
  headcount_growth_6m?: number
  headcount_growth_12m?: number
  headcount_growth_24m?: number
  technologies?: string[]
  email_verification_status?: string
  email_classification?: 'business' | 'personal'
  acquisition_source?: string
  auth_provider?: string
  signup_event?: string
  enrichment_provider?: 'apollo'
}

export function buildScoringPrompt(firmographics: Firmographics): string {
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
  ].join('\n')
}

export function parseGeminiResponse(raw: string): GeminiScore {
  const parsed = JSON.parse(raw.replace(/```json/gi, '').replace(/```/g, '').trim()) as Partial<GeminiScore>
  const icpScore = Number(parsed.icp_score)
  if (
    !Number.isInteger(icpScore)
    || icpScore < 0
    || icpScore > 100
    || !['high', 'medium', 'low'].includes(String(parsed.fit))
    || parsed.buying_intent !== 'unknown'
    || typeof parsed.qualification_reason !== 'string'
    || !parsed.qualification_reason.trim()
    || typeof parsed.company_summary !== 'string'
    || typeof parsed.personalized_icebreaker !== 'string'
  ) throw new Error('gemini_response_unexpected_agentflow_icp_shape')

  return {
    icp_score: icpScore,
    fit: parsed.fit as GeminiScore['fit'],
    buying_intent: 'unknown',
    qualification_reason: parsed.qualification_reason.trim(),
    company_summary: parsed.company_summary.trim(),
    personalized_icebreaker: parsed.personalized_icebreaker.trim(),
  }
}

export function extractGeminiText(data: {
  promptFeedback?: { blockReason?: string }
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>
}): string {
  const finishReason = data.candidates?.[0]?.finishReason
  if (data.promptFeedback?.blockReason || finishReason === 'SAFETY') {
    throw new Error(`gemini_safety_block:${data.promptFeedback?.blockReason ?? finishReason}`)
  }
  if (!data.candidates?.length) throw new Error('gemini_response_missing_candidates')
  const text = data.candidates[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error(`gemini_response_missing_text:${finishReason ?? 'unknown'}`)
  return text
}

export async function scoreLeadWithGemini(firmographics: Firmographics): Promise<GeminiScore> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in the environment.')
  const model = process.env.GEMINI_MODEL?.trim()
  if (!model) throw new Error('GEMINI_MODEL is not set in the environment.')
  const base = (process.env.GEMINI_ENDPOINT?.trim() || DEFAULT_GEMINI_BASE).replace(/\/$/, '')
  const body = JSON.stringify({
    contents: [{ parts: [{ text: buildScoringPrompt(firmographics) }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 768,
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        required: ['icp_score', 'fit', 'buying_intent', 'qualification_reason', 'company_summary', 'personalized_icebreaker'],
        properties: {
          icp_score: { type: 'integer', minimum: 0, maximum: 100 },
          fit: { type: 'string', enum: ['high', 'medium', 'low'] },
          buying_intent: { type: 'string', enum: ['unknown'] },
          qualification_reason: { type: 'string' },
          company_summary: { type: 'string' },
          personalized_icebreaker: { type: 'string' },
        },
      },
    },
  })

  let response: Response | undefined
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await fetch(`${base}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body,
      signal: AbortSignal.timeout(30_000),
    })
    if (response.ok || (response.status !== 429 && response.status < 500)) break
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1_000))
  }
  if (!response?.ok) throw new Error(`Gemini API error ${response?.status ?? 'network_failure'}`)

  const data = await response.json() as {
    promptFeedback?: { blockReason?: string }
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>
  }
  return parseGeminiResponse(extractGeminiText(data))
}
