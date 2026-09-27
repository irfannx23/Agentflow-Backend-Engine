import type { EngineModuleDefinition } from '../../core/module-types.js'

export const GTM_MODULES = [
  { id: 'lead-capture', name: 'Lead Capture', description: 'Normalize inbound acquisition events.', status: 'extracted', sourcePaths: ['core/gtm/acquisition/shared/acquisition-foundation.ts'], workflowIds: ['pre-crm.lead-qualification'] },
  { id: 'lead-qualification', name: 'Lead Qualification', description: 'Verify, enrich, score, and qualify acquisition records.', status: 'available', sourcePaths: ['workflows/pre-crm/lead-qualification.workflow.json'], workflowIds: ['pre-crm.lead-qualification'] },
  { id: 'lead-routing', name: 'Lead Routing', description: 'Assign qualified leads and synchronize routing outcomes.', status: 'extracted', sourcePaths: ['core/revops/contracts/routing-contract.ts'], workflowIds: ['pre-crm.lead-qualification', 'pre-crm.reply-to-deal'] },
  { id: 'outbound', name: 'Outbound', description: 'Discover contacts and produce structured outreach inputs.', status: 'extracted', sourcePaths: ['core/gtm/acquisition/signal-outbound/scraper', 'core/gtm/acquisition/signal-outbound/outreach'], workflowIds: ['pre-crm.lead-qualification'] },
  { id: 'inbound', name: 'Inbound', description: 'Process webhook-originated lead acquisition.', status: 'available', sourcePaths: ['workflows/pre-crm/lead-qualification.workflow.json'], workflowIds: ['pre-crm.lead-qualification'] },
  { id: 'lifecycle-campaigns', name: 'Lifecycle Campaigns', description: 'Generate qualified nurture actions without campaign execution.', status: 'extracted', sourcePaths: ['core/pre-crm/n8n-code-nodes/n8n-nurture-prompt.js'], workflowIds: ['pre-crm.lead-qualification'] },
  { id: 'referral-partner', name: 'Referral and Partner Attribution', description: 'Normalize referral, creator, and partner acquisition context.', status: 'extracted', sourcePaths: ['core/gtm/acquisition/shared/acquisition-foundation.ts'], workflowIds: [] },
] as const satisfies readonly EngineModuleDefinition[]
