import { toAutomationEngineError } from '../core/errors.js'

export type LogFields = Readonly<Record<string, string | number | boolean | null>>

export type EngineLogger = {
  info(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
}

export type EngineMetrics = {
  increment(name: string, labels?: LogFields): void
  observe(name: string, value: number, labels?: LogFields): void
}

export const NOOP_LOGGER: EngineLogger = { info() {}, error() {} }
export const NOOP_METRICS: EngineMetrics = { increment() {}, observe() {} }

export type OperationContext = {
  operation: string
  workflowId?: string
  executionId?: string
}

export async function withExecutionTelemetry<T>(
  context: OperationContext,
  operation: () => Promise<T>,
  dependencies: { logger?: EngineLogger; metrics?: EngineMetrics; clock?: () => number } = {},
): Promise<T> {
  const logger = dependencies.logger ?? NOOP_LOGGER
  const metrics = dependencies.metrics ?? NOOP_METRICS
  const clock = dependencies.clock ?? Date.now
  const fields: LogFields = {
    operation: context.operation,
    workflowId: context.workflowId ?? null,
    executionId: context.executionId ?? null,
  }
  const startedAt = clock()
  logger.info('engine.operation.started', fields)
  metrics.increment('engine_operation_started_total', fields)

  try {
    const result = await operation()
    const durationMs = Math.max(0, clock() - startedAt)
    logger.info('engine.operation.completed', { ...fields, durationMs })
    metrics.increment('engine_operation_completed_total', fields)
    metrics.observe('engine_operation_duration_ms', durationMs, fields)
    return result
  } catch (error) {
    const normalized = toAutomationEngineError(error)
    const durationMs = Math.max(0, clock() - startedAt)
    logger.error('engine.operation.failed', { ...fields, durationMs, code: normalized.code, retryable: normalized.retryable })
    metrics.increment('engine_operation_failed_total', { ...fields, code: normalized.code })
    metrics.observe('engine_operation_duration_ms', durationMs, fields)
    throw normalized
  }
}
