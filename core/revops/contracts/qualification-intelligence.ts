import {
  QUALIFICATION_RULE_VERSION,
  type MqlStatus,
  type PqlStatus,
  type PriorityTier,
  type QualificationEvaluationResult,
  type SqlStatus,
} from './qualification-contract.js'

type JsonRecord = Readonly<Record<string, unknown>>

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type QualificationEvidence = QualificationEvaluationResult & {
  evaluation_type?: string
  source_runtime?: string
  rule_version?: string
  lead_status?: string
  evaluation_reasons?: JsonRecord | readonly unknown[]
  engagement_summary?: JsonRecord
  product_summary?: JsonRecord
  acquisition_summary?: JsonRecord
}

export type QualificationConfidence = {
  score: number | null
  source: 'evaluation_reasons' | 'not_provided'
}

export type QualificationIntelligence = {
  evaluationId: string
  leadId: number | null
  accountId: string | null
  icpEvaluation: { score: number | null; source: 'fit_score' }
  firmographicScore: number | null
  behavioralScore: number | null
  leadQualityScore: number
  intentSignals: readonly string[]
  confidence: QualificationConfidence
  mql: { status: MqlStatus; determinedBy: 'evaluate_lead_qualification' }
  sql: { status: SqlStatus; determinedBy: 'evaluate_lead_qualification' }
  pql: { status: PqlStatus; determinedBy: 'evaluate_lead_qualification' }
  routingRecommendation: {
    crmReady: boolean
    outboundReady: boolean
    priorityTier: PriorityTier
    priorityScore: number
  }
  explanations: readonly string[]
  audit: {
    evaluationType: string | null
    sourceRuntime: string | null
    ruleVersion: string
    evaluatedAt: string
  }
}

function finiteScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

function firstScore(records: readonly (JsonRecord | undefined)[], keys: readonly string[]): number | null {
  for (const record of records) {
    if (!record) continue
    for (const key of keys) {
      const score = finiteScore(record[key])
      if (score !== null) return score
    }
  }
  return null
}

function stringsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

export function buildQualificationIntelligence(evidence: QualificationEvidence): QualificationIntelligence {
  const evaluationReasonRecord = isJsonRecord(evidence.evaluation_reasons) ? evidence.evaluation_reasons : undefined
  const confidenceScore = firstScore([evaluationReasonRecord], ['confidence', 'confidence_score'])
  const behavioralScore = firstScore(
    [evidence.engagement_summary, evidence.product_summary],
    ['behavioral_score', 'engagement_score', 'product_score', 'score'],
  )
  const intentSignals = new Set<string>()
  if (evidence.buying_intent) intentSignals.add(`buying_intent:${evidence.buying_intent}`)
  for (const summary of [evidence.engagement_summary, evidence.product_summary, evidence.acquisition_summary]) {
    if (!summary) continue
    for (const key of ['signals', 'intent_signals', 'reasons']) {
      for (const signal of stringsFrom(summary[key])) intentSignals.add(signal)
    }
  }

  const explanations = [evidence.explanation]
  if (Array.isArray(evidence.evaluation_reasons)) {
    explanations.push(...stringsFrom(evidence.evaluation_reasons))
  } else if (evaluationReasonRecord) {
    explanations.push(...stringsFrom(evaluationReasonRecord.reasons))
  }

  return {
    evaluationId: evidence.evaluation_id,
    leadId: evidence.lead_id,
    accountId: evidence.account_id,
    icpEvaluation: { score: evidence.fit_score, source: 'fit_score' },
    firmographicScore: evidence.fit_score,
    behavioralScore,
    leadQualityScore: evidence.priority_score,
    intentSignals: [...intentSignals],
    confidence: { score: confidenceScore, source: confidenceScore === null ? 'not_provided' : 'evaluation_reasons' },
    mql: { status: evidence.mql_status, determinedBy: 'evaluate_lead_qualification' },
    sql: { status: evidence.sql_status, determinedBy: 'evaluate_lead_qualification' },
    pql: { status: evidence.pql_status, determinedBy: 'evaluate_lead_qualification' },
    routingRecommendation: {
      crmReady: evidence.crm_ready,
      outboundReady: evidence.outbound_ready,
      priorityTier: evidence.priority_tier,
      priorityScore: evidence.priority_score,
    },
    explanations: [...new Set(explanations.filter((value) => value.trim().length > 0))],
    audit: {
      evaluationType: evidence.evaluation_type ?? null,
      sourceRuntime: evidence.source_runtime ?? null,
      ruleVersion: evidence.rule_version ?? QUALIFICATION_RULE_VERSION,
      evaluatedAt: evidence.evaluated_at,
    },
  }
}
