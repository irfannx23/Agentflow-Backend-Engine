/* global fetch, AbortSignal */
import console from 'node:console'
import { createHmac } from 'node:crypto'
import process from 'node:process'

const secret = process.env.AGENTFLOW_INTEGRATION_SECRET
if (!secret) throw new Error('AGENTFLOW_INTEGRATION_SECRET is required')

const suffix = Date.now()
const event = {
  eventId: `remediation-login-${suffix}`,
  event: 'user.logged_in',
  timestamp: new Date().toISOString(),
  userId: `synthetic-remediation-${suffix}`,
  projectId: null,
  workspaceId: null,
  metadata: { provider: 'password', synthetic: true, purpose: 'remediation_e2e' },
  source: 'agentflow',
  version: '1.0',
}
const body = JSON.stringify(event)

async function send(label) {
  const timestamp = String(Math.floor(Date.now() / 1_000))
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  const response = await fetch('http://127.0.0.1:4310/v1/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agentflow-timestamp': timestamp,
      'x-agentflow-signature': signature,
    },
    body,
    signal: AbortSignal.timeout(20_000),
  })
  const result = await response.json()
  console.log(`${label}|HTTP_${response.status}|duplicate=${Boolean(result.stored?.duplicate)}|dispatches=${Array.isArray(result.dispatches) ? result.dispatches.length : 'unknown'}`)
}

await send('FIRST')
await send('REPLAY')
