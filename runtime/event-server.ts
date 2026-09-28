import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { validateAgentFlowEvent } from '../core/events/agentflow-event.js'
import { EventPipeline } from './event-pipeline.js'
import { verifyEventSignature } from './event-authentication.js'
import { N8nWorkflowDispatcher } from './n8n-dispatcher.js'
import { SupabaseIntelligenceStore } from './supabase-event-store.js'

const MAX_BODY_BYTES = 256 * 1_024

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('event_body_too_large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createEventRequestHandler(options: {
  pipeline: EventPipeline
  integrationSecret: string
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (request.method === 'GET' && url.pathname === '/health') {
      json(response, 200, { ok: true, service: 'agentflow-backend-engine' })
      return
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/events') {
      json(response, 404, { error: 'not_found' })
      return
    }
    try {
      const body = await readBody(request)
      const authenticated = verifyEventSignature({
        body,
        timestamp: request.headers['x-agentflow-timestamp'] as string | undefined,
        signature: request.headers['x-agentflow-signature'] as string | undefined,
        secret: options.integrationSecret,
      })
      if (!authenticated) {
        json(response, 401, { error: 'invalid_event_signature' })
        return
      }
      let payload: unknown
      try {
        payload = JSON.parse(body)
      } catch {
        json(response, 400, { error: 'invalid_json' })
        return
      }
      const validation = validateAgentFlowEvent(payload)
      if (!validation.valid) {
        json(response, 422, { error: 'invalid_event', details: validation.errors })
        return
      }
      const result = await options.pipeline.process(validation.event)
      json(response, 202, result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'event_processing_failed'
      console.error('event.failed', { message })
      json(response, message === 'event_body_too_large' ? 413 : 500, { error: message })
    }
  }
}

export function startEventServer(environment: NodeJS.ProcessEnv = process.env): void {
  const integrationSecret = environment.AGENTFLOW_INTEGRATION_SECRET?.trim()
  if (!integrationSecret) throw new Error('missing_environment_configuration:AGENTFLOW_INTEGRATION_SECRET')
  const port = Number(environment.ENGINE_PORT ?? 4310)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('invalid_engine_port')
  const pipeline = new EventPipeline(new SupabaseIntelligenceStore(), new N8nWorkflowDispatcher(environment))
  const retryTimer = setInterval(() => {
    void pipeline.retryPendingDispatches().catch((error: unknown) => {
      console.error('dispatch.retry.failed', { message: error instanceof Error ? error.message : 'unknown_error' })
    })
  }, 15_000)
  retryTimer.unref()
  createServer(createEventRequestHandler({ pipeline, integrationSecret })).listen(port, '127.0.0.1', () => {
    console.info('event.server.started', { port, host: '127.0.0.1' })
  })
}
