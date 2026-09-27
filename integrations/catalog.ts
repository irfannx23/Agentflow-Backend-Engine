import type { IntegrationDefinition } from '../core/types.js'

export const INTEGRATION_DEFINITIONS = [
  {
    id: 'hookdeck', name: 'Hookdeck', description: 'Webhook ingress, delivery, and retry boundary.',
    authentication: ['api-key', 'webhook'], credentialType: 'Hookdeck API key and signing secret',
    supportedActions: [], supportedTriggers: ['webhook'], supportedWorkflows: ['pre-crm.lead-qualification'],
    environmentVariables: ['HOOKDECK_API_KEY', 'HOOKDECK_SIGNING_SECRET', 'HOOKDECK_SOURCE_URL'],
    validation: ['verify signatures when enabled', 'deduplicate delivery identifiers'],
  },
  {
    id: 'supabase', name: 'Supabase', description: 'Existing persistence and RPC platform for GTM and RevOps state.',
    authentication: ['api-key', 'bearer'], credentialType: 'Supabase service credential',
    supportedActions: ['call-supabase-rpc'], supportedTriggers: ['supabase-change', 'database-change'],
    supportedWorkflows: ['pre-crm.lead-qualification', 'pre-crm.reply-to-deal', 'revops.signal-orchestration'],
    environmentVariables: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    validation: ['URL must be HTTPS outside local development', 'service credentials must remain server-side', 'RPC must already exist'],
  },
  {
    id: 'emailable', name: 'Emailable', description: 'Email deliverability verification provider.',
    authentication: ['api-key'], credentialType: 'Provider API key', supportedActions: ['validate-email'], supportedTriggers: [],
    supportedWorkflows: ['pre-crm.lead-qualification'], environmentVariables: ['EMAIL_VERIFY_API_KEY', 'EMAIL_VERIFY_BASE_URL'],
    validation: ['base URL must be HTTPS', 'provider verdict must be normalized'],
  },
  {
    id: 'mx', name: 'MX Service', description: 'Local reusable MX record validation service.',
    authentication: ['none'], credentialType: 'No secret credential', supportedActions: ['validate-email'], supportedTriggers: [],
    supportedWorkflows: ['pre-crm.lead-qualification'], environmentVariables: ['MX_SERVICE_PORT'],
    validation: ['domain must be normalized', 'DNS failures must fail closed'],
  },
  {
    id: 'apollo', name: 'Apollo', description: 'Company and firmographic enrichment provider.',
    authentication: ['api-key'], credentialType: 'Provider API key', supportedActions: ['enrich-lead'], supportedTriggers: [],
    supportedWorkflows: ['pre-crm.lead-qualification'], environmentVariables: ['ENRICH_API_KEY', 'ENRICH_BASE_URL'],
    validation: ['domain must be present', 'response fields must be allowlisted'],
  },
  {
    id: 'gemini', name: 'Google Gemini', description: 'Structured AI scoring and content generation provider.',
    authentication: ['api-key'], credentialType: 'Google AI API key', supportedActions: ['generate-ai-content'], supportedTriggers: ['ai-event'],
    supportedWorkflows: ['pre-crm.lead-qualification'], environmentVariables: ['GEMINI_API_KEY', 'GEMINI_ENDPOINT', 'GEMINI_MODEL'],
    validation: ['model must be configured', 'responses must satisfy the declared JSON contract'],
  },
  {
    id: 'hubspot', name: 'HubSpot', description: 'CRM contact, deal, and lifecycle synchronization.',
    authentication: ['bearer', 'oauth2'], credentialType: 'Private app token or OAuth connection',
    supportedActions: ['create-contact', 'update-deal', 'update-crm'], supportedTriggers: ['hubspot-event'],
    supportedWorkflows: ['pre-crm.lead-qualification', 'pre-crm.reply-to-deal', 'revops.signal-orchestration'],
    environmentVariables: ['HUBSPOT_ACCESS_TOKEN', 'HUBSPOT_BASE_URL'],
    validation: ['token must remain server-side', 'object and property IDs must be valid'],
  },
  {
    id: 'slack', name: 'Slack', description: 'Operational notifications and event callbacks.',
    authentication: ['webhook', 'oauth2'], credentialType: 'Incoming webhook or OAuth connection',
    supportedActions: ['send-slack-message'], supportedTriggers: ['slack-event'],
    supportedWorkflows: ['pre-crm.lead-qualification', 'pre-crm.reply-to-deal', 'revops.signal-orchestration'],
    environmentVariables: ['SLACK_WEBHOOK_URL'], validation: ['destination must be configured', 'messages must not contain secrets'],
  },
  {
    id: 'brevo', name: 'Brevo', description: 'Transactional and nurture email delivery.',
    authentication: ['api-key'], credentialType: 'Provider API key', supportedActions: ['send-email'], supportedTriggers: [],
    supportedWorkflows: ['pre-crm.lead-qualification'],
    environmentVariables: ['BREVO_API_KEY', 'BREVO_BASE_URL', 'BREVO_SENDER_NAME', 'BREVO_SENDER_EMAIL'],
    validation: ['sender must be verified', 'recipient must pass qualification gates'],
  },
  {
    id: 'litellm', name: 'LiteLLM', description: 'Optional local model gateway for normalized provider access.',
    authentication: ['api-key'], credentialType: 'Gateway master key', supportedActions: ['generate-ai-content'], supportedTriggers: [],
    supportedWorkflows: [], environmentVariables: ['LITELLM_MASTER_KEY'],
    validation: ['gateway must be private', 'model alias must be registered'],
  },
  {
    id: 'deepseek', name: 'DeepSeek', description: 'AI provider available through the LiteLLM adapter.',
    authentication: ['api-key'], credentialType: 'Provider API key', supportedActions: ['generate-ai-content'], supportedTriggers: ['ai-event'],
    supportedWorkflows: [], environmentVariables: ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL'],
    validation: ['base URL must be HTTPS', 'model must be registered through the gateway'],
  },
] as const satisfies readonly IntegrationDefinition[]
