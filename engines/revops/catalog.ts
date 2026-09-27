import type { EngineModuleDefinition } from '../../core/module-types.js'

export const REVOPS_MODULES = [
  { id: 'deal-routing', name: 'Deal Routing', description: 'Route qualified replies and synchronize CRM outcomes.', status: 'available', sourcePaths: ['workflows/pre-crm/reply-to-deal.workflow.json', 'core/revops/contracts/routing-contract.ts'], workflowIds: ['pre-crm.reply-to-deal'] },
  { id: 'customer-lifecycle', name: 'Customer Lifecycle', description: 'Represent reusable lifecycle and retention states.', status: 'extracted', sourcePaths: ['core/revops/contracts/retention-contract.ts'], workflowIds: [] },
  { id: 'retention', name: 'Retention', description: 'Evaluate reusable retention and intervention contracts.', status: 'extracted', sourcePaths: ['core/revops/contracts/retention-contract.ts'], workflowIds: [] },
  { id: 'revenue-signals', name: 'Revenue Signals', description: 'Generate and process persisted revenue-operation signals.', status: 'available', sourcePaths: ['workflows/revops/signal-orchestration.workflow.json', 'core/pre-crm/n8n-code-nodes/n8n-revops-signal-split.js'], workflowIds: ['revops.signal-orchestration'] },
] as const satisfies readonly EngineModuleDefinition[]
