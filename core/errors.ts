export type EngineErrorContext = Readonly<Record<string, string | number | boolean | null>>

export class AutomationEngineError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly context: EngineErrorContext

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; context?: EngineErrorContext; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'AutomationEngineError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.context = options.context ?? {}
  }
}

export function toAutomationEngineError(error: unknown, code = 'engine_operation_failed'): AutomationEngineError {
  if (error instanceof AutomationEngineError) return error
  return new AutomationEngineError(code, error instanceof Error ? error.message : String(error), { cause: error })
}
