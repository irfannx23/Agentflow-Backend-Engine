import type { FieldDefinition, RuntimePolicy, WorkflowDefinition } from '../core/types.js'

const owner = 'agentflow-backend-engine' as const
const n8nVersion = '>=2.34.5 <3'
const runtimePolicy: RuntimePolicy = {
  timeoutMs: 30_000,
  retry: { enabled: true, maxAttempts: 3, waitBetweenAttemptsMs: 1_000, retrySafe: true },
  errorMode: 'stop',
}
const repairCompatibility = {
  preservesNodeNames: true,
  preservesRpcContracts: true,
  preservesConnectionTopology: true,
} as const
const validation = [
  'n8n structure and connections are valid',
  'environment references are declared',
  'credentials use registered adapters',
  'HTTP nodes have timeout and explicit retry behavior',
  'Supabase RPC names remain compatible',
]
const leadInput: FieldDefinition[] = [
  { name: 'event_id', type: 'string', required: true, description: 'Idempotency key supplied by the source.' },
  { name: 'email', type: 'string', required: true, description: 'Lead email to normalize and verify.' },
  { name: 'company_name', type: 'string', required: false, description: 'Company name when supplied.' },
  { name: 'source_type', type: 'string', required: false, description: 'Existing inbound or outbound source classification.' },
  { name: 'payload', type: 'object', required: false, description: 'Original source payload.' },
]

export const WORKFLOW_DEFINITIONS = [
  {
    id: 'pre-crm.lead-qualification',
    name: 'Lead Qualification',
    category: 'pre-crm',
    description: 'Ingest, sanitize, verify, enrich, qualify, route, and follow up with inbound or outbound leads.',
    version: '1.2.0',
    triggerTypes: ['webhook'],
    supportedIntegrations: ['hookdeck', 'supabase', 'emailable', 'mx', 'apollo', 'gemini', 'hubspot', 'slack', 'brevo'],
    requiredCredentials: [
      { id: 'supabase-service', name: 'Supabase Service Credential', integrationId: 'supabase', authentication: 'bearer', configuredAtRuntime: true },
      { id: 'email-verification', name: 'Email Verification API Key', integrationId: 'emailable', authentication: 'api-key', configuredAtRuntime: true },
      { id: 'enrichment', name: 'Enrichment API Key', integrationId: 'apollo', authentication: 'api-key', configuredAtRuntime: true },
      { id: 'gemini', name: 'Gemini API Key', integrationId: 'gemini', authentication: 'api-key', configuredAtRuntime: true },
      { id: 'hubspot', name: 'HubSpot Connection', integrationId: 'hubspot', authentication: 'bearer', configuredAtRuntime: true },
      { id: 'slack', name: 'Slack Webhook', integrationId: 'slack', authentication: 'webhook', configuredAtRuntime: true },
      { id: 'brevo', name: 'Brevo API Key', integrationId: 'brevo', authentication: 'api-key', configuredAtRuntime: true },
    ],
    requiredEnvironmentVariables: [
      'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'EMAIL_VERIFY_API_KEY', 'EMAIL_VERIFY_BASE_URL',
      'ENRICH_API_KEY', 'ENRICH_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_ENDPOINT', 'HUBSPOT_ACCESS_TOKEN',
      'HUBSPOT_BASE_URL', 'SLACK_WEBHOOK_URL', 'BREVO_API_KEY', 'BREVO_BASE_URL', 'BREVO_SENDER_NAME', 'BREVO_SENDER_EMAIL',
    ],
    optionalEnvironmentVariables: ['HOOKDECK_API_KEY', 'HOOKDECK_SIGNING_SECRET', 'HOOKDECK_SOURCE_URL', 'MX_SERVICE_PORT', 'GEMINI_MODEL'],
    inputSchema: leadInput,
    outputSchema: [{ name: 'result', type: 'object', required: true, description: 'Qualification, routing, and outreach outcome.' }],
    validation, health: { status: 'healthy', checks: ['registry', 'workflow', 'integration', 'parameters', 'n8n-compatibility'] },
    runtimePolicy, repairCompatibility,
    complexity: 'very-high', status: 'stable', owner, supportedPlatforms: ['n8n'], n8nVersion,
    documentation: 'docs/pre-crm-engine.md', workflowPath: 'workflows/pre-crm/lead-qualification.workflow.json',
  },
  {
    id: 'pre-crm.reply-to-deal',
    name: 'Reply to Deal',
    category: 'pre-crm',
    description: 'Detect replied outreach, refresh qualification, create a CRM deal, and notify the assigned team.',
    version: '1.2.0', triggerTypes: ['cron'], supportedIntegrations: ['supabase', 'hubspot', 'slack'],
    requiredCredentials: [
      { id: 'supabase-service', name: 'Supabase Service Credential', integrationId: 'supabase', authentication: 'bearer', configuredAtRuntime: true },
      { id: 'hubspot', name: 'HubSpot Connection', integrationId: 'hubspot', authentication: 'bearer', configuredAtRuntime: true },
      { id: 'slack', name: 'Slack Webhook', integrationId: 'slack', authentication: 'webhook', configuredAtRuntime: true },
    ],
    requiredEnvironmentVariables: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'HUBSPOT_ACCESS_TOKEN', 'HUBSPOT_BASE_URL', 'SLACK_WEBHOOK_URL'],
    optionalEnvironmentVariables: [],
    inputSchema: [{ name: 'limit', type: 'number', required: false, description: 'Maximum replied outreach rows to process.' }],
    outputSchema: [{ name: 'deals', type: 'array', required: true, description: 'Processed reply-to-deal outcomes.' }],
    validation, health: { status: 'healthy', checks: ['registry', 'workflow', 'integration', 'parameters', 'n8n-compatibility'] },
    runtimePolicy, repairCompatibility,
    complexity: 'medium', status: 'stable', owner, supportedPlatforms: ['n8n'], n8nVersion,
    documentation: 'docs/workflow-catalogue.md', workflowPath: 'workflows/pre-crm/reply-to-deal.workflow.json',
  },
  {
    id: 'revops.signal-orchestration',
    name: 'RevOps Signal Orchestration',
    category: 'revops',
    description: 'Generate persisted revenue signals and coordinate idempotent CRM and Slack outcomes.',
    version: '1.2.0', triggerTypes: ['cron', 'internal-event'], supportedIntegrations: ['supabase', 'hubspot', 'slack'],
    requiredCredentials: [
      { id: 'supabase-service', name: 'Supabase Service Credential', integrationId: 'supabase', authentication: 'bearer', configuredAtRuntime: true },
      { id: 'hubspot', name: 'HubSpot Connection', integrationId: 'hubspot', authentication: 'bearer', configuredAtRuntime: true },
      { id: 'slack', name: 'Slack Webhook', integrationId: 'slack', authentication: 'webhook', configuredAtRuntime: true },
    ],
    requiredEnvironmentVariables: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'HUBSPOT_ACCESS_TOKEN', 'HUBSPOT_BASE_URL', 'SLACK_WEBHOOK_URL'],
    optionalEnvironmentVariables: [],
    inputSchema: [{ name: 'account_id', type: 'string', required: false, description: 'Optional account scope accepted by the existing signal RPC.' }],
    outputSchema: [{ name: 'signals', type: 'array', required: true, description: 'Persisted RevOps signal outcomes.' }],
    validation, health: { status: 'healthy', checks: ['registry', 'workflow', 'integration', 'parameters', 'n8n-compatibility'] },
    runtimePolicy, repairCompatibility,
    complexity: 'high', status: 'stable', owner, supportedPlatforms: ['n8n'], n8nVersion,
    documentation: 'docs/revops-signal-engine.md', workflowPath: 'workflows/revops/signal-orchestration.workflow.json',
  },
] as const satisfies readonly WorkflowDefinition[]
