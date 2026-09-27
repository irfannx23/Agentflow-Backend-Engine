import type { AgentFlowEvent } from '../core/events/agentflow-event.js'
import { toProductEvent } from '../core/events/agentflow-event.js'
import { compilePreCrmExecutionAudit, type PreCrmExecutionAudit } from '../core/pre-crm/contracts/pre-crm-engine.js'
import type { IntelligenceEngineResult } from './intelligence-engine.js'
import { evaluateBackendIntelligence } from './intelligence-engine.js'
import type { IntelligenceStore, StoredEvent } from './supabase-event-store.js'
import type { WorkflowDispatcher, WorkflowDispatchResult } from './n8n-dispatcher.js'

export type EventPipelineLogger = {
  info(stage: string, context: Readonly<Record<string, unknown>>): void
  error(stage: string, context: Readonly<Record<string, unknown>>): void
}

export type EventPipelineResult = {
  event: AgentFlowEvent
  stored: StoredEvent
  preCrm: PreCrmExecutionAudit | null
  intelligence: IntelligenceEngineResult
  dispatches: readonly WorkflowDispatchResult[]
}

function numberMetadata(event: AgentFlowEvent, key: string): number | undefined {
  const value = event.metadata[key]
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function stringMetadata(event: AgentFlowEvent, key: string): string | undefined {
  const value = event.metadata[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export class EventPipeline {
  constructor(
    private readonly store: IntelligenceStore,
    private readonly dispatcher: WorkflowDispatcher,
    private readonly logger: EventPipelineLogger = console,
  ) {}

  async process(event: AgentFlowEvent): Promise<EventPipelineResult> {
    this.logger.info('event.incoming', { eventId: event.eventId, event: event.event })
    this.logger.info('event.validation', { eventId: event.eventId, valid: true })
    const stored = await this.store.persistEvent(event)
    this.logger.info('event.stored', { eventId: event.eventId, duplicate: stored.duplicate })

    const accountId = stringMetadata(event, 'accountId')
    const leadId = numberMetadata(event, 'leadId')
    const [qualification, health, persistedSignals, productEvents] = await Promise.all([
      leadId ? this.store.evaluateQualification(leadId) : undefined,
      accountId ? this.store.evaluateHealth(accountId) : undefined,
      accountId ? this.store.generateRevOpsSignals(accountId) : [],
      this.store.loadProductEvents(event),
    ])
    this.logger.info('event.qualification', { eventId: event.eventId, evaluated: Boolean(qualification) })

    const intelligence = evaluateBackendIntelligence({
      qualification,
      health,
      persistedSignals,
      productEvents: productEvents.length ? productEvents : (toProductEvent(event) ? [toProductEvent(event)!] : []),
      planStatus: stringMetadata(event, 'planStatus') ?? null,
    })
    const generatedSignals = [...intelligence.signals.runtime, ...intelligence.signals.database]
    const actionableSignals = [
      ...intelligence.signals.runtime.filter((signal) => signal.sourceEventIds.includes(event.eventId)),
      ...intelligence.signals.database,
    ]
    this.logger.info('event.signals', { eventId: event.eventId, count: generatedSignals.length, actionable: actionableSignals.length })

    const preCrm = qualification && leadId
      ? compilePreCrmExecutionAudit({
          leadId,
          eventId: event.eventId,
          evaluatedAt: qualification.evaluated_at,
          results: [],
          crmReady: qualification.crm_ready,
          outboundReady: qualification.outbound_ready,
        })
      : null

    const dispatches: WorkflowDispatchResult[] = []
    if (!stored.duplicate && actionableSignals.length > 0) {
      dispatches.push(await this.dispatcher.dispatch('revops.signal-orchestration', {
        event,
        signalIds: actionableSignals.map((signal) => signal.definitionId),
        accountId: accountId ?? event.workspaceId,
      }))
    }
    this.logger.info('event.dispatch', { eventId: event.eventId, dispatches: dispatches.map((entry) => `${entry.workflowId}:${entry.status}`) })
    this.logger.info('event.completed', { eventId: event.eventId })
    return { event, stored, preCrm, intelligence, dispatches }
  }
}
