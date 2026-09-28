import type { AgentFlowEvent } from '../core/events/agentflow-event.js'

export type LeadIngestionPayload = {
  event_id: string
  email: string
  name?: string
  source: 'agentflow_signup'
  source_type: 'inbound'
  raw_payload: Readonly<{
    firebase_user_id: string
    auth_provider?: string
    registered_at: string
    workspace_id: string | null
    project_id: string | null
    source_event: 'user.registered'
  }>
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function registrationEventToLeadPayload(event: AgentFlowEvent): LeadIngestionPayload | null {
  if (event.event !== 'user.registered') return null
  const email = nonEmptyString(event.metadata.email)
  if (!email) return null
  const name = nonEmptyString(event.metadata.displayName)
  const provider = nonEmptyString(event.metadata.provider) ?? nonEmptyString(event.metadata.method)
  return {
    event_id: event.eventId,
    email,
    ...(name ? { name } : {}),
    source: 'agentflow_signup',
    source_type: 'inbound',
    raw_payload: {
      firebase_user_id: event.userId,
      ...(provider ? { auth_provider: provider } : {}),
      registered_at: event.timestamp,
      workspace_id: event.workspaceId,
      project_id: event.projectId,
      source_event: 'user.registered',
    },
  }
}
