import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'

import {
  AGENTFLOW_EVENT_NAMES,
  validateAgentFlowEvent,
  type AgentFlowEvent,
} from '../core/events/agentflow-event.js'
import type { CustomerHealthEvaluationResult } from '../core/revops/contracts/retention-contract.js'
import type { PersistedRevOpsSignal } from '../core/revops/contracts/database-signals.js'
import type { QualificationEvidence } from '../core/revops/contracts/qualification-intelligence.js'
import { toProductEvent } from '../core/events/agentflow-event.js'
import type { AgentFlowProductEvent } from '../core/product-signals.js'
import { signEventBody, verifyEventSignature } from '../runtime/event-authentication.js'
import { EventPipeline, type EventPipelineLogger } from '../runtime/event-pipeline.js'
import { createEventRequestHandler } from '../runtime/event-server.js'
import { registrationEventToLeadPayload } from '../runtime/lead-ingestion-adapter.js'
import type { WorkflowDispatcher, WorkflowDispatchId, WorkflowDispatchResult } from '../runtime/n8n-dispatcher.js'
import { SupabaseIntelligenceStore, type IntelligenceStore, type StoredEvent, type WorkflowDispatchOutboxItem } from '../runtime/supabase-event-store.js'

class MemoryStore implements IntelligenceStore {
  readonly events: AgentFlowEvent[] = []
  readonly outbox = new Map<string, WorkflowDispatchOutboxItem & { status: 'pending' | 'processing' | 'succeeded' | 'permanent_failed' }>()
  async persistEvent(event: AgentFlowEvent): Promise<StoredEvent> {
    const duplicate = this.events.some((entry) => entry.eventId === event.eventId)
    if (!duplicate) this.events.push(event)
    return { id: event.eventId, duplicate }
  }
  async loadProductEvents(): Promise<readonly AgentFlowProductEvent[]> {
    return this.events.flatMap(entry => {
      const productEvent = toProductEvent(entry)
      return productEvent ? [productEvent] : []
    })
  }
  async evaluateQualification(): Promise<QualificationEvidence | undefined> { return undefined }
  async evaluateHealth(): Promise<CustomerHealthEvaluationResult | undefined> { return undefined }
  async generateRevOpsSignals(): Promise<readonly PersistedRevOpsSignal[]> { return [] }
  async enqueueWorkflowDispatch(eventId: string, workflowId: string, payload: Readonly<Record<string, unknown>>): Promise<void> {
    const key = `${eventId}:${workflowId}`
    if (!this.outbox.has(key)) this.outbox.set(key, { id: key, eventId, workflowId, payload, retryCount: 0, status: 'pending' })
  }
  async claimWorkflowDispatches(eventId?: string): Promise<readonly WorkflowDispatchOutboxItem[]> {
    return [...this.outbox.values()].filter((item) => item.status === 'pending' && (!eventId || item.eventId === eventId)).map((item) => {
      item.status = 'processing'
      item.retryCount += 1
      return item
    })
  }
  async resolveWorkflowDispatch(id: string, result: { succeeded: boolean; permanent: boolean }): Promise<void> {
    const item = this.outbox.get(id)
    if (item) item.status = result.succeeded ? 'succeeded' : result.permanent ? 'permanent_failed' : 'pending'
  }
}

class MemoryDispatcher implements WorkflowDispatcher {
  readonly calls: Array<{ workflowId: WorkflowDispatchId; payload: Readonly<Record<string, unknown>> }> = []
  async dispatch(workflowId: WorkflowDispatchId, payload: Readonly<Record<string, unknown>>): Promise<WorkflowDispatchResult> {
    this.calls.push({ workflowId, payload })
    return { workflowId, status: 'dispatched', statusCode: 200 }
  }
}

class MemoryLogger implements EventPipelineLogger {
  readonly stages: string[] = []
  info(stage: string): void { this.stages.push(stage) }
  error(stage: string): void { this.stages.push(stage) }
}

function event(name: AgentFlowEvent['event'], index: number): AgentFlowEvent {
  return {
    eventId: `event-${index}`,
    event: name,
    timestamp: `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    userId: 'firebase-user-1',
    projectId: name.startsWith('user.') ? null : 'project-1',
    workspaceId: 'workspace-1',
    metadata: name === 'workflow.generated'
      ? { isFirst: true, nodeCount: 12 }
      : name === 'user.registered'
        ? { email: 'new.user@example.test', displayName: 'New User', provider: 'password' }
        : {},
    source: 'agentflow',
    version: '1.0',
  }
}

test('event contract accepts every implemented AgentFlow event and rejects malformed input', () => {
  for (const [index, name] of AGENTFLOW_EVENT_NAMES.entries()) {
    const result = validateAgentFlowEvent(event(name, index))
    assert.equal(result.valid, true, name)
  }
  const invalid = validateAgentFlowEvent({ ...event('project.created', 1), userId: '', version: '2.0' })
  assert.equal(invalid.valid, false)
  if (!invalid.valid) assert.deepEqual(invalid.errors, ['event_user_id_invalid', 'event_version_unsupported'])
})

test('event signatures authenticate the exact body and reject replayed or modified payloads', () => {
  const body = JSON.stringify(event('user.logged_in', 1))
  const timestamp = '1790496000'
  const secret = 'local-integration-secret'
  const signature = signEventBody(body, timestamp, secret)
  assert.equal(verifyEventSignature({ body, timestamp, signature, secret, now: 1_790_496_000_000 }), true)
  assert.equal(verifyEventSignature({ body: `${body} `, timestamp, signature, secret, now: 1_790_496_000_000 }), false)
  assert.equal(verifyEventSignature({ body, timestamp, signature, secret, now: 1_790_496_400_001 }), false)
})

test('registration adapter maps only real signup fields into the existing lead contract', () => {
  const payload = registrationEventToLeadPayload(event('user.registered', 1))
  assert.ok(payload)
  assert.equal(payload.email, 'new.user@example.test')
  assert.equal(payload.name, 'New User')
  assert.equal(payload.event_id, 'event-1')
  assert.equal(payload.source, 'agentflow_signup')
  assert.equal(payload.source_type, 'inbound')
  assert.equal(payload.raw_payload.firebase_user_id, 'firebase-user-1')
  assert.equal('firebaseCredential' in payload.raw_payload, false)
  assert.equal('idToken' in payload.raw_payload, false)
})

test('registration dispatches Lead Qualification once, replay is suppressed, and login never dispatches it', async () => {
  const store = new MemoryStore()
  const dispatcher = new MemoryDispatcher()
  const pipeline = new EventPipeline(store, dispatcher, new MemoryLogger())
  const registration = event('user.registered', 1)
  await pipeline.process(registration)
  await pipeline.process(registration)
  await pipeline.process(event('user.logged_in', 2))
  const leadCalls = dispatcher.calls.filter((call) => call.workflowId === 'pre-crm.lead-qualification')
  assert.equal(leadCalls.length, 1)
  assert.equal(leadCalls[0]?.payload.email, 'new.user@example.test')
})

test('failed dispatch remains pending and a duplicate event safely retries without duplicate side effects', async () => {
  const store = new MemoryStore()
  let attempt = 0
  const dispatcher: WorkflowDispatcher = {
    async dispatch(workflowId) {
      attempt += 1
      return attempt === 1
        ? { workflowId, status: 'failed', statusCode: 503, reason: 'temporary_failure' }
        : { workflowId, status: 'dispatched', statusCode: 200 }
    },
  }
  const pipeline = new EventPipeline(store, dispatcher, new MemoryLogger())
  const registration = event('user.registered', 8)
  const first = await pipeline.process(registration)
  const replay = await pipeline.process(registration)
  assert.equal(first.dispatches[0]?.status, 'failed')
  assert.equal(replay.dispatches[0]?.status, 'dispatched')
  assert.equal(store.events.length, 1)
  assert.equal(store.outbox.size, 1)
})

test('registration dispatch tolerates missing optional profile fields', async () => {
  const store = new MemoryStore()
  const dispatcher = new MemoryDispatcher()
  const pipeline = new EventPipeline(store, dispatcher, new MemoryLogger())
  const registration = { ...event('user.registered', 3), metadata: { email: 'minimal@example.test' } }
  await pipeline.process(registration)
  assert.equal(dispatcher.calls.length, 1)
  assert.equal(dispatcher.calls[0]?.workflowId, 'pre-crm.lead-qualification')
  assert.equal('name' in dispatcher.calls[0]!.payload, false)
})

test('HTTP endpoint authenticates and receives an event before running the backend pipeline', async () => {
  const store = new MemoryStore()
  const pipeline = new EventPipeline(store, new MemoryDispatcher(), new MemoryLogger())
  const secret = 'http-integration-secret'
  const server = createServer(createEventRequestHandler({ pipeline, integrationSecret: secret }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const body = JSON.stringify(event('project.created', 1))
    const timestamp = String(Math.floor(Date.now() / 1_000))
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agentflow-timestamp': timestamp,
        'x-agentflow-signature': signEventBody(body, timestamp, secret),
      },
      body,
    })
    assert.equal(response.status, 202)
    assert.equal(store.events.length, 1)
    assert.equal(store.events[0]?.event, 'project.created')
  } finally {
    server.close()
    await once(server, 'close')
  }
})

test('Supabase persistence adapts the canonical source to the existing product_events vocabulary', async () => {
  const originalFetch = globalThis.fetch
  let capturedBody: Record<string, unknown> | undefined
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json([{ id: 1 }], { status: 201 })
  }
  try {
    const store = new SupabaseIntelligenceStore({ url: 'https://example.supabase.co', serviceRoleKey: 'placeholder-for-test' })
    await store.persistEvent(event('user.logged_in', 1))
    assert.equal(capturedBody?.event_source, 'web_app')
    assert.equal(capturedBody?.event_trust_level, 'trusted')
    assert.equal((capturedBody?.event_properties as Record<string, unknown>).integrationSource, 'agentflow')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('local end-to-end journey stores events, evaluates signals, dispatches workflows, and logs every stage', async () => {
  const store = new MemoryStore()
  const dispatcher = new MemoryDispatcher()
  const logger = new MemoryLogger()
  const pipeline = new EventPipeline(store, dispatcher, logger)
  const journey: AgentFlowEvent['event'][] = [
    'user.logged_in',
    'project.created',
    'workflow.generated',
    'workflow.downloaded',
    'workflow.repaired',
    'workflow.imported',
    'project.archived',
  ]

  const results = []
  for (const [index, name] of journey.entries()) results.push(await pipeline.process(event(name, index)))

  assert.equal(store.events.length, journey.length, 'Supabase storage adapter boundary received every event')
  assert.ok(results.some((result) => result.intelligence.signals.runtime.length > 0), 'signals were evaluated')
  assert.ok(dispatcher.calls.length >= 5, 'signal-producing events dispatched n8n')
  assert.ok(dispatcher.calls.every((call) => call.workflowId === 'revops.signal-orchestration'))
  for (const stage of ['event.incoming', 'event.validation', 'event.stored', 'event.qualification', 'event.signals', 'event.dispatch', 'event.completed']) {
    assert.ok(logger.stages.includes(stage), stage)
  }
  assert.equal(results.at(-1)?.event.event, 'project.archived')
})
