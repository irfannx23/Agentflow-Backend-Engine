import type { MqlStatus, PqlStatus, SqlStatus } from './qualification-contract.js'
import type {
  CustomerChurnRisk,
  CustomerExpansionState,
  CustomerHealthState,
  CustomerLifecycleState,
} from './retention-contract.js'

export const BUSINESS_LIFECYCLE_STAGES = [
  'lead',
  'qualified',
  'mql',
  'sql',
  'customer',
  'activated',
  'adopting',
  'healthy',
  'expansion_candidate',
  'renewal',
  'retained',
  'advocate',
  'risk',
  'churned',
] as const

export type BusinessLifecycleStage = (typeof BUSINESS_LIFECYCLE_STAGES)[number]
export type RenewalReadiness = 'ready' | 'attention' | 'not_evaluated'

export type LifecycleEvidence = {
  leadId?: number | null
  accountId?: string | null
  leadStatus?: string | null
  mqlStatus?: MqlStatus | null
  sqlStatus?: SqlStatus | null
  pqlStatus?: PqlStatus | null
  planStatus?: string | null
  lifecycleState?: CustomerLifecycleState | null
  healthState?: CustomerHealthState | null
  churnRisk?: CustomerChurnRisk | null
  expansionState?: CustomerExpansionState | null
  authoritativeChurned?: boolean
  renewalReadiness?: RenewalReadiness
  retained?: boolean
  advocate?: boolean
  healthScore?: number | null
  priorityScore?: number | null
}

export type LifecycleEvaluation = {
  stage: BusinessLifecycleStage
  explanation: string
  evidence: readonly string[]
  scores: { health: number | null; qualificationPriority: number | null }
}

const FORWARD_TRANSITIONS: Record<BusinessLifecycleStage, readonly BusinessLifecycleStage[]> = {
  lead: ['qualified', 'mql', 'sql', 'risk'],
  qualified: ['mql', 'sql', 'risk'],
  mql: ['sql', 'customer', 'risk'],
  sql: ['customer', 'risk'],
  customer: ['activated', 'adopting', 'healthy', 'risk', 'churned'],
  activated: ['adopting', 'healthy', 'expansion_candidate', 'risk', 'churned'],
  adopting: ['healthy', 'expansion_candidate', 'renewal', 'risk', 'churned'],
  healthy: ['expansion_candidate', 'renewal', 'retained', 'advocate', 'risk', 'churned'],
  expansion_candidate: ['renewal', 'retained', 'advocate', 'risk', 'churned'],
  renewal: ['retained', 'risk', 'churned'],
  retained: ['advocate', 'expansion_candidate', 'renewal', 'risk', 'churned'],
  advocate: ['expansion_candidate', 'renewal', 'retained', 'risk', 'churned'],
  risk: ['adopting', 'healthy', 'renewal', 'retained', 'churned'],
  churned: [],
}

function add(evidence: string[], condition: boolean, value: string): void {
  if (condition) evidence.push(value)
}

export function evaluateLifecycle(evidence: LifecycleEvidence): LifecycleEvaluation {
  const reasons: string[] = []
  add(reasons, evidence.leadId != null, 'lead_record_present')
  add(reasons, evidence.accountId != null, 'account_record_present')
  if (evidence.mqlStatus) reasons.push(`mql:${evidence.mqlStatus}`)
  if (evidence.sqlStatus) reasons.push(`sql:${evidence.sqlStatus}`)
  if (evidence.pqlStatus) reasons.push(`pql:${evidence.pqlStatus}`)
  if (evidence.lifecycleState) reasons.push(`lifecycle:${evidence.lifecycleState}`)
  if (evidence.healthState) reasons.push(`health:${evidence.healthState}`)
  if (evidence.churnRisk) reasons.push(`churn_risk:${evidence.churnRisk}`)
  if (evidence.expansionState) reasons.push(`expansion:${evidence.expansionState}`)
  if (evidence.renewalReadiness) reasons.push(`renewal:${evidence.renewalReadiness}`)

  let stage: BusinessLifecycleStage = 'lead'
  let explanation = 'Lead exists without a later authoritative lifecycle state.'

  if (evidence.leadStatus === 'qualified') {
    stage = 'qualified'
    explanation = 'The existing lead status is qualified.'
  }
  if (evidence.mqlStatus === 'qualified') {
    stage = 'mql'
    explanation = 'The existing qualification evaluation marked the lead as MQL.'
  }
  if (evidence.sqlStatus === 'sales_ready') {
    stage = 'sql'
    explanation = 'The existing qualification evaluation marked the lead as sales-ready.'
  }
  if (evidence.accountId || evidence.planStatus === 'active') {
    stage = 'customer'
    explanation = 'An account or active plan establishes customer state.'
  }
  if (evidence.lifecycleState === 'newly_activated' || evidence.lifecycleState === 'activated' || evidence.pqlStatus === 'product_activated') {
    stage = 'activated'
    explanation = 'Existing activation or PQL state establishes activation.'
  }
  if (evidence.lifecycleState === 'low_adoption') {
    stage = 'adopting'
    explanation = 'Existing lifecycle evaluation indicates low adoption requiring continued adoption work.'
  }
  if (evidence.healthState === 'healthy') {
    stage = 'healthy'
    explanation = 'The existing customer-health evaluation is healthy.'
  }
  if (evidence.expansionState === 'expansion_candidate' || evidence.expansionState === 'upgrade_ready' || evidence.expansionState === 'sales_followup') {
    stage = 'expansion_candidate'
    explanation = `The existing expansion state is ${evidence.expansionState}.`
  }
  if (evidence.renewalReadiness === 'ready' || evidence.renewalReadiness === 'attention') {
    stage = 'renewal'
    explanation = `An authoritative renewal assessment is ${evidence.renewalReadiness}.`
  }
  if (evidence.retained) {
    stage = 'retained'
    explanation = 'An authoritative retention outcome is present.'
  }
  if (evidence.advocate) {
    stage = 'advocate'
    explanation = 'An explicit advocacy signal is present.'
  }
  if (evidence.healthState === 'at_risk' || evidence.healthState === 'critical' || evidence.churnRisk === 'high' || evidence.churnRisk === 'critical') {
    stage = 'risk'
    explanation = 'Existing health or churn evaluation indicates customer risk.'
  }
  if (evidence.authoritativeChurned || evidence.lifecycleState === 'churned') {
    stage = 'churned'
    explanation = 'The authoritative customer-health state is churned.'
  }

  return {
    stage,
    explanation,
    evidence: reasons,
    scores: {
      health: evidence.healthScore ?? null,
      qualificationPriority: evidence.priorityScore ?? null,
    },
  }
}

export function canTransitionLifecycle(from: BusinessLifecycleStage, to: BusinessLifecycleStage): boolean {
  return from === to || FORWARD_TRANSITIONS[from].includes(to)
}

export function explainLifecycleTransition(from: BusinessLifecycleStage, evaluation: LifecycleEvaluation): string {
  if (from === evaluation.stage) return `Lifecycle remains ${from}: ${evaluation.explanation}`
  if (!canTransitionLifecycle(from, evaluation.stage)) {
    return `Transition ${from} → ${evaluation.stage} requires explicit review: ${evaluation.explanation}`
  }
  return `Lifecycle advanced ${from} → ${evaluation.stage}: ${evaluation.explanation}`
}
