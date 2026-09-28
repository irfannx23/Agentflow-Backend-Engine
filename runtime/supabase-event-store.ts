import { toProductEvent, validateAgentFlowEvent, type AgentFlowEvent } from '../core/events/agentflow-event.js'
import type { AgentFlowProductEvent } from '../core/product-signals.js'
import type { PersistedRevOpsSignal } from '../core/revops/contracts/database-signals.js'
import type { QualificationEvidence } from '../core/revops/contracts/qualification-intelligence.js'
import type { CustomerHealthEvaluationResult } from '../core/revops/contracts/retention-contract.js'
import { readSupabaseRuntimeConfig, type SupabaseRuntimeConfig } from './supabase-config.js'

const AGENTFLOW_EVENT_SOURCE = 'web_app'
const AGENTFLOW_EVENT_TRUST_LEVEL = 'trusted'

export type StoredEvent = { id: string; duplicate: boolean }
export type WorkflowDispatchOutboxItem = {
  id: string
  eventId: string
  workflowId: string
  payload: Readonly<Record<string, unknown>>
  retryCount: number
}

export interface IntelligenceStore {
  persistEvent(event: AgentFlowEvent): Promise<StoredEvent>
  loadProductEvents(event: AgentFlowEvent): Promise<readonly AgentFlowProductEvent[]>
  evaluateQualification(leadId: number): Promise<QualificationEvidence | undefined>
  evaluateHealth(accountId: string): Promise<CustomerHealthEvaluationResult | undefined>
  generateRevOpsSignals(accountId: string): Promise<readonly PersistedRevOpsSignal[]>
  enqueueWorkflowDispatch(eventId: string, workflowId: string, payload: Readonly<Record<string, unknown>>): Promise<void>
  claimWorkflowDispatches(eventId?: string, limit?: number): Promise<readonly WorkflowDispatchOutboxItem[]>
  resolveWorkflowDispatch(id: string, result: { succeeded: boolean; permanent: boolean; error?: string }): Promise<void>
}

type JsonRecord = Record<string, unknown>

export class SupabaseIntelligenceStore implements IntelligenceStore {
  constructor(private readonly config: SupabaseRuntimeConfig = readSupabaseRuntimeConfig()) {}

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(`${this.config.url}${path}`, {
      ...init,
      headers: {
        apikey: this.config.serviceRoleKey,
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`supabase_request_failed:${response.status}:${path}`)
    if (response.status === 204) return null
    return response.json() as Promise<unknown>
  }

  async persistEvent(event: AgentFlowEvent): Promise<StoredEvent> {
    const productEvent = toProductEvent(event)
    const body = {
      event_id: event.eventId,
      event_name: productEvent?.name ?? event.event,
      event_properties: {
        ...event.metadata,
        contractEvent: event.event,
        projectId: event.projectId,
        workspaceId: event.workspaceId,
        contractVersion: event.version,
        integrationSource: event.source,
      },
      event_source: AGENTFLOW_EVENT_SOURCE,
      event_trust_level: AGENTFLOW_EVENT_TRUST_LEVEL,
      firebase_uid: event.userId,
      occurred_at: event.timestamp,
    }
    const response = await fetch(`${this.config.url}/rest/v1/product_events?on_conflict=event_id`, {
      method: 'POST',
      headers: {
        apikey: this.config.serviceRoleKey,
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`supabase_event_persist_failed:${response.status}`)
    const rows = await response.json() as Array<{ id?: number }>
    return { id: String(rows[0]?.id ?? event.eventId), duplicate: rows.length === 0 }
  }

  async loadProductEvents(event: AgentFlowEvent): Promise<readonly AgentFlowProductEvent[]> {
    const query = new URLSearchParams({
      select: 'event_id,event_name,event_properties,event_source,firebase_uid,occurred_at',
      firebase_uid: `eq.${event.userId}`,
      event_source: `eq.${AGENTFLOW_EVENT_SOURCE}`,
      'event_properties->>integrationSource': 'eq.agentflow',
      order: 'occurred_at.desc',
      limit: '250',
    })
    const rows = await this.request(`/rest/v1/product_events?${query}`, { method: 'GET' }) as Array<{
      event_id?: string | null
      event_name?: string
      event_properties?: JsonRecord
      event_source?: string | null
      firebase_uid?: string | null
      occurred_at?: string
    }>
    return rows.flatMap((row): AgentFlowProductEvent[] => {
      const properties = row.event_properties ?? {}
      const validation = validateAgentFlowEvent({
        eventId: row.event_id,
        event: typeof properties.contractEvent === 'string' ? properties.contractEvent : row.event_name,
        timestamp: row.occurred_at,
        userId: row.firebase_uid,
        projectId: typeof properties.projectId === 'string' ? properties.projectId : null,
        workspaceId: typeof properties.workspaceId === 'string' ? properties.workspaceId : null,
        metadata: properties,
        source: properties.integrationSource,
        version: properties.contractVersion,
      })
      if (!validation.valid) return []
      const productEvent = toProductEvent(validation.event)
      return productEvent ? [productEvent] : []
    })
  }

  async evaluateQualification(leadId: number): Promise<QualificationEvidence | undefined> {
    const rows = await this.request('/rest/v1/rpc/evaluate_lead_qualification', {
      method: 'POST', body: JSON.stringify({ p_lead_id: leadId, p_evaluation_type: 'runtime', p_source_runtime: 'agentflow-event' }),
    }) as QualificationEvidence[]
    return rows[0]
  }

  async evaluateHealth(accountId: string): Promise<CustomerHealthEvaluationResult | undefined> {
    const rows = await this.request('/rest/v1/rpc/evaluate_account_health', {
      method: 'POST', body: JSON.stringify({ p_account_id: accountId, p_evaluation_type: 'agentflow_event' }),
    }) as CustomerHealthEvaluationResult[]
    return rows[0]
  }

  async generateRevOpsSignals(accountId: string): Promise<readonly PersistedRevOpsSignal[]> {
    const rows = await this.request('/rest/v1/rpc/generate_revops_signals', {
      method: 'POST', body: JSON.stringify({ p_account_id: accountId, p_source: 'agentflow_event' }),
    }) as JsonRecord[]
    const now = new Date().toISOString()
    return rows.flatMap((row): PersistedRevOpsSignal[] => {
      if (typeof row.id !== 'string' || typeof row.signal_key !== 'string' || typeof row.signal_type !== 'string') return []
      return [{
        id: row.id,
        signalKey: row.signal_key,
        accountId,
        signalType: row.signal_type as PersistedRevOpsSignal['signalType'],
        status: String(row.status ?? 'pending') as PersistedRevOpsSignal['status'],
        priority: String(row.priority ?? 'medium') as PersistedRevOpsSignal['priority'],
        source: 'generate_revops_signals',
        createdAt: now,
      }]
    })
  }

  async enqueueWorkflowDispatch(
    eventId: string,
    workflowId: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const response = await fetch(`${this.config.url}/rest/v1/workflow_dispatch_outbox?on_conflict=event_id,workflow_id`, {
      method: 'POST',
      headers: {
        apikey: this.config.serviceRoleKey,
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({ event_id: eventId, workflow_id: workflowId, payload }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`supabase_dispatch_enqueue_failed:${response.status}`)
  }

  async claimWorkflowDispatches(eventId?: string, limit = 25): Promise<readonly WorkflowDispatchOutboxItem[]> {
    const rows = await this.request('/rest/v1/rpc/claim_workflow_dispatches', {
      method: 'POST',
      body: JSON.stringify({ p_event_id: eventId ?? null, p_limit: limit }),
    }) as Array<{
      id?: string
      event_id?: string
      workflow_id?: string
      payload?: JsonRecord
      retry_count?: number
    }>
    return rows.flatMap((row): WorkflowDispatchOutboxItem[] => {
      if (!row.id || !row.event_id || !row.workflow_id || !row.payload) return []
      return [{
        id: row.id,
        eventId: row.event_id,
        workflowId: row.workflow_id,
        payload: row.payload,
        retryCount: row.retry_count ?? 0,
      }]
    })
  }

  async resolveWorkflowDispatch(
    id: string,
    result: { succeeded: boolean; permanent: boolean; error?: string },
  ): Promise<void> {
    await this.request('/rest/v1/rpc/resolve_workflow_dispatch', {
      method: 'POST',
      body: JSON.stringify({
        p_id: id,
        p_succeeded: result.succeeded,
        p_permanent: result.permanent,
        p_error: result.error?.slice(0, 1_000) ?? null,
      }),
    })
  }
}
