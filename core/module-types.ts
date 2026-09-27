export type EngineModuleStatus = 'available' | 'extracted' | 'planned'

export type EngineModuleDefinition = {
  id: string
  name: string
  description: string
  status: EngineModuleStatus
  sourcePaths: string[]
  workflowIds: string[]
}
