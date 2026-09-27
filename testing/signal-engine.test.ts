import assert from 'node:assert/strict'
import test from 'node:test'

import { REVOPS_SIGNAL_DEFINITIONS, type AgentFlowProductEvent } from '../core/product-signals.js'
import { evaluateProductSignals } from '../runtime/signal-engine.js'

function event(
  id: string,
  name: AgentFlowProductEvent['name'],
  day: number,
  properties: Record<string, unknown> = {},
): AgentFlowProductEvent {
  return {
    id,
    name,
    occurredAt: `2026-09-${String(day).padStart(2, '0')}T10:00:00.000Z`,
    workspaceId: 'workspace-1',
    userId: 'user-1',
    projectId: 'project-1',
    properties,
  }
}

test('signal definitions include all required RevOps metadata', () => {
  const categories = new Set<string>(REVOPS_SIGNAL_DEFINITIONS.map((definition) => definition.category))
  for (const category of ['activation', 'adoption', 'expansion', 'retention', 'revenue', 'risk', 'power-user', 'customer-success', 'operational']) {
    assert.ok(categories.has(category), category)
  }
  for (const definition of REVOPS_SIGNAL_DEFINITIONS) {
    assert.ok(definition.description)
    assert.ok(definition.triggerCondition)
    assert.ok(definition.businessValue)
    assert.ok(definition.recommendedAutomation)
    assert.ok(definition.priority)
  }
})

test('real product events produce direct and aggregate signals', () => {
  const events: AgentFlowProductEvent[] = [
    event('e1', 'project_created', 1),
    event('e2', 'workflow_generated', 2, { isFirst: true, nodeCount: 60 }),
    event('e3', 'connection_added', 3, { connectedIntegrationCount: 3 }),
    event('e4', 'workflow_repaired', 4),
    event('e5', 'workflow_repaired', 5),
    event('e6', 'workflow_repaired', 6),
    event('e7', 'workflow_downloaded', 7),
    event('e8', 'workflow_imported', 8),
    event('e9', 'conversation_continued', 9),
    event('e10', 'workflow_published', 10),
    event('e11', 'workflow_downloaded', 11),
    event('e12', 'conversation_continued', 12),
  ]
  const ids = new Set(evaluateProductSignals(events).map((signal) => signal.definitionId))
  assert.ok(ids.has('activation.first-workflow-generated'))
  assert.ok(ids.has('expansion.large-workflow-generated'))
  assert.ok(ids.has('expansion.multiple-integrations-connected'))
  assert.ok(ids.has('risk.repeated-repair'))
  assert.ok(ids.has('power-user.activity'))
})

test('connection removal becomes a risk signal only when an active workflow is affected', () => {
  const safe = evaluateProductSignals([event('safe', 'connection_removed', 1, { affectsActiveWorkflow: false })])
  const risky = evaluateProductSignals([event('risk', 'connection_removed', 1, { affectsActiveWorkflow: true })])
  assert.equal(safe.some((signal) => signal.definitionId === 'risk.connection-removed'), false)
  assert.equal(risky.some((signal) => signal.definitionId === 'risk.connection-removed'), true)
})
