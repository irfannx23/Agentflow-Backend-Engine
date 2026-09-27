export const WORKFLOW_DISPATCH_IDS = [
  'pre-crm.lead-qualification',
  'pre-crm.reply-to-deal',
  'revops.signal-orchestration',
] as const

export type WorkflowDispatchId = (typeof WORKFLOW_DISPATCH_IDS)[number]
export type WorkflowDispatchResult = {
  workflowId: WorkflowDispatchId
  status: 'dispatched' | 'skipped' | 'failed'
  statusCode?: number
  reason?: string
}

export interface WorkflowDispatcher {
  dispatch(workflowId: WorkflowDispatchId, payload: Readonly<Record<string, unknown>>): Promise<WorkflowDispatchResult>
}

const URL_VARIABLES: Record<WorkflowDispatchId, string> = {
  'pre-crm.lead-qualification': 'N8N_LEAD_QUALIFICATION_DISPATCH_URL',
  'pre-crm.reply-to-deal': 'N8N_REPLY_TO_DEAL_DISPATCH_URL',
  'revops.signal-orchestration': 'N8N_REVOPS_SIGNAL_DISPATCH_URL',
}

export class N8nWorkflowDispatcher implements WorkflowDispatcher {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  async dispatch(workflowId: WorkflowDispatchId, payload: Readonly<Record<string, unknown>>): Promise<WorkflowDispatchResult> {
    const variable = URL_VARIABLES[workflowId]
    const url = this.environment[variable]?.trim()
    if (!url) return { workflowId, status: 'skipped', reason: `missing_environment:${variable}` }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const secret = this.environment.N8N_DISPATCH_SECRET?.trim()
    if (secret) headers['X-AgentFlow-Dispatch-Secret'] = secret
    try {
      const response = await fetch(url, {
        method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000),
      })
      return response.ok
        ? { workflowId, status: 'dispatched', statusCode: response.status }
        : { workflowId, status: 'failed', statusCode: response.status, reason: 'n8n_response_not_ok' }
    } catch (error) {
      return { workflowId, status: 'failed', reason: error instanceof Error ? error.message : 'n8n_dispatch_failed' }
    }
  }
}
