import type { EngineModuleDefinition } from '../../core/module-types.js'

const workflowId = 'pre-crm.lead-qualification'

export const PRE_CRM_MODULES = [
  { id: 'anti-abuse', name: 'Anti-Abuse', description: 'Reject automated, flooded, or invalid submissions.', status: 'available', sourcePaths: ['core/pre-crm/n8n-code-nodes/n8n-anti-abuse.js', 'core/pre-crm/n8n-code-nodes/n8n-turnstile-parse.js'], workflowIds: [workflowId] },
  { id: 'verification', name: 'Verification', description: 'Normalize email deliverability and MX verification.', status: 'available', sourcePaths: ['core/pre-crm/n8n-code-nodes/n8n-verify-parse.js', 'integrations/mx-service/mx-check.ts'], workflowIds: [workflowId] },
  { id: 'enrichment', name: 'Enrichment', description: 'Normalize company and firmographic enrichment.', status: 'available', sourcePaths: ['core/pre-crm/n8n-code-nodes/n8n-enrich-parse.js'], workflowIds: [workflowId] },
  { id: 'scoring', name: 'Scoring', description: 'Build and validate structured AI qualification scores.', status: 'available', sourcePaths: ['core/pre-crm/n8n-code-nodes/n8n-gemini-score.js', 'core/pre-crm/n8n-code-nodes/n8n-gemini-parse.js'], workflowIds: [workflowId] },
  { id: 'qualification', name: 'Qualification', description: 'Evaluate reusable qualification contracts.', status: 'extracted', sourcePaths: ['core/revops/contracts/qualification-contract.ts'], workflowIds: [workflowId] },
  { id: 'routing', name: 'Routing', description: 'Route qualified leads using deterministic sales contracts.', status: 'extracted', sourcePaths: ['core/revops/contracts/routing-contract.ts'], workflowIds: [workflowId, 'pre-crm.reply-to-deal'] },
  { id: 'outreach', name: 'Outreach', description: 'Build and parse structured first-touch outreach.', status: 'available', sourcePaths: ['core/pre-crm/n8n-code-nodes/n8n-outreach-prompt.js', 'core/pre-crm/n8n-code-nodes/n8n-outreach-parse.js'], workflowIds: [workflowId] },
  { id: 'nurture', name: 'Nurture', description: 'Build and parse qualified nurture content.', status: 'available', sourcePaths: ['core/pre-crm/n8n-code-nodes/n8n-nurture-prompt.js', 'core/pre-crm/n8n-code-nodes/n8n-nurture-parse.js'], workflowIds: [workflowId] },
  { id: 'reply-detection', name: 'Reply Detection', description: 'Normalize replied outreach into workflow items.', status: 'available', sourcePaths: ['core/pre-crm/n8n-code-nodes/n8n-reply-split.js'], workflowIds: ['pre-crm.reply-to-deal'] },
] as const satisfies readonly EngineModuleDefinition[]
