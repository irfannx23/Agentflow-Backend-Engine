import assert from 'node:assert/strict'
import test from 'node:test'

import { workflowRegistry } from '../registry/index.js'
import { extractEnvironmentReferences, loadWorkflow } from '../runtime/workflow-loader.js'
import { validateN8nWorkflow } from '../validators/n8n-workflow-validator.js'

test('all registered workflow JSON parses and passes structural validation', async () => {
  for (const definition of workflowRegistry.list()) {
    const workflow = await loadWorkflow(definition)
    const result = validateN8nWorkflow(workflow)
    assert.deepEqual(result.errors, [], definition.id)
    assert.equal(result.valid, true, definition.id)
  }
})

test('every connection references a registered node', async () => {
  for (const definition of workflowRegistry.list()) {
    const workflow = await loadWorkflow(definition)
    const names = new Set(workflow.nodes.map((node) => node.name))
    for (const [source, groups] of Object.entries(workflow.connections)) {
      assert.ok(names.has(source), `${definition.id}:${source}`)
      for (const lanes of Object.values(groups)) {
        for (const lane of lanes) {
          for (const target of lane) assert.ok(names.has(target.node), `${definition.id}:${target.node}`)
        }
      }
    }
  }
})

test('workflow environment references are declared by registry metadata', async () => {
  for (const definition of workflowRegistry.list()) {
    const workflow = await loadWorkflow(definition)
    const declared = new Set<string>(definition.requiredEnvironmentVariables)
    for (const reference of extractEnvironmentReferences(workflow)) {
      assert.ok(declared.has(reference), `${definition.id}:${reference}`)
    }
  }
})
