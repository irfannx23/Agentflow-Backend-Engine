import { buildHttpRequestNode, type HttpNodeOptions } from '../builders/n8n-node-builders.js'
import type { N8nNode } from '../core/types.js'
import { INTEGRATION_DEFINITIONS } from './catalog.js'

export type IntegrationNodeRequest = Omit<HttpNodeOptions, 'credentialAdapterId' | 'runtimePolicy'> & {
  operation: string
}

const integrations = new Map<string, (typeof INTEGRATION_DEFINITIONS)[number]>(
  INTEGRATION_DEFINITIONS.map((definition) => [definition.id, definition]),
)

function environmentReferences(value: string): string[] {
  return [...value.matchAll(/\$env\.([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]!)
}

/**
 * Generates portable n8n HTTP parameters using the registered credential and
 * runtime policy. The caller supplies the existing provider operation and URL;
 * this function never invents an endpoint or embeds a credential value.
 */
export function generateIntegrationHttpNode(request: IntegrationNodeRequest): N8nNode {
  const integration = integrations.get(request.integrationId)
  if (!integration) throw new Error(`unknown_integration:${request.integrationId}`)
  if (!request.operation.trim()) throw new Error('integration_operation_required')

  const declared = new Set<string>(integration.environmentVariables)
  const expressions = [request.url, request.bodyExpression ?? '']
  for (const reference of expressions.flatMap(environmentReferences)) {
    if (!declared.has(reference)) throw new Error(`undeclared_integration_environment:${integration.id}:${reference}`)
  }

  return buildHttpRequestNode({
    ...request,
    credentialAdapterId: integration.credentialAdapterId,
    runtimePolicy: integration.defaultRuntimePolicy,
  })
}
