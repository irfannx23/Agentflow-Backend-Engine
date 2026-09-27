import type { N8nWorkflow, ValidationIssue, ValidationResult } from '../core/types.js'
import { validateNodeParameters } from './node-parameter-validator.js'

function issue(code: string, message: string, path?: string): ValidationIssue {
  return path ? { code, message, path } : { code, message }
}

export type N8nValidationOptions = {
  requireRuntimePolicies?: boolean
}

export function validateN8nWorkflow(
  workflow: N8nWorkflow,
  options: N8nValidationOptions = {},
): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const nodeNames = new Set<string>()
  const nodeIds = new Set<string>()

  if (!workflow.nodes.length) errors.push(issue('empty_workflow', 'Workflow must contain at least one node.', 'nodes'))

  workflow.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`
    if (!node.name?.trim()) errors.push(issue('missing_node_name', 'Node name is required.', `${path}.name`))
    if (nodeNames.has(node.name)) errors.push(issue('duplicate_node_name', `Duplicate node name: ${node.name}`, `${path}.name`))
    nodeNames.add(node.name)

    if (node.id) {
      if (nodeIds.has(node.id)) errors.push(issue('duplicate_node_id', `Duplicate node ID: ${node.id}`, `${path}.id`))
      nodeIds.add(node.id)
    }

    if (!node.type?.trim()) errors.push(issue('missing_node_type', `Node ${node.name} has no type.`, `${path}.type`))
    if (!node.position || node.position.length !== 2) warnings.push(issue('missing_node_position', `Node ${node.name} has no valid position.`, `${path}.position`))

    if (node.type === 'n8n-nodes-base.httpRequest') {
      const url = node.parameters?.url
      if (typeof url !== 'string' || !url.trim()) errors.push(issue('empty_http_url', `HTTP node ${node.name} requires a URL.`, `${path}.parameters.url`))
    }

    const parameterValidation = validateNodeParameters(node, path, options.requireRuntimePolicies ?? false)
    errors.push(...parameterValidation.errors)
    warnings.push(...parameterValidation.warnings)
  })

  for (const [source, connectionGroups] of Object.entries(workflow.connections)) {
    if (!nodeNames.has(source)) errors.push(issue('unknown_connection_source', `Connection source does not exist: ${source}`, `connections.${source}`))
    for (const lanes of Object.values(connectionGroups)) {
      for (const lane of lanes) {
        for (const target of lane) {
          if (!nodeNames.has(target.node)) {
            errors.push(issue('unknown_connection_target', `Connection target does not exist: ${target.node}`, `connections.${source}`))
          }
        }
      }
    }
  }

  for (const nodeName of nodeNames) {
    const connected = Object.hasOwn(workflow.connections, nodeName)
      || Object.values(workflow.connections).some((groups) => Object.values(groups)
        .some((lanes) => lanes.some((lane) => lane.some((target) => target.node === nodeName))))
    if (!connected && workflow.nodes.length > 1) {
      warnings.push(issue('disconnected_node', `Node is not connected: ${nodeName}`, 'connections'))
    }
  }

  const triggerCount = workflow.nodes.filter((node) => /trigger|webhook/i.test(node.type)).length
  if (triggerCount === 0) warnings.push(issue('missing_trigger', 'Workflow does not expose a recognized trigger node.'))
  if (workflow.settings?.executionOrder !== 'v1') warnings.push(issue('execution_order', 'Workflow should use n8n execution order v1.', 'settings.executionOrder'))

  return { valid: errors.length === 0, errors, warnings }
}
