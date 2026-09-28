import assert from 'node:assert/strict'
import test from 'node:test'

import { buildHttpRequestNode, environmentExpression, jsonBodyExpression } from '../builders/n8n-node-builders.js'
import { N8nWorkflowBuilder } from '../builders/n8n-workflow-builder.js'
import { DATABASE_REVOPS_SIGNAL_TYPES, type PersistedRevOpsSignal } from '../core/revops/contracts/database-signals.js'
import { CREDENTIAL_ADAPTERS, credentialHeaderExpression } from '../integrations/credential-adapters.js'
import { READ_HTTP_POLICY } from '../integrations/runtime-policies.js'
import { integrationRegistry, workflowRegistry } from '../registry/index.js'
import { loadEnvironmentConfiguration, redactConfiguration } from '../runtime/config-loader.js'
import { loadPortableWorkflow, loadWorkflow } from '../runtime/workflow-loader.js'
import { normalizePersistedRevOpsSignals } from '../runtime/signal-engine.js'
import { withExecutionTelemetry } from '../runtime/observability.js'
import { validateN8nWorkflow } from '../validators/n8n-workflow-validator.js'

test('node builders generate portable parameters without secret values', () => {
  const node = buildHttpRequestNode({
    name: 'Read Supabase', position: [0, 0], method: 'GET',
    url: "={{ $env.SUPABASE_URL + '/rest/v1/accounts' }}",
    integrationId: 'supabase', credentialAdapterId: 'supabase-service-role', runtimePolicy: READ_HTTP_POLICY,
  })
  assert.equal(node.retryOnFail, true)
  assert.equal(node.maxTries, 3)
  assert.equal((node.parameters?.options as Record<string, unknown>).timeout, 30_000)
  assert.match(String(node.parameters?.headerParametersJson), /\$env\.SUPABASE_SERVICE_ROLE_KEY/)
  assert.equal(JSON.stringify(node).includes('placeholder-for-test'), false)
  assert.equal(environmentExpression('SUPABASE_URL'), '={{ $env.SUPABASE_URL }}')
  assert.equal(jsonBodyExpression('{ ok: true }'), '={{ JSON.stringify({ ok: true }) }}')
  assert.throws(() => environmentExpression('invalid-name'), /invalid_environment_name/)
})

test('workflow builder rejects invalid topology and builds deterministic connections', () => {
  const trigger = { name: 'Trigger', type: 'n8n-nodes-base.manualTrigger', position: [0, 0] as [number, number], parameters: {} }
  const action = { name: 'Action', type: 'n8n-nodes-base.noOp', position: [200, 0] as [number, number], parameters: {} }
  const builder = new N8nWorkflowBuilder('Portable Workflow').addNode(trigger).addNode(action).connect('Trigger', 'Action')
  const workflow = builder.build()
  assert.equal(workflow.active, false)
  assert.equal(workflow.connections.Trigger?.main?.[0]?.[0]?.node, 'Action')
  assert.throws(() => builder.addNode(trigger), /duplicate_workflow_node/)
  assert.throws(() => builder.connect('Missing', 'Action'), /unknown_connection_source/)
})

test('every integration has a compatible credential adapter and runtime policy', () => {
  const adapters = new Map(CREDENTIAL_ADAPTERS.map((adapter) => [adapter.id, adapter]))
  for (const integration of integrationRegistry.list()) {
    const adapter = adapters.get(integration.credentialAdapterId)
    assert.ok(adapter, integration.id)
    assert.ok(integration.defaultRuntimePolicy.timeoutMs > 0)
    assert.ok(integration.secretEnvironmentVariables.every((name) => (integration.environmentVariables as readonly string[]).includes(name)))
  }
  assert.match(credentialHeaderExpression('hubspot-bearer') ?? '', /\$env\.HUBSPOT_ACCESS_TOKEN/)
})

test('portable workflows preserve topology and add runtime policies', async () => {
  for (const definition of workflowRegistry.list()) {
    const workflow = await loadPortableWorkflow(definition)
    const validation = validateN8nWorkflow(workflow, { requireRuntimePolicies: true })
    assert.deepEqual(validation.errors, [], definition.id)
    for (const node of workflow.nodes.filter((entry) => entry.type === 'n8n-nodes-base.httpRequest')) {
      assert.equal(typeof node.retryOnFail, 'boolean', `${definition.id}:${node.name}`)
      assert.equal(typeof (node.parameters?.options as Record<string, unknown>).timeout, 'number', `${definition.id}:${node.name}`)
    }
  }
})

test('canonical workflow JSON already contains importable runtime policies', async () => {
  for (const definition of workflowRegistry.list()) {
    const workflow = await loadWorkflow(definition)
    const validation = validateN8nWorkflow(workflow, { requireRuntimePolicies: true })
    assert.deepEqual(validation.errors, [], definition.id)
  }
})

test('configuration loader reports names only and redacts secrets', () => {
  const requirements = [
    { name: 'PUBLIC_URL', required: true, secret: false, description: 'Public endpoint.' },
    { name: 'API_KEY', required: true, secret: true, description: 'Provider credential.' },
    { name: 'OPTIONAL', required: false, secret: false, description: 'Optional setting.' },
  ] as const
  const loaded = loadEnvironmentConfiguration(requirements, { PUBLIC_URL: 'https://example.test', API_KEY: 'secret-value' })
  assert.deepEqual(loaded.missingOptional, ['OPTIONAL'])
  assert.deepEqual(redactConfiguration(loaded, requirements), { PUBLIC_URL: 'https://example.test', API_KEY: '[REDACTED]' })
  assert.throws(() => loadEnvironmentConfiguration(requirements, {}), /API_KEY,PUBLIC_URL/)
})

test('audited persisted RevOps signals normalize without duplicating business rules', () => {
  const signals = DATABASE_REVOPS_SIGNAL_TYPES.map((signalType, index): PersistedRevOpsSignal => ({
    id: `signal-${index}`, signalKey: `key-${index}`, accountId: 'account-1', signalType,
    status: 'pending', priority: 'medium', source: 'generate_revops_signals',
    createdAt: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  }))
  const normalized = normalizePersistedRevOpsSignals([...signals, signals[0]!])
  assert.equal(normalized.length, DATABASE_REVOPS_SIGNAL_TYPES.length)
  assert.ok(normalized.some((signal) => signal.definitionId === 'database.account-at-risk'))
  assert.ok(normalized.some((signal) => signal.definitionId === 'database.significant-usage-growth'))
})

test('execution telemetry records success and structured failure without payloads', async () => {
  const events: Array<{ kind: string; message: string }> = []
  const logger = {
    info: (message: string) => events.push({ kind: 'info', message }),
    error: (message: string) => events.push({ kind: 'error', message }),
  }
  const metrics = { increment() {}, observe() {} }
  assert.equal(await withExecutionTelemetry({ operation: 'validate' }, async () => 'ok', { logger, metrics, clock: () => 1 }), 'ok')
  await assert.rejects(
    withExecutionTelemetry({ operation: 'fail' }, async () => { throw new Error('provider unavailable') }, { logger, metrics, clock: () => 1 }),
    /provider unavailable/,
  )
  assert.deepEqual(events.map((entry) => entry.message), [
    'engine.operation.started', 'engine.operation.completed', 'engine.operation.started', 'engine.operation.failed',
  ])
})
