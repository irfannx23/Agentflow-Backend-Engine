import type { N8nNode, ValidationIssue } from '../core/types.js'

const SECRET_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'EMAIL_VERIFY_API_KEY',
  'ENRICH_API_KEY',
  'GEMINI_API_KEY',
  'HUBSPOT_ACCESS_TOKEN',
  'SLACK_WEBHOOK_URL',
  'BREVO_API_KEY',
  'LITELLM_MASTER_KEY',
  'DEEPSEEK_API_KEY',
]

function serialized(node: N8nNode): string {
  return JSON.stringify(node.parameters ?? {})
}

export function validateNodeParameters(
  node: N8nNode,
  path: string,
  requireRuntimePolicies: boolean,
): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const content = serialized(node)

  if (/\b(?:TODO|CHANGEME|YOUR_API_KEY|REPLACE_ME)\b/i.test(content)) {
    errors.push({ code: 'unresolved_parameter_placeholder', message: `${node.name} contains an unresolved placeholder.`, path: `${path}.parameters` })
  }
  if (/(?:sk-[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{20,}\.)/.test(content)) {
    errors.push({ code: 'possible_hardcoded_secret', message: `${node.name} may contain a hardcoded secret.`, path: `${path}.parameters` })
  }

  if (node.type !== 'n8n-nodes-base.httpRequest') return { errors, warnings }

  for (const secretName of SECRET_NAMES) {
    if (content.includes(secretName) && !content.includes(`$env.${secretName}`)) {
      errors.push({ code: 'invalid_secret_reference', message: `${node.name} must reference ${secretName} through $env.`, path: `${path}.parameters` })
    }
  }

  const method = node.parameters?.method ?? node.parameters?.requestMethod
  if (typeof method !== 'string' || !method.trim()) {
    warnings.push({ code: 'implicit_http_method', message: `${node.name} relies on the n8n default HTTP method.`, path: `${path}.parameters` })
  }
  for (const field of ['headerParametersJson', 'bodyParametersJson', 'jsonBody']) {
    const value = node.parameters?.[field]
    if (value !== undefined && (typeof value !== 'string' || !value.startsWith('={{'))) {
      errors.push({ code: 'invalid_parameter_expression', message: `${node.name}.${field} must be an n8n expression.`, path: `${path}.parameters.${field}` })
    }
  }

  const options = node.parameters?.options
  const timeout = typeof options === 'object' && options !== null && !Array.isArray(options)
    ? (options as Record<string, unknown>).timeout
    : undefined
  if (requireRuntimePolicies && (typeof timeout !== 'number' || timeout <= 0)) {
    errors.push({ code: 'missing_timeout_policy', message: `${node.name} requires a positive timeout.`, path: `${path}.parameters.options.timeout` })
  }
  if (requireRuntimePolicies && typeof node.retryOnFail !== 'boolean') {
    errors.push({ code: 'missing_retry_policy', message: `${node.name} requires explicit retry behavior.`, path })
  }
  if (node.retryOnFail && (!node.maxTries || node.maxTries < 2 || !node.waitBetweenTries)) {
    errors.push({ code: 'invalid_retry_policy', message: `${node.name} retry configuration is incomplete.`, path })
  }

  return { errors, warnings }
}
