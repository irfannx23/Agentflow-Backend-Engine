import type { DetectedSignal } from '../../product-signals.js'
import type { PersistedRevOpsSignal } from './database-signals.js'
import type { CustomerHealthEvaluationResult } from './retention-contract.js'

export type IntelligenceStatus = 'identified' | 'attention' | 'healthy' | 'not_evaluated'

export type IntelligenceFinding = {
  status: IntelligenceStatus
  explanation: string
  evidenceIds: readonly string[]
}

export type CustomerIntelligence = {
  activation: IntelligenceFinding
  adoption: IntelligenceFinding
  health: IntelligenceFinding
  expansion: IntelligenceFinding
  upsellOpportunity: IntelligenceFinding
  crossSellOpportunity: IntelligenceFinding
  renewalReadiness: IntelligenceFinding
  retention: IntelligenceFinding
  revenue: IntelligenceFinding
  risk: IntelligenceFinding
  powerUser: IntelligenceFinding
  inactiveUser: IntelligenceFinding
  usage: IntelligenceFinding
  subscription: IntelligenceFinding
  customerSuccess: IntelligenceFinding
}

function persisted(signals: readonly PersistedRevOpsSignal[], types: readonly PersistedRevOpsSignal['signalType'][]): PersistedRevOpsSignal[] {
  return signals.filter((signal) => types.includes(signal.signalType))
}

function finding(status: IntelligenceStatus, explanation: string, ids: readonly string[] = []): IntelligenceFinding {
  return { status, explanation, evidenceIds: ids }
}

export function buildCustomerIntelligence(input: {
  health?: CustomerHealthEvaluationResult
  persistedSignals: readonly PersistedRevOpsSignal[]
  runtimeSignals?: readonly DetectedSignal[]
  planStatus?: string | null
  renewalReadiness?: 'ready' | 'attention' | 'not_evaluated'
}): CustomerIntelligence {
  const activeSignals = input.persistedSignals.filter((signal) => signal.status !== 'dismissed')
  const by = (...types: PersistedRevOpsSignal['signalType'][]) => persisted(activeSignals, types)
  const activation = by('SUBSCRIPTION_ACTIVATED')
  const expansion = by('EXPANSION_CANDIDATE', 'SIGNIFICANT_USAGE_GROWTH')
  const upsell = by('UPGRADE_INTENT', 'EXPANSION_CANDIDATE')
  const revenue = by('PQL_REACHED', 'UPGRADE_INTENT', 'SUBSCRIPTION_ACTIVATED')
  const risk = by('ACCOUNT_AT_RISK', 'HIGH_CHURN_RISK', 'BUDGET_PRESSURE', 'ALLOWANCE_PRESSURE')
  const inactive = by('MEANINGFUL_INACTIVITY')
  const usage = by('SIGNIFICANT_USAGE_GROWTH', 'ALLOWANCE_PRESSURE', 'MEANINGFUL_INACTIVITY')
  const powerUser = (input.runtimeSignals ?? []).filter((signal) => signal.definitionId === 'power-user.activity')
  const explicitCrossSell = input.health?.recommended_action === 'cross_sell'
  const renewal = input.renewalReadiness ?? 'not_evaluated'

  return {
    activation: activation.length
      ? finding('identified', 'Existing subscription activation signal is present.', activation.map((signal) => signal.id))
      : finding('not_evaluated', 'No persisted subscription activation signal was supplied.'),
    adoption: input.health
      ? finding(input.health.lifecycle_state === 'low_adoption' ? 'attention' : 'identified', `Existing lifecycle state is ${input.health.lifecycle_state}.`, [input.health.evaluation_id])
      : finding('not_evaluated', 'No authoritative health evaluation was supplied.'),
    health: input.health
      ? finding(input.health.health_state === 'healthy' ? 'healthy' : 'attention', `Existing health state is ${input.health.health_state} with score ${input.health.health_score}.`, [input.health.evaluation_id])
      : finding('not_evaluated', 'No authoritative health evaluation was supplied.'),
    expansion: expansion.length
      ? finding('identified', 'Existing expansion or usage-growth signal is present.', expansion.map((signal) => signal.id))
      : finding('not_evaluated', 'No persisted expansion signal was supplied.'),
    upsellOpportunity: upsell.length
      ? finding('identified', 'Existing upgrade-intent or expansion-candidate signal is present.', upsell.map((signal) => signal.id))
      : finding('not_evaluated', 'No authoritative upsell signal was supplied.'),
    crossSellOpportunity: explicitCrossSell
      ? finding('identified', 'The authoritative health evaluation recommends cross-sell.', [input.health!.evaluation_id])
      : finding('not_evaluated', 'The audited database exposes no dedicated cross-sell signal; no opportunity was inferred.'),
    renewalReadiness: renewal === 'not_evaluated'
      ? finding('not_evaluated', 'No authoritative renewal assessment was supplied.')
      : finding(renewal === 'ready' ? 'identified' : 'attention', `Authoritative renewal readiness is ${renewal}.`),
    retention: input.health
      ? finding(input.health.authoritative_churned || input.health.needs_intervention ? 'attention' : 'healthy', input.health.recommended_action, [input.health.evaluation_id])
      : finding('not_evaluated', 'No authoritative retention evaluation was supplied.'),
    revenue: revenue.length
      ? finding('identified', 'Existing PQL, upgrade, or subscription revenue signal is present.', revenue.map((signal) => signal.id))
      : finding('not_evaluated', 'No persisted revenue signal was supplied.'),
    risk: risk.length || input.health?.needs_intervention
      ? finding('attention', 'Existing risk signal or intervention requirement is present.', [...risk.map((signal) => signal.id), ...(input.health ? [input.health.evaluation_id] : [])])
      : finding(input.health ? 'healthy' : 'not_evaluated', input.health ? 'No supplied risk signal requires intervention.' : 'Risk was not evaluated.'),
    powerUser: powerUser.length
      ? finding('identified', 'Existing runtime product activity produced a power-user signal.', powerUser.flatMap((signal) => signal.sourceEventIds))
      : finding('not_evaluated', 'No power-user runtime signal was supplied.'),
    inactiveUser: inactive.length
      ? finding('attention', 'Existing meaningful-inactivity signal is present.', inactive.map((signal) => signal.id))
      : finding('not_evaluated', 'No persisted inactivity signal was supplied.'),
    usage: usage.length
      ? finding(usage.some((signal) => signal.signalType === 'MEANINGFUL_INACTIVITY' || signal.signalType === 'ALLOWANCE_PRESSURE') ? 'attention' : 'identified', 'Existing usage-intelligence signal is present.', usage.map((signal) => signal.id))
      : finding('not_evaluated', 'No persisted usage-intelligence signal was supplied.'),
    subscription: input.planStatus
      ? finding(input.planStatus === 'active' ? 'healthy' : 'attention', `Existing account plan status is ${input.planStatus}.`)
      : finding('not_evaluated', 'No account plan status was supplied.'),
    customerSuccess: input.health?.needs_intervention || risk.length
      ? finding('attention', input.health?.recommended_action ?? 'Existing risk signals require customer-success review.', [...risk.map((signal) => signal.id), ...(input.health ? [input.health.evaluation_id] : [])])
      : finding(input.health ? 'healthy' : 'not_evaluated', input.health ? 'No intervention is required by the supplied evaluation.' : 'Customer-success intelligence was not evaluated.'),
  }
}
