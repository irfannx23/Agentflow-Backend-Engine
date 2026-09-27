export type WorkflowCategory = 'pre-crm' | 'gtm' | 'revops' | 'ai-automation'
export type WorkflowComplexity = 'low' | 'medium' | 'high' | 'very-high'
export type WorkflowStatus = 'stable' | 'candidate' | 'prototype' | 'deprecated'
export type WorkflowHealthStatus = 'healthy' | 'degraded' | 'unvalidated'
export type SupportedPlatform = 'n8n' | 'make'
export type AuthenticationType = 'none' | 'api-key' | 'bearer' | 'oauth2' | 'basic' | 'webhook'

export type CredentialRequirement = {
  id: string
  name: string
  integrationId: string
  authentication: AuthenticationType
  configuredAtRuntime: boolean
}

export type RetryPolicy = {
  enabled: boolean
  maxAttempts: number
  waitBetweenAttemptsMs: number
  retrySafe: boolean
}

export type RuntimePolicy = {
  timeoutMs: number
  retry: RetryPolicy
  errorMode: 'stop' | 'continue-regular-output' | 'continue-error-output'
}

export type WorkflowHealth = {
  status: WorkflowHealthStatus
  checks: string[]
}

export type RepairCompatibility = {
  preservesNodeNames: boolean
  preservesRpcContracts: boolean
  preservesConnectionTopology: boolean
}

export type WorkflowDefinition = {
  id: string
  name: string
  category: WorkflowCategory
  description: string
  version: string
  triggerTypes: string[]
  supportedIntegrations: string[]
  requiredCredentials: CredentialRequirement[]
  requiredEnvironmentVariables: string[]
  optionalEnvironmentVariables: string[]
  inputSchema: FieldDefinition[]
  outputSchema: FieldDefinition[]
  validation: string[]
  health: WorkflowHealth
  runtimePolicy: RuntimePolicy
  repairCompatibility: RepairCompatibility
  complexity: WorkflowComplexity
  status: WorkflowStatus
  owner: 'agentflow-backend-engine'
  supportedPlatforms: SupportedPlatform[]
  n8nVersion: string
  documentation: string
  workflowPath: string
}

export type FieldDefinition = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required: boolean
  description: string
}

export type TriggerDefinition = {
  id: string
  name: string
  description: string
  configuration: FieldDefinition[]
  inputs: FieldDefinition[]
  outputs: FieldDefinition[]
  validation: string[]
  supportedWorkflows: string[]
}

export type ActionDefinition = {
  id: string
  name: string
  description: string
  integrationIds: string[]
  configuration: FieldDefinition[]
  inputs: FieldDefinition[]
  outputs: FieldDefinition[]
  validation: string[]
  supportedWorkflows: string[]
}

export type IntegrationDefinition = {
  id: string
  name: string
  description: string
  documentation: string
  authentication: AuthenticationType[]
  credentialType: string
  supportedActions: string[]
  supportedTriggers: string[]
  supportedWorkflows: string[]
  environmentVariables: string[]
  secretEnvironmentVariables: string[]
  credentialAdapterId: string
  defaultRuntimePolicy: RuntimePolicy
  validation: string[]
}

export type N8nNode = {
  id?: string
  name: string
  type: string
  typeVersion?: number
  parameters?: Record<string, unknown>
  position?: [number, number]
  retryOnFail?: boolean
  maxTries?: number
  waitBetweenTries?: number
  onError?: 'stopWorkflow' | 'continueRegularOutput' | 'continueErrorOutput'
}

export type N8nConnectionTarget = {
  node: string
  type: string
  index: number
}

export type N8nWorkflow = {
  id?: string
  name: string
  nodes: N8nNode[]
  connections: Record<string, Record<string, N8nConnectionTarget[][]>>
  settings?: Record<string, unknown>
  active?: boolean
  versionId?: string
}

export type ValidationIssue = {
  code: string
  message: string
  path?: string
}

export type ValidationResult = {
  valid: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}
