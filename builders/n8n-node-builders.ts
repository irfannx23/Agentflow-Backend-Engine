import type { N8nNode, RuntimePolicy } from '../core/types.js'
import { credentialHeaderExpression } from '../integrations/credential-adapters.js'

export function environmentExpression(name: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`invalid_environment_name:${name}`)
  return `={{ $env.${name} }}`
}

export function jsonBodyExpression(bodyExpression: string): string {
  if (!bodyExpression.trim()) throw new Error('empty_body_expression')
  return `={{ JSON.stringify(${bodyExpression}) }}`
}

function n8nErrorMode(policy: RuntimePolicy): N8nNode['onError'] {
  if (policy.errorMode === 'continue-regular-output') return 'continueRegularOutput'
  if (policy.errorMode === 'continue-error-output') return 'continueErrorOutput'
  return 'stopWorkflow'
}

export type HttpNodeOptions = {
  id?: string
  name: string
  position: [number, number]
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  integrationId: string
  credentialAdapterId: string
  runtimePolicy: RuntimePolicy
  bodyExpression?: string
  responseFormat?: 'json' | 'text'
}

export function buildHttpRequestNode(options: HttpNodeOptions): N8nNode {
  const headerParametersJson = credentialHeaderExpression(options.credentialAdapterId)
  const parameters: Record<string, unknown> = {
    method: options.method,
    url: options.url,
    options: {
      timeout: options.runtimePolicy.timeoutMs,
      response: { response: { responseFormat: options.responseFormat ?? 'json' } },
    },
  }
  if (headerParametersJson) parameters.headerParametersJson = headerParametersJson
  if (options.bodyExpression !== undefined) {
    parameters.sendBody = true
    parameters.specifyBody = 'json'
    parameters.jsonBody = jsonBodyExpression(options.bodyExpression)
  }

  return {
    ...(options.id ? { id: options.id } : {}),
    name: options.name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: options.position,
    parameters,
    retryOnFail: options.runtimePolicy.retry.enabled,
    maxTries: options.runtimePolicy.retry.maxAttempts,
    waitBetweenTries: options.runtimePolicy.retry.waitBetweenAttemptsMs,
    onError: n8nErrorMode(options.runtimePolicy),
  }
}
