import type { WorkflowDefinition } from '../core/types.js'

const owner = 'agentflow-backend-engine' as const
const n8nVersion = '>=2.34.5 <3'

export const WORKFLOW_DEFINITIONS = [
  {
    id: 'pre-crm.lead-qualification',
    name: 'Lead Qualification',
    category: 'pre-crm',
    description: 'Ingest, sanitize, verify, enrich, qualify, route, and follow up with inbound or outbound leads.',
    version: '1.0.0',
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
    complexity: 'very-high', status: 'candidate', owner, supportedPlatforms: ['n8n'], n8nVersion,
    documentation: 'docs/knowledge/pre-crm/playbook.md', workflowPath: 'workflows/pre-crm/lead-qualification.workflow.json',
  },
  {
    id: 'pre-crm.reply-to-deal',
    name: 'Reply to Deal',
    category: 'pre-crm',
    description: 'Detect replied outreach, refresh qualification, create a CRM deal, and notify the assigned team.',
    version: '1.0.0', triggerTypes: ['cron'], supportedIntegrations: ['supabase', 'hubspot', 'slack'],
    requiredCredentials: [
      { id: 'supabase-service', name: 'Supabase Service Credential', integrationId: 'supabase', authentication: 'bearer', configuredAtRuntime: true },
      { id: 'hubspot', name: 'HubSpot Connection', integrationId: 'hubspot', authentication: 'bearer', configuredAtRuntime: true },
      { id: 'slack', name: 'Slack Webhook', integrationId: 'slack', authentication: 'webhook', configuredAtRuntime: true },
    ],
    requiredEnvironmentVariables: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'HUBSPOT_ACCESS_TOKEN', 'HUBSPOT_BASE_URL', 'SLACK_WEBHOOK_URL'],
    complexity: 'medium', status: 'candidate', owner, supportedPlatforms: ['n8n'], n8nVersion,
    documentation: 'docs/knowledge/pre-crm/playbook.md', workflowPath: 'workflows/pre-crm/reply-to-deal.workflow.json',
  },
  {
    id: 'revops.signal-orchestration',
    name: 'RevOps Signal Orchestration',
    category: 'revops',
    description: 'Generate persisted revenue signals and coordinate idempotent CRM and Slack outcomes.',
    version: '1.0.0', triggerTypes: ['cron', 'internal-event'], supportedIntegrations: ['supabase', 'hubspot', 'slack'],
    requiredCredentials: [
      { id: 'supabase-service', name: 'Supabase Service Credential', integrationId: 'supabase', authentication: 'bearer', configuredAtRuntime: true },
      { id: 'hubspot', name: 'HubSpot Connection', integrationId: 'hubspot', authentication: 'bearer', configuredAtRuntime: true },
      { id: 'slack', name: 'Slack Webhook', integrationId: 'slack', authentication: 'webhook', configuredAtRuntime: true },
    ],
    requiredEnvironmentVariables: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'HUBSPOT_ACCESS_TOKEN', 'HUBSPOT_BASE_URL', 'SLACK_WEBHOOK_URL'],
    complexity: 'high', status: 'candidate', owner, supportedPlatforms: ['n8n'], n8nVersion,
    documentation: 'docs/architecture.md', workflowPath: 'workflows/revops/signal-orchestration.workflow.json',
  },
] as const satisfies readonly WorkflowDefinition[]
