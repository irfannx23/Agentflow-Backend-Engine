export const PRE_CRM_CAPABILITIES = [
  'lead-ingestion',
  'lead-verification',
  'lead-enrichment',
  'lead-qualification',
  'lead-scoring',
  'ai-qualification',
  'lead-routing',
  'deduplication',
  'jurisdiction',
  'anti-abuse',
  'email-verification',
  'reply-detection',
  'outreach-preparation',
  'nurture-preparation',
  'crm-preparation',
] as const

export type PreCrmCapability = (typeof PRE_CRM_CAPABILITIES)[number]
export type PreCrmDecision = 'passed' | 'blocked' | 'skipped' | 'pending' | 'completed'

export type PreCrmCapabilityResult = {
  capability: PreCrmCapability
  decision: PreCrmDecision
  reason: string
  source: string
  evidenceIds: readonly string[]
}

export type PreCrmExecutionAudit = {
  leadId: number | null
  eventId: string
  evaluatedAt: string
  results: readonly PreCrmCapabilityResult[]
  blockingCapability: PreCrmCapability | null
  readyForQualification: boolean
  readyForCrm: boolean
  readyForOutreach: boolean
}

const REQUIRED_BEFORE_QUALIFICATION = [
  'lead-ingestion',
  'deduplication',
  'anti-abuse',
  'email-verification',
  'jurisdiction',
] as const satisfies readonly PreCrmCapability[]

function passed(results: ReadonlyMap<PreCrmCapability, PreCrmCapabilityResult>, capability: PreCrmCapability): boolean {
  const result = results.get(capability)
  return result?.decision === 'passed' || result?.decision === 'completed'
}

export function compilePreCrmExecutionAudit(input: {
  leadId: number | null
  eventId: string
  evaluatedAt: string
  results: readonly PreCrmCapabilityResult[]
  crmReady: boolean
  outboundReady: boolean
}): PreCrmExecutionAudit {
  if (!input.eventId.trim()) throw new Error('pre_crm_event_id_required')
  if (!Number.isFinite(Date.parse(input.evaluatedAt))) throw new Error('pre_crm_evaluated_at_invalid')

  const byCapability = new Map<PreCrmCapability, PreCrmCapabilityResult>()
  for (const result of input.results) {
    if (byCapability.has(result.capability)) throw new Error(`duplicate_pre_crm_capability:${result.capability}`)
    if (!result.reason.trim() || !result.source.trim()) throw new Error(`incomplete_pre_crm_capability:${result.capability}`)
    byCapability.set(result.capability, result)
  }

  const blockingCapability = input.results.find((result) => result.decision === 'blocked')?.capability ?? null
  const readyForQualification = !blockingCapability
    && REQUIRED_BEFORE_QUALIFICATION.every((capability) => passed(byCapability, capability))

  return {
    leadId: input.leadId,
    eventId: input.eventId,
    evaluatedAt: input.evaluatedAt,
    results: [...input.results],
    blockingCapability,
    readyForQualification,
    readyForCrm: readyForQualification && input.crmReady,
    readyForOutreach: readyForQualification && input.outboundReady,
  }
}

export const PRE_CRM_CAPABILITY_SOURCES = {
  'lead-ingestion': ['n8n-ingestion-sanitize.js', 'get_or_create_lead'],
  'lead-verification': ['n8n-verify-parse.js', 'mark_lead_unverified'],
  'lead-enrichment': ['n8n-enrich-parse.js', 'update_lead_score'],
  'lead-qualification': ['evaluate_lead_qualification', 'qualification_evaluations'],
  'lead-scoring': ['n8n-gemini-score.js', 'n8n-gemini-parse.js'],
  'ai-qualification': ['n8n-gemini-score.js', 'n8n-gemini-parse.js', 'evaluate_lead_qualification'],
  'lead-routing': ['route_lead_to_sales', 'sales_assignments'],
  deduplication: ['get_or_create_lead', 'staged_leads_email_lower_unique'],
  jurisdiction: ['n8n-jurisdiction-check.js', 'mark_lead_blocked'],
  'anti-abuse': ['n8n-anti-abuse.js', 'record_abuse'],
  'email-verification': ['n8n-verify-parse.js', 'mx-check.ts'],
  'reply-detection': ['get_replied_outreach', 'n8n-reply-split.js'],
  'outreach-preparation': ['n8n-outreach-prompt.js', 'n8n-outreach-parse.js'],
  'nurture-preparation': ['n8n-nurture-prompt.js', 'n8n-nurture-parse.js'],
  'crm-preparation': ['route_lead_to_sales', 'update_sales_assignment_sync'],
} as const satisfies Record<PreCrmCapability, readonly string[]>
