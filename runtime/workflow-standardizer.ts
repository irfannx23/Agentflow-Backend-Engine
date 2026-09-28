import type { N8nNode, N8nWorkflow, RuntimePolicy, WorkflowDefinition } from '../core/types.js'

const IDEMPOTENT_RPC_NAMES = new Set([
  'claim_revops_signal_step',
  'count_events_since',
  'count_leads_by_ip_since',
  'evaluate_account_health',
  'evaluate_lead_qualification',
  'generate_revops_signals',
  'get_or_create_lead',
  'get_replied_outreach',
  'record_revops_hubspot_step',
  'record_revops_signal_outcome',
  'record_revops_slack_step',
  'route_lead_to_sales',
  'upsert_revops_signal',
])

function methodFor(node: N8nNode): string {
  const method = node.parameters?.method ?? node.parameters?.requestMethod ?? 'GET'
  return typeof method === 'string' ? method.toUpperCase() : 'GET'
}

function retrySafe(node: N8nNode): boolean {
  if (methodFor(node) === 'GET') return true
  const url = node.parameters?.url
  if (typeof url !== 'string') return false
  if (url.includes('/contacts/batch/upsert')) return true
  const rpc = /\/rpc\/([a-z0-9_]+)/i.exec(url)?.[1]
  return rpc ? IDEMPOTENT_RPC_NAMES.has(rpc) : false
}

function applyPolicy(node: N8nNode, policy: RuntimePolicy): N8nNode {
  if (node.type !== 'n8n-nodes-base.httpRequest') return structuredClone(node)
  const safe = retrySafe(node)
  const parameters = structuredClone(node.parameters ?? {})
  const currentOptions = parameters.options
  const requestOptions = typeof currentOptions === 'object' && currentOptions !== null && !Array.isArray(currentOptions)
    ? structuredClone(currentOptions as Record<string, unknown>)
    : {}
  requestOptions.timeout ??= policy.timeoutMs
  parameters.options = requestOptions
  if (parameters.method === undefined && parameters.requestMethod === undefined) parameters.method = 'GET'

  return {
    ...structuredClone(node),
    parameters,
    retryOnFail: safe && policy.retry.enabled,
    maxTries: safe && policy.retry.enabled ? policy.retry.maxAttempts : 1,
    waitBetweenTries: safe && policy.retry.enabled ? policy.retry.waitBetweenAttemptsMs : 0,
    onError: policy.errorMode === 'continue-error-output'
      ? 'continueErrorOutput'
      : policy.errorMode === 'continue-regular-output'
        ? 'continueRegularOutput'
        : 'stopWorkflow',
  }
}

export function standardizeWorkflow(
  workflow: N8nWorkflow,
  definition: WorkflowDefinition,
): N8nWorkflow {
  return {
    ...structuredClone(workflow),
    nodes: workflow.nodes.map((node) => applyPolicy(node, definition.runtimePolicy)),
    settings: { ...structuredClone(workflow.settings ?? {}), executionOrder: 'v1' },
  }
}
