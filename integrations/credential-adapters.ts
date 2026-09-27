export type CredentialHeader = {
  name: string
  valueExpression: string
}

export type CredentialAdapter = {
  id: string
  integrationId: string
  secretEnvironmentVariables: readonly string[]
  headers: readonly CredentialHeader[]
  validateEnvironment(environment: NodeJS.ProcessEnv): string[]
}

function environmentAdapter(
  id: string,
  integrationId: string,
  secretEnvironmentVariables: readonly string[],
  headers: readonly CredentialHeader[],
): CredentialAdapter {
  return {
    id,
    integrationId,
    secretEnvironmentVariables,
    headers,
    validateEnvironment(environment) {
      return secretEnvironmentVariables.filter((name) => !environment[name]?.trim())
    },
  }
}

export const CREDENTIAL_ADAPTERS = [
  environmentAdapter('none', 'mx', [], []),
  environmentAdapter('hookdeck-signature', 'hookdeck', ['HOOKDECK_SIGNING_SECRET'], []),
  environmentAdapter('supabase-service-role', 'supabase', ['SUPABASE_SERVICE_ROLE_KEY'], [
    { name: 'apikey', valueExpression: '$env.SUPABASE_SERVICE_ROLE_KEY' },
    { name: 'Authorization', valueExpression: "'Bearer ' + $env.SUPABASE_SERVICE_ROLE_KEY" },
  ]),
  environmentAdapter('emailable-api-key', 'emailable', ['EMAIL_VERIFY_API_KEY'], []),
  environmentAdapter('apollo-api-key', 'apollo', ['ENRICH_API_KEY'], [
    { name: 'X-Api-Key', valueExpression: '$env.ENRICH_API_KEY' },
  ]),
  environmentAdapter('gemini-api-key', 'gemini', ['GEMINI_API_KEY'], []),
  environmentAdapter('hubspot-bearer', 'hubspot', ['HUBSPOT_ACCESS_TOKEN'], [
    { name: 'Authorization', valueExpression: "'Bearer ' + $env.HUBSPOT_ACCESS_TOKEN" },
  ]),
  environmentAdapter('slack-webhook', 'slack', ['SLACK_WEBHOOK_URL'], []),
  environmentAdapter('brevo-api-key', 'brevo', ['BREVO_API_KEY'], [
    { name: 'api-key', valueExpression: '$env.BREVO_API_KEY' },
  ]),
  environmentAdapter('litellm-master-key', 'litellm', ['LITELLM_MASTER_KEY'], [
    { name: 'Authorization', valueExpression: "'Bearer ' + $env.LITELLM_MASTER_KEY" },
  ]),
  environmentAdapter('deepseek-api-key', 'deepseek', ['DEEPSEEK_API_KEY'], [
    { name: 'Authorization', valueExpression: "'Bearer ' + $env.DEEPSEEK_API_KEY" },
  ]),
] as const satisfies readonly CredentialAdapter[]

const adapters = new Map(CREDENTIAL_ADAPTERS.map((adapter) => [adapter.id, adapter]))

export function requireCredentialAdapter(id: string): CredentialAdapter {
  const adapter = adapters.get(id)
  if (!adapter) throw new Error(`unknown_credential_adapter:${id}`)
  return adapter
}

export function credentialHeaderExpression(adapterId: string): string | undefined {
  const headers = requireCredentialAdapter(adapterId).headers
  if (headers.length === 0) return undefined
  const entries = headers.map(({ name, valueExpression }) => `${JSON.stringify(name)}: ${valueExpression}`).join(', ')
  return `={{ JSON.stringify({ ${entries} }) }}`
}
