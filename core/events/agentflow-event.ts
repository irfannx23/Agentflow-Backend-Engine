import { createHash } from 'node:crypto'

import type { AgentFlowProductEvent, AgentFlowProductEventName } from '../product-signals.js'

export const AGENTFLOW_EVENT_NAMES = [
  'user.registered', 'user.logged_in', 'user.logged_out',
  'project.created', 'project.deleted', 'project.archived', 'project.shared',
  'workflow.generated', 'workflow.regenerated', 'workflow.repaired',
  'generation.failed', 'generation.completed',
  'workflow.downloaded', 'workflow.imported', 'workflow.exported', 'workflow.import.failed',
  'provider.connected', 'provider.disconnected', 'model.changed', 'integration.connected',
  'repair.started', 'repair.completed', 'repair.failed',
  'conversation.created', 'conversation.continued', 'template.used', 'tool.selected',
] as const

export type AgentFlowEventName = (typeof AGENTFLOW_EVENT_NAMES)[number]
export type EventMetadata = Readonly<Record<string, unknown>>

export type AgentFlowEvent = {
  eventId: string
  event: AgentFlowEventName
  timestamp: string
  userId: string
  projectId: string | null
  workspaceId: string | null
  metadata: EventMetadata
  source: 'agentflow'
  version: '1.0'
}

export type EventValidationResult =
  | { valid: true; event: AgentFlowEvent }
  | { valid: false; errors: readonly string[] }

const names = new Set<string>(AGENTFLOW_EVENT_NAMES)

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalId(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

export function validateAgentFlowEvent(value: unknown): EventValidationResult {
  if (!record(value)) return { valid: false, errors: ['event_payload_must_be_an_object'] }
  const errors: string[] = []
  const eventId = typeof value.eventId === 'string' ? value.eventId.trim() : ''
  const event = typeof value.event === 'string' ? value.event : ''
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : ''
  const userId = typeof value.userId === 'string' ? value.userId.trim() : ''
  const projectId = optionalId(value.projectId)
  const workspaceId = optionalId(value.workspaceId)

  if (!eventId || eventId.length > 128) errors.push('event_id_invalid')
  if (!names.has(event)) errors.push('event_name_unsupported')
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) errors.push('event_timestamp_invalid')
  if (!userId || userId.length > 256) errors.push('event_user_id_invalid')
  if (projectId === undefined) errors.push('event_project_id_invalid')
  if (workspaceId === undefined) errors.push('event_workspace_id_invalid')
  if (!record(value.metadata)) errors.push('event_metadata_invalid')
  if (value.source !== 'agentflow') errors.push('event_source_invalid')
  if (value.version !== '1.0') errors.push('event_version_unsupported')
  if (errors.length) return { valid: false, errors }

  return {
    valid: true,
    event: {
      eventId,
      event: event as AgentFlowEventName,
      timestamp,
      userId,
      projectId: projectId as string | null,
      workspaceId: workspaceId as string | null,
      metadata: Object.freeze({ ...value.metadata as Record<string, unknown> }),
      source: 'agentflow',
      version: '1.0',
    },
  }
}

const SIGNAL_EVENT_NAMES: Readonly<Partial<Record<AgentFlowEventName, AgentFlowProductEventName>>> = {
  'project.created': 'project_created',
  'project.shared': 'project_shared',
  'workflow.generated': 'workflow_generated',
  'workflow.regenerated': 'workflow_generated',
  'workflow.repaired': 'workflow_repaired',
  'repair.completed': 'workflow_repaired',
  'generation.failed': 'ai_generation_failed',
  'workflow.downloaded': 'workflow_downloaded',
  'workflow.exported': 'workflow_downloaded',
  'workflow.imported': 'workflow_imported',
  'workflow.import.failed': 'import_validation_failed',
  'provider.connected': 'connection_added',
  'integration.connected': 'connection_added',
  'provider.disconnected': 'connection_removed',
  'model.changed': 'model_changed',
  'conversation.continued': 'conversation_continued',
  'template.used': 'template_used',
}

export function toProductEvent(event: AgentFlowEvent): AgentFlowProductEvent | null {
  const name = SIGNAL_EVENT_NAMES[event.event]
  if (!name || !event.workspaceId) return null
  return {
    id: event.eventId,
    name,
    occurredAt: event.timestamp,
    workspaceId: event.workspaceId,
    userId: event.userId,
    ...(event.projectId ? { projectId: event.projectId } : {}),
    properties: { ...event.metadata, sourceEvent: event.event },
  }
}

export function eventFingerprint(event: AgentFlowEvent): string {
  return createHash('sha256').update(`${event.eventId}:${event.event}:${event.timestamp}:${event.userId}`).digest('hex')
}
