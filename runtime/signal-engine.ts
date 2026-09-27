import {
  REVOPS_SIGNAL_DEFINITIONS,
  type AgentFlowProductEvent,
  type DetectedSignal,
} from '../core/product-signals.js'

const directSignals = new Map<AgentFlowProductEvent['name'], string>([
  ['project_created', 'activation.project-created'],
  ['workflow_imported', 'activation.workflow-imported'],
  ['workflow_downloaded', 'adoption.workflow-downloaded'],
  ['conversation_continued', 'adoption.conversation-continued'],
  ['workflow_repaired', 'retention.workflow-repaired'],
  ['ai_generation_failed', 'risk.ai-generation-failed'],
  ['import_validation_failed', 'risk.import-validation-failed'],
  ['workflow_published', 'revenue.workflow-published'],
  ['connection_added', 'operational.connection-added'],
  ['provider_changed', 'operational.provider-changed'],
  ['model_changed', 'operational.model-changed'],
  ['template_used', 'adoption.template-used'],
  ['project_shared', 'customer-success.project-shared'],
] as const)

function numericProperty(event: AgentFlowProductEvent, name: string): number | undefined {
  const value = event.properties[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanProperty(event: AgentFlowProductEvent, name: string): boolean {
  return event.properties[name] === true
}

function groupBy<T, K>(values: readonly T[], keyFor: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const value of values) {
    const key = keyFor(value)
    const group = groups.get(key) ?? []
    group.push(value)
    groups.set(key, group)
  }
  return groups
}

function detected(definitionId: string, events: AgentFlowProductEvent[]): DetectedSignal {
  const latest = [...events].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0]
  if (!latest) throw new Error('signal_requires_source_event')
  return {
    definitionId,
    workspaceId: latest.workspaceId,
    ...(latest.projectId ? { projectId: latest.projectId } : {}),
    detectedAt: latest.occurredAt,
    sourceEventIds: events.map((event) => event.id),
  }
}

export function evaluateProductSignals(events: readonly AgentFlowProductEvent[]): DetectedSignal[] {
  const ordered = [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
  const results: DetectedSignal[] = []

  for (const event of ordered) {
    const direct = directSignals.get(event.name)
    if (direct) results.push(detected(direct, [event]))

    if (event.name === 'workflow_generated' && booleanProperty(event, 'isFirst')) {
      results.push(detected('activation.first-workflow-generated', [event]))
    }
    if (event.name === 'workflow_generated' && (numericProperty(event, 'nodeCount') ?? 0) >= 50) {
      results.push(detected('expansion.large-workflow-generated', [event]))
    }
    if (event.name === 'connection_added' && (numericProperty(event, 'connectedIntegrationCount') ?? 0) >= 3) {
      results.push(detected('expansion.multiple-integrations-connected', [event]))
    }
    if (event.name === 'connection_removed' && booleanProperty(event, 'affectsActiveWorkflow')) {
      results.push(detected('risk.connection-removed', [event]))
    }
  }

  const repairsByProject = groupBy(
    ordered.filter((event) => event.name === 'workflow_repaired' && event.projectId),
    (event) => event.projectId as string,
  )
  for (const repairs of repairsByProject.values()) {
    const latest = repairs.at(-1)
    if (!latest) continue
    const sevenDays = 7 * 24 * 60 * 60 * 1000
    const recent = repairs.filter((event) => Date.parse(latest.occurredAt) - Date.parse(event.occurredAt) <= sevenDays)
    if (recent.length >= 3) results.push(detected('risk.repeated-repair', recent))
  }

  const coreNames = new Set(['workflow_generated', 'workflow_imported', 'workflow_downloaded', 'workflow_repaired', 'workflow_published', 'conversation_continued'])
  const byUser = groupBy(ordered.filter((event) => event.userId && coreNames.has(event.name)), (event) => event.userId as string)
  for (const userEvents of byUser.values()) {
    const latest = userEvents.at(-1)
    if (!latest) continue
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    const recent = userEvents.filter((event) => Date.parse(latest.occurredAt) - Date.parse(event.occurredAt) <= thirtyDays)
    if (recent.length >= 10) results.push(detected('power-user.activity', recent))
  }

  const knownDefinitions = new Set<string>(REVOPS_SIGNAL_DEFINITIONS.map((definition) => definition.id))
  return results.filter((result) => knownDefinitions.has(result.definitionId))
}
