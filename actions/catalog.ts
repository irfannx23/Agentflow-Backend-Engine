import type { ActionDefinition, FieldDefinition } from '../core/types.js'

const objectInput: FieldDefinition = {
  name: 'input',
  type: 'object',
  required: true,
  description: 'Normalized action input.',
}

const objectOutput: FieldDefinition = {
  name: 'result',
  type: 'object',
  required: true,
  description: 'Normalized action result.',
}

export const ACTION_DEFINITIONS = [
  {
    id: 'send-email', name: 'Send Email', description: 'Deliver an email through a configured provider.',
    integrationIds: ['brevo'], configuration: [{ name: 'template', type: 'string', required: false, description: 'Optional provider template.' }],
    inputs: [objectInput], outputs: [objectOutput], validation: ['recipient must be valid', 'sender must be configured'],
    supportedWorkflows: ['pre-crm.lead-qualification'],
  },
  {
    id: 'create-contact', name: 'Create Contact', description: 'Create or upsert a CRM contact.',
    integrationIds: ['hubspot'], configuration: [], inputs: [objectInput], outputs: [objectOutput],
    validation: ['email or provider identity must be present'], supportedWorkflows: ['pre-crm.lead-qualification'],
  },
  {
    id: 'update-deal', name: 'Update Deal', description: 'Create or update a CRM opportunity.',
    integrationIds: ['hubspot'], configuration: [], inputs: [objectInput], outputs: [objectOutput],
    validation: ['pipeline and stage must be configured'],
    supportedWorkflows: ['pre-crm.lead-qualification', 'pre-crm.reply-to-deal', 'revops.signal-orchestration'],
  },
  {
    id: 'append-row', name: 'Append Row', description: 'Append a normalized row to a tabular data source.',
    integrationIds: [], configuration: [{ name: 'destination', type: 'string', required: true, description: 'Registered table destination.' }],
    inputs: [objectInput], outputs: [objectOutput], validation: ['destination schema must accept the row'], supportedWorkflows: [],
  },
  {
    id: 'generate-ai-content', name: 'Generate AI Content', description: 'Generate structured content using a configured model provider.',
    integrationIds: ['gemini'], configuration: [{ name: 'responseFormat', type: 'string', required: true, description: 'Expected response contract.' }],
    inputs: [objectInput], outputs: [objectOutput], validation: ['response must satisfy its declared contract'],
    supportedWorkflows: ['pre-crm.lead-qualification'],
  },
  {
    id: 'validate-email', name: 'Validate Email', description: 'Verify syntax, domain, and deliverability.',
    integrationIds: ['emailable', 'mx'], configuration: [], inputs: [objectInput], outputs: [objectOutput],
    validation: ['email must be normalized before verification'], supportedWorkflows: ['pre-crm.lead-qualification'],
  },
  {
    id: 'send-slack-message', name: 'Send Slack Message', description: 'Send an operational Slack notification.',
    integrationIds: ['slack'], configuration: [{ name: 'destination', type: 'string', required: true, description: 'Channel or webhook destination.' }],
    inputs: [objectInput], outputs: [objectOutput], validation: ['message must be non-empty'],
    supportedWorkflows: ['pre-crm.lead-qualification', 'pre-crm.reply-to-deal', 'revops.signal-orchestration'],
  },
  {
    id: 'create-task', name: 'Create Task', description: 'Create a task through a registered work-management integration.',
    integrationIds: [], configuration: [{ name: 'destination', type: 'string', required: true, description: 'Registered task destination.' }],
    inputs: [objectInput], outputs: [objectOutput], validation: ['title and owner must be resolvable'], supportedWorkflows: [],
  },
  {
    id: 'update-crm', name: 'Update CRM', description: 'Apply a validated CRM record update.',
    integrationIds: ['hubspot'], configuration: [], inputs: [objectInput], outputs: [objectOutput],
    validation: ['object type and property allowlist must be configured'],
    supportedWorkflows: ['pre-crm.lead-qualification', 'pre-crm.reply-to-deal', 'revops.signal-orchestration'],
  },
  {
    id: 'enrich-lead', name: 'Enrich Lead', description: 'Add firmographic data to a normalized lead.',
    integrationIds: ['apollo'], configuration: [], inputs: [objectInput], outputs: [objectOutput],
    validation: ['domain must be normalized'], supportedWorkflows: ['pre-crm.lead-qualification'],
  },
  {
    id: 'call-supabase-rpc', name: 'Call Supabase RPC', description: 'Execute an existing allowlisted Supabase function.',
    integrationIds: ['supabase'], configuration: [{ name: 'function', type: 'string', required: true, description: 'Existing RPC name.' }],
    inputs: [objectInput], outputs: [objectOutput], validation: ['function must exist in the allowlist'],
    supportedWorkflows: ['pre-crm.lead-qualification', 'pre-crm.reply-to-deal', 'revops.signal-orchestration'],
  },
] as const satisfies readonly ActionDefinition[]
