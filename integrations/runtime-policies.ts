import type { RuntimePolicy } from '../core/types.js'

export const READ_HTTP_POLICY: RuntimePolicy = {
  timeoutMs: 30_000,
  retry: { enabled: true, maxAttempts: 3, waitBetweenAttemptsMs: 1_000, retrySafe: true },
  errorMode: 'stop',
}

export const IDEMPOTENT_WRITE_HTTP_POLICY: RuntimePolicy = {
  timeoutMs: 30_000,
  retry: { enabled: true, maxAttempts: 3, waitBetweenAttemptsMs: 1_000, retrySafe: true },
  errorMode: 'stop',
}

export const NON_IDEMPOTENT_WRITE_HTTP_POLICY: RuntimePolicy = {
  timeoutMs: 30_000,
  retry: { enabled: false, maxAttempts: 1, waitBetweenAttemptsMs: 0, retrySafe: false },
  errorMode: 'stop',
}

export const LOCAL_SERVICE_POLICY: RuntimePolicy = {
  timeoutMs: 10_000,
  retry: { enabled: true, maxAttempts: 2, waitBetweenAttemptsMs: 250, retrySafe: true },
  errorMode: 'stop',
}
