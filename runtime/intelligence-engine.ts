import type { AgentFlowProductEvent, DetectedSignal } from '../core/product-signals.js'
import type { PersistedRevOpsSignal } from '../core/revops/contracts/database-signals.js'
import { buildCustomerIntelligence, type CustomerIntelligence } from '../core/revops/contracts/customer-intelligence.js'
import {
  evaluateLifecycle,
  type LifecycleEvaluation,
  type RenewalReadiness,
} from '../core/revops/contracts/lifecycle-model.js'
import {
  buildQualificationIntelligence,
  type QualificationEvidence,
  type QualificationIntelligence,
} from '../core/revops/contracts/qualification-intelligence.js'
import type { CustomerHealthEvaluationResult } from '../core/revops/contracts/retention-contract.js'
import { evaluateProductSignals, normalizePersistedRevOpsSignals } from './signal-engine.js'

export type IntelligenceEngineInput = {
  qualification?: QualificationEvidence
  health?: CustomerHealthEvaluationResult
  persistedSignals?: readonly PersistedRevOpsSignal[]
  productEvents?: readonly AgentFlowProductEvent[]
  planStatus?: string | null
  renewalReadiness?: RenewalReadiness
  retained?: boolean
  advocate?: boolean
}

export type IntelligenceEngineResult = {
  qualification: QualificationIntelligence | null
  lifecycle: LifecycleEvaluation
  customer: CustomerIntelligence
  signals: {
    runtime: readonly DetectedSignal[]
    database: readonly DetectedSignal[]
  }
}

export function evaluateBackendIntelligence(input: IntelligenceEngineInput): IntelligenceEngineResult {
  const persistedSignals = input.persistedSignals ?? []
  const runtimeSignals = evaluateProductSignals(input.productEvents ?? [])
  const databaseSignals = normalizePersistedRevOpsSignals(
    persistedSignals.filter((signal) => signal.status !== 'dismissed'),
  )
  const qualification = input.qualification ? buildQualificationIntelligence(input.qualification) : null
  const lifecycle = evaluateLifecycle({
    leadId: input.qualification?.lead_id,
    accountId: input.health?.account_id ?? input.qualification?.account_id,
    leadStatus: input.qualification?.lead_status,
    mqlStatus: input.qualification?.mql_status,
    sqlStatus: input.qualification?.sql_status,
    pqlStatus: input.qualification?.pql_status,
    planStatus: input.planStatus,
    lifecycleState: input.health?.lifecycle_state,
    healthState: input.health?.health_state,
    churnRisk: input.health?.churn_risk,
    expansionState: input.health?.expansion_state,
    authoritativeChurned: input.health?.authoritative_churned,
    renewalReadiness: input.renewalReadiness,
    retained: input.retained,
    advocate: input.advocate,
    healthScore: input.health?.health_score,
    priorityScore: input.qualification?.priority_score,
  })

  return {
    qualification,
    lifecycle,
    customer: buildCustomerIntelligence({
      health: input.health,
      persistedSignals,
      runtimeSignals,
      planStatus: input.planStatus,
      renewalReadiness: input.renewalReadiness,
    }),
    signals: { runtime: runtimeSignals, database: databaseSignals },
  }
}
