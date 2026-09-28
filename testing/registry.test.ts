import assert from 'node:assert/strict'
import test from 'node:test'

import { actionRegistry, integrationRegistry, triggerRegistry, workflowRegistry } from '../registry/index.js'
import { validateRegistries } from '../validators/registry-validator.js'

test('all capability registries contain unique typed entries', () => {
  assert.equal(workflowRegistry.list().length, 3)
  assert.equal(triggerRegistry.list().length, 10)
  assert.equal(actionRegistry.list().length, 11)
  assert.equal(integrationRegistry.list().length, 10)
})

test('workflow and capability registry references are valid', async () => {
  const result = await validateRegistries()
  assert.deepEqual(result.errors, [])
  assert.equal(result.valid, true)
})

test('every workflow exposes the complete registry contract', () => {
  for (const workflow of workflowRegistry.list()) {
    assert.match(workflow.id, /^[a-z0-9.-]+$/)
    assert.match(workflow.version, /^\d+\.\d+\.\d+$/)
    assert.ok(workflow.triggerTypes.length > 0)
    assert.ok(workflow.supportedIntegrations.length > 0)
    assert.ok(workflow.requiredEnvironmentVariables.length > 0)
    assert.ok(workflow.inputSchema.length > 0)
    assert.ok(workflow.outputSchema.length > 0)
    assert.ok(workflow.validation.length > 0)
    assert.ok(['healthy', 'degraded', 'unvalidated'].includes(workflow.health.status))
    assert.notEqual(workflow.health.status, 'healthy')
    assert.ok(workflow.runtimePolicy.timeoutMs > 0)
    assert.equal(workflow.repairCompatibility.preservesRpcContracts, true)
    assert.equal(workflow.owner, 'agentflow-backend-engine')
    assert.deepEqual(workflow.supportedPlatforms, ['n8n'])
    assert.match(workflow.n8nVersion, /2\.34\.5/)
    assert.ok(workflow.documentation.endsWith('.md'))
    assert.ok(workflow.workflowPath.endsWith('.workflow.json'))
  }
})
