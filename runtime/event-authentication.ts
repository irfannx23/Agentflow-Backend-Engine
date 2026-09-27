import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000

export function signEventBody(body: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function verifyEventSignature(input: {
  body: string
  timestamp: string | undefined
  signature: string | undefined
  secret: string
  now?: number
}): boolean {
  if (!input.timestamp || !input.signature || !/^\d+$/.test(input.timestamp)) return false
  const timestampMs = Number(input.timestamp) * 1_000
  if (!Number.isFinite(timestampMs) || Math.abs((input.now ?? Date.now()) - timestampMs) > MAX_CLOCK_SKEW_MS) return false
  const expected = signEventBody(input.body, input.timestamp, input.secret)
  if (expected.length !== input.signature.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature))
}
