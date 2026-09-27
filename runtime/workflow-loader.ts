import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { N8nWorkflow, WorkflowDefinition } from '../core/types.js'
import { ENGINE_ROOT } from './paths.js'
import { standardizeWorkflow } from './workflow-standardizer.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseWorkflowJson(source: string): N8nWorkflow {
  const parsed: unknown = JSON.parse(source)
  if (!isRecord(parsed)) throw new Error('workflow_root_must_be_object')
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) throw new Error('workflow_name_required')
  if (!Array.isArray(parsed.nodes)) throw new Error('workflow_nodes_must_be_array')
  if (!isRecord(parsed.connections)) throw new Error('workflow_connections_must_be_object')
  return parsed as N8nWorkflow
}

export async function loadWorkflow(definition: WorkflowDefinition): Promise<N8nWorkflow> {
  const absolutePath = resolve(ENGINE_ROOT, definition.workflowPath)
  if (!absolutePath.startsWith(ENGINE_ROOT)) throw new Error(`workflow_path_outside_engine:${definition.id}`)
  return parseWorkflowJson(await readFile(absolutePath, 'utf8'))
}

export async function loadPortableWorkflow(definition: WorkflowDefinition): Promise<N8nWorkflow> {
  return standardizeWorkflow(await loadWorkflow(definition), definition)
}

export function extractEnvironmentReferences(workflow: N8nWorkflow): string[] {
  const references = new Set<string>()
  const serialized = JSON.stringify(workflow)
  for (const match of serialized.matchAll(/\$env\.([A-Z][A-Z0-9_]*)/g)) {
    if (match[1]) references.add(match[1])
  }
  return [...references].sort()
}
