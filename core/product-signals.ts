export type AgentFlowProductEventName =
  | 'project_created'
  | 'workflow_generated'
  | 'workflow_imported'
  | 'workflow_downloaded'
  | 'workflow_repaired'
  | 'conversation_continued'
  | 'ai_generation_failed'
  | 'import_validation_failed'
  | 'workflow_published'
  | 'connection_added'
  | 'connection_removed'
  | 'provider_changed'
  | 'model_changed'
  | 'template_used'
  | 'project_shared'

export type AgentFlowProductEvent = {
  id: string
  name: AgentFlowProductEventName
  occurredAt: string
  workspaceId: string
  userId?: string
  projectId?: string
  properties: Record<string, unknown>
}

export type RevOpsSignalCategory =
  | 'activation'
  | 'adoption'
  | 'expansion'
  | 'retention'
  | 'revenue'
  | 'risk'
  | 'power-user'
  | 'customer-success'
  | 'usage-intelligence'
  | 'operational'

export type SignalPriority = 'low' | 'medium' | 'high' | 'critical'

export type RevOpsSignalDefinition = {
  id: string
  name: string
  category: RevOpsSignalCategory
  description: string
  triggerCondition: string
  businessValue: string
  recommendedAutomation: string
  priority: SignalPriority
}

export type DetectedSignal = {
  definitionId: string
  workspaceId: string
  projectId?: string
  detectedAt: string
  sourceEventIds: string[]
}

export const REVOPS_SIGNAL_DEFINITIONS = [
  {
    id: 'activation.project-created', name: 'Project Created', category: 'activation', priority: 'low',
    description: 'A workspace created an automation project.', triggerCondition: 'A project_created event is persisted.',
    businessValue: 'Measures entry into the core automation lifecycle.', recommendedAutomation: 'Record activation state and make project setup guidance available in-product.',
  },
  {
    id: 'activation.first-workflow-generated', name: 'First Workflow Generated', category: 'activation', priority: 'high',
    description: 'A workspace generated its first validated workflow.', triggerCondition: 'workflow_generated has properties.isFirst equal to true.',
    businessValue: 'Represents the primary time-to-value milestone.', recommendedAutomation: 'Mark the workspace activated and expose import and credential setup guidance.',
  },
  {
    id: 'activation.workflow-imported', name: 'Workflow Imported', category: 'activation', priority: 'medium',
    description: 'A user imported an existing workflow for analysis.', triggerCondition: 'A workflow_imported event is persisted.',
    businessValue: 'Shows adoption of lifecycle management beyond greenfield generation.', recommendedAutomation: 'Queue structural analysis and documentation for the imported workflow.',
  },
  {
    id: 'adoption.workflow-downloaded', name: 'Workflow Downloaded', category: 'adoption', priority: 'medium',
    description: 'A validated workflow or project package was downloaded.', triggerCondition: 'A workflow_downloaded event is persisted.',
    businessValue: 'Indicates movement from design toward external execution.', recommendedAutomation: 'Record the exported version and expose deployment instructions.',
  },
  {
    id: 'adoption.conversation-continued', name: 'Conversation Continued', category: 'adoption', priority: 'low',
    description: 'A user returned to an existing project conversation.', triggerCondition: 'A conversation_continued event is persisted.',
    businessValue: 'Measures sustained project engagement and lifecycle reuse.', recommendedAutomation: 'Restore project memory and preserve the existing workflow version.',
  },
  {
    id: 'retention.workflow-repaired', name: 'Workflow Repaired', category: 'retention', priority: 'medium',
    description: 'A workflow repair completed successfully.', triggerCondition: 'A workflow_repaired event is persisted.',
    businessValue: 'Demonstrates value after deployment and encourages long-term maintenance.', recommendedAutomation: 'Create a new validated version and attach the repair summary.',
  },
  {
    id: 'risk.ai-generation-failed', name: 'AI Generation Failed', category: 'risk', priority: 'high',
    description: 'An AI-backed generation stage failed.', triggerCondition: 'An ai_generation_failed event is persisted.',
    businessValue: 'Identifies blocked time-to-value and provider reliability issues.', recommendedAutomation: 'Retry only the failed stage and surface a correlated operational error.',
  },
  {
    id: 'risk.repeated-repair', name: 'Repeated Repair', category: 'risk', priority: 'high',
    description: 'The same project required repeated workflow repairs.', triggerCondition: 'At least three workflow_repaired events occur for one project within seven days.',
    businessValue: 'Highlights unstable workflows and elevated support risk.', recommendedAutomation: 'Create an engineering review task with the affected versions and failure context.',
  },
  {
    id: 'risk.import-validation-failed', name: 'Import Validation Failed', category: 'risk', priority: 'high',
    description: 'An imported workflow failed structural or platform validation.', triggerCondition: 'An import_validation_failed event is persisted.',
    businessValue: 'Identifies migration friction before invalid files reach production.', recommendedAutomation: 'Preserve the source file and open guided repair with structured validation errors.',
  },
  {
    id: 'revenue.workflow-published', name: 'Workflow Published', category: 'revenue', priority: 'high',
    description: 'A validated workflow version was published for production use.', triggerCondition: 'A workflow_published event is persisted.',
    businessValue: 'Represents realized production value and a strong commercial outcome.', recommendedAutomation: 'Record the production version and begin operational health tracking.',
  },
  {
    id: 'operational.connection-added', name: 'Connection Added', category: 'operational', priority: 'low',
    description: 'A provider or application connection was added.', triggerCondition: 'A connection_added event is persisted.',
    businessValue: 'Tracks increasing integration depth without inspecting secrets.', recommendedAutomation: 'Refresh capability availability and credential readiness metadata.',
  },
  {
    id: 'risk.connection-removed', name: 'Connection Removed', category: 'risk', priority: 'medium',
    description: 'A provider connection required by one or more workflows was removed.', triggerCondition: 'connection_removed has properties.affectsActiveWorkflow equal to true.',
    businessValue: 'Identifies workflows at risk of credential or execution failure.', recommendedAutomation: 'Mark affected workflows as needing connection and prevent invalid export activation.',
  },
  {
    id: 'operational.provider-changed', name: 'Provider Changed', category: 'operational', priority: 'medium',
    description: 'A project changed its selected AI provider.', triggerCondition: 'A provider_changed event is persisted.',
    businessValue: 'Provides explainability for cost, output, and reliability changes.', recommendedAutomation: 'Record the provider transition in the project timeline and revalidate affected AI nodes.',
  },
  {
    id: 'operational.model-changed', name: 'Model Changed', category: 'operational', priority: 'medium',
    description: 'A project changed its selected model.', triggerCondition: 'A model_changed event is persisted.',
    businessValue: 'Supports model-governance and workflow-version traceability.', recommendedAutomation: 'Record the model transition and rerun only model-sensitive validations.',
  },
  {
    id: 'expansion.multiple-integrations-connected', name: 'Multiple Integrations Connected', category: 'expansion', priority: 'medium',
    description: 'A workspace connected at least three integrations.', triggerCondition: 'connection_added reports properties.connectedIntegrationCount of three or more.',
    businessValue: 'Indicates deeper platform adoption and more complex automation potential.', recommendedAutomation: 'Unlock relevant integration templates and surface compatibility guidance.',
  },
  {
    id: 'expansion.large-workflow-generated', name: 'Large Workflow Generated', category: 'expansion', priority: 'high',
    description: 'A generated workflow contains at least 50 nodes.', triggerCondition: 'workflow_generated reports properties.nodeCount of 50 or more.',
    businessValue: 'Signals advanced use and greater operational dependency.', recommendedAutomation: 'Require enhanced validation and recommend staged deployment checks.',
  },
  {
    id: 'power-user.activity', name: 'Power User Activity', category: 'power-user', priority: 'high',
    description: 'A user performs at least ten core workflow actions in 30 days.', triggerCondition: 'Ten generation, import, download, repair, publish, or continuation events occur for one user within 30 days.',
    businessValue: 'Identifies sustained expert usage and product advocacy potential.', recommendedAutomation: 'Record power-user status and expose advanced workflow controls in-product.',
  },
  {
    id: 'adoption.template-used', name: 'Template Used', category: 'adoption', priority: 'low',
    description: 'A registered workflow template was used.', triggerCondition: 'A template_used event is persisted.',
    businessValue: 'Measures template utility and faster workflow starts.', recommendedAutomation: 'Attribute the resulting project version to the registered template.',
  },
  {
    id: 'customer-success.project-shared', name: 'Project Shared', category: 'customer-success', priority: 'medium',
    description: 'A project was shared with another authorized collaborator.', triggerCondition: 'A project_shared event is persisted.',
    businessValue: 'Shows team adoption and collaborative workflow ownership.', recommendedAutomation: 'Record the collaborator change and refresh project authorization metadata.',
  },
] as const satisfies readonly RevOpsSignalDefinition[]
