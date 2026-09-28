import type { AgentFlowEvent } from '../core/events/agentflow-event.js'
import { toProductEvent } from '../core/events/agentflow-event.js'
import { compilePreCrmExecutionAudit, type PreCrmExecutionAudit } from '../core/pre-crm/contracts/pre-crm-engine.js'
import type { IntelligenceEngineResult } from './intelligence-engine.js'
import { evaluateBackendIntelligence } from './intelligence-engine.js'
import type { IntelligenceStore, StoredEvent } from './supabase-event-store.js'
import type { WorkflowDispatcher, WorkflowDispatchResult } from './n8n-dispatcher.js'
import { registrationEventToLeadPayload } from './lead-ingestion-adapter.js'
import { WORKFLOW_DISPATCH_IDS, type WorkflowDispatchId } from './n8n-dispatcher.js'

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

  private async dispatchClaimed(eventId?: string): Promise<WorkflowDispatchResult[]> {
    const claimed = await this.store.claimWorkflowDispatches(eventId)
    const results: WorkflowDispatchResult[] = []
    for (const item of claimed) {
      if (!WORKFLOW_DISPATCH_IDS.includes(item.workflowId as WorkflowDispatchId)) {
        await this.store.resolveWorkflowDispatch(item.id, {
          succeeded: false,
          permanent: true,
          error: `unknown_workflow:${item.workflowId}`,
        })
        continue
      }
      const result = await this.dispatcher.dispatch(item.workflowId as WorkflowDispatchId, item.payload)
      results.push(result)
      const permanent = result.status === 'skipped'
        || (typeof result.statusCode === 'number' && result.statusCode >= 400 && result.statusCode < 500 && result.statusCode !== 408 && result.statusCode !== 429)
        || item.retryCount >= 7
      await this.store.resolveWorkflowDispatch(item.id, {
        succeeded: result.status === 'dispatched',
        permanent,
        error: result.reason ?? (result.statusCode ? `http_${result.statusCode}` : undefined),
      })
    }
    return results
  }

  async retryPendingDispatches(): Promise<readonly WorkflowDispatchResult[]> {
    return this.dispatchClaimed()
  }

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

    const registrationLead = registrationEventToLeadPayload(event)
    if (registrationLead) {
      await this.store.enqueueWorkflowDispatch(event.eventId, 'pre-crm.lead-qualification', registrationLead)
    }
    if (actionableSignals.length > 0) {
      await this.store.enqueueWorkflowDispatch(event.eventId, 'revops.signal-orchestration', {
        event,
        signalIds: actionableSignals.map((signal) => signal.definitionId),
        accountId: accountId ?? event.workspaceId,
      })
    }
    const dispatches = await this.dispatchClaimed(event.eventId)
    this.logger.info('event.dispatch', { eventId: event.eventId, dispatches: dispatches.map((entry) => `${entry.workflowId}:${entry.status}`) })
    this.logger.info('event.completed', { eventId: event.eventId })
    return { event, stored, preCrm, intelligence, dispatches }
  }
}
