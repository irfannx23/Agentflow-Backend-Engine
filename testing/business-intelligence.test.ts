import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PRE_CRM_CAPABILITIES,
  PRE_CRM_CAPABILITY_SOURCES,
  compilePreCrmExecutionAudit,
  type PreCrmCapabilityResult,
} from '../core/pre-crm/contracts/pre-crm-engine.js'
import { SIGNAL_CATALOGUE } from '../core/revops/signal-catalogue.js'
import { buildQualificationIntelligence, type QualificationEvidence } from '../core/revops/contracts/qualification-intelligence.js'
import { buildCustomerIntelligence } from '../core/revops/contracts/customer-intelligence.js'
import { canTransitionLifecycle, evaluateLifecycle } from '../core/revops/contracts/lifecycle-model.js'
import type { PersistedRevOpsSignal } from '../core/revops/contracts/database-signals.js'
import type { CustomerHealthEvaluationResult } from '../core/revops/contracts/retention-contract.js'
import { PRE_CRM_MODULES } from '../engines/pre-crm/catalog.js'
import { REVOPS_MODULES } from '../engines/revops/catalog.js'
import { generateIntegrationHttpNode } from '../integrations/parameter-generator.js'
import { evaluateBackendIntelligence } from '../runtime/intelligence-engine.js'

const qualification: QualificationEvidence = {
  evaluation_id: 'evaluation-1', lead_id: 42, profile_id: null, account_id: 'account-1',
  fit_score: 78, buying_intent: 'high', mql_status: 'qualified', sql_status: 'sales_ready',
  pql_status: 'product_activated', crm_ready: true, outbound_ready: true,
  priority_score: 91, priority_tier: 'urgent', explanation: 'Existing RPC marked the lead sales-ready.',
  evaluated_at: '2026-09-27T10:00:00.000Z', evaluation_type: 'runtime', source_runtime: 'n8n',
  engagement_summary: { behavioral_score: 64, intent_signals: ['pricing-page'] },
  evaluation_reasons: { confidence_score: 88, reasons: ['firmographic match'] },
}

const health: CustomerHealthEvaluationResult = {
  evaluation_id: 'health-1', account_id: 'account-1', health_score: 84, health_state: 'healthy',
  lifecycle_state: 'activated', churn_risk: 'low', expansion_score: 73,
  expansion_state: 'expansion_candidate', recommended_action: 'cross_sell', recommended_lead_id: 42,
  recommended_owner_type: 'ae', authoritative_churned: false, needs_intervention: false,
  evaluated_at: '2026-09-27T10:00:00.000Z',
}

function persisted(signalType: PersistedRevOpsSignal['signalType'], id = signalType): PersistedRevOpsSignal {
  return {
    id, signalKey: `key-${id}`, accountId: 'account-1', signalType, status: 'pending',
    priority: 'high', source: 'generate_revops_signals', createdAt: '2026-09-27T10:00:00.000Z',
  }
}

test('Pre-CRM contract covers every requested capability and preserves authoritative gates', () => {
  assert.deepEqual(Object.keys(PRE_CRM_CAPABILITY_SOURCES).sort(), [...PRE_CRM_CAPABILITIES].sort())
  const required = ['lead-ingestion', 'deduplication', 'anti-abuse', 'email-verification', 'jurisdiction'] as const
  const results: PreCrmCapabilityResult[] = required.map((capability) => ({
    capability, decision: 'passed', reason: 'Existing workflow stage passed.', source: PRE_CRM_CAPABILITY_SOURCES[capability][0], evidenceIds: ['event-1'],
  }))
  const audit = compilePreCrmExecutionAudit({
    leadId: 42, eventId: 'event-1', evaluatedAt: '2026-09-27T10:00:00.000Z',
    results, crmReady: true, outboundReady: false,
  })
  assert.equal(audit.readyForQualification, true)
  assert.equal(audit.readyForCrm, true)
  assert.equal(audit.readyForOutreach, false)
  assert.throws(() => compilePreCrmExecutionAudit({
    leadId: 42, eventId: 'event-1', evaluatedAt: audit.evaluatedAt,
    results: [...results, results[0]!], crmReady: true, outboundReady: true,
  }), /duplicate_pre_crm_capability/)
})

test('qualification intelligence exposes audited scores, statuses, intent, confidence, and explanations', () => {
  const result = buildQualificationIntelligence(qualification)
  assert.equal(result.icpEvaluation.score, 78)
  assert.equal(result.firmographicScore, 78)
  assert.equal(result.behavioralScore, 64)
  assert.equal(result.leadQualityScore, 91)
  assert.equal(result.confidence.score, 88)
  assert.equal(result.mql.status, 'qualified')
  assert.equal(result.sql.status, 'sales_ready')
  assert.ok(result.intentSignals.includes('pricing-page'))
  assert.ok(result.explanations.includes('firmographic match'))

  const withoutOptionalEvidence = buildQualificationIntelligence({ ...qualification, evaluation_reasons: undefined, engagement_summary: undefined })
  assert.equal(withoutOptionalEvidence.confidence.score, null)
  assert.equal(withoutOptionalEvidence.behavioralScore, null)
})

test('lifecycle evaluation supports progression while authoritative risk and churn take precedence', () => {
  assert.equal(evaluateLifecycle({ leadId: 1, mqlStatus: 'qualified' }).stage, 'mql')
  assert.equal(evaluateLifecycle({ accountId: 'a', healthState: 'healthy', expansionState: 'expansion_candidate' }).stage, 'expansion_candidate')
  assert.equal(evaluateLifecycle({ accountId: 'a', healthState: 'critical', expansionState: 'expansion_candidate' }).stage, 'risk')
  assert.equal(evaluateLifecycle({ accountId: 'a', authoritativeChurned: true }).stage, 'churned')
  assert.equal(canTransitionLifecycle('lead', 'sql'), true)
  assert.equal(canTransitionLifecycle('churned', 'healthy'), false)
})

test('customer intelligence uses real signal contracts and does not infer absent business decisions', () => {
  const signals = [persisted('SUBSCRIPTION_ACTIVATED'), persisted('EXPANSION_CANDIDATE'), persisted('UPGRADE_INTENT')]
  const result = buildCustomerIntelligence({ health, persistedSignals: signals, planStatus: 'active', renewalReadiness: 'ready' })
  assert.equal(result.activation.status, 'identified')
  assert.equal(result.expansion.status, 'identified')
  assert.equal(result.upsellOpportunity.status, 'identified')
  assert.equal(result.crossSellOpportunity.status, 'identified')
  assert.equal(result.renewalReadiness.status, 'identified')

  const absent = buildCustomerIntelligence({ persistedSignals: [] })
  assert.equal(absent.crossSellOpportunity.status, 'not_evaluated')
  assert.equal(absent.renewalReadiness.status, 'not_evaluated')
})

test('intelligence engine composes qualification, lifecycle, database, and runtime evidence', () => {
  const result = evaluateBackendIntelligence({
    qualification, health, persistedSignals: [persisted('ACCOUNT_AT_RISK')], planStatus: 'active',
    productEvents: [{ id: 'event-1', name: 'workflow_published', occurredAt: '2026-09-27T10:00:00.000Z', workspaceId: 'account-1', properties: {} }],
  })
  assert.equal(result.qualification?.routingRecommendation.crmReady, true)
  assert.equal(result.lifecycle.stage, 'expansion_candidate')
  assert.equal(result.customer.risk.status, 'attention')
  assert.ok(result.signals.runtime.some((signal) => signal.definitionId === 'revenue.workflow-published'))
  assert.ok(result.signals.database.some((signal) => signal.definitionId === 'database.account-at-risk'))
})

test('catalogues and engine modules provide unique production coverage', () => {
  assert.equal(new Set(SIGNAL_CATALOGUE.map((entry) => entry.id)).size, SIGNAL_CATALOGUE.length)
  assert.ok(SIGNAL_CATALOGUE.some((entry) => entry.source === 'runtime-event'))
  assert.ok(SIGNAL_CATALOGUE.some((entry) => entry.source === 'database-contract'))
  assert.ok(PRE_CRM_MODULES.every((module) => module.status === 'available' || module.status === 'extracted'))
  for (const id of ['customer-lifecycle', 'upsell-opportunity', 'cross-sell-opportunity', 'renewal-readiness', 'inactive-users', 'subscription-intelligence']) {
    assert.ok(REVOPS_MODULES.some((module) => module.id === id && module.status === 'available'), id)
  }
})

test('integration parameter generation applies registry adapters and rejects undeclared environment references', () => {
  const node = generateIntegrationHttpNode({
    name: 'Evaluate Qualification', operation: 'evaluate_lead_qualification', position: [0, 0], method: 'POST',
    url: "={{ $env.SUPABASE_URL + '/rest/v1/rpc/evaluate_lead_qualification' }}",
    integrationId: 'supabase', bodyExpression: '{ p_lead_id: $json.lead_id }',
  })
  assert.equal(node.retryOnFail, true)
  assert.match(String(node.parameters?.headerParametersJson), /SUPABASE_SERVICE_ROLE_KEY/)
  assert.throws(() => generateIntegrationHttpNode({
    name: 'Invalid', operation: 'invalid', position: [0, 0], method: 'GET',
    url: '={{ $env.UNRELATED_SECRET }}', integrationId: 'supabase',
  }), /undeclared_integration_environment/)
})
