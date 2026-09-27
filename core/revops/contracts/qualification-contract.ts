export const QUALIFICATION_RULE_VERSION = 'phase4_v1' as const

export const QUALIFICATION_EVALUATION_TYPES = [
  'runtime',
  'verification_failed',
  'jurisdiction_blocked',
  'score_update',
  'outbound_ready',
  'outreach_sent',
  'nurture_sent',
  'deal_created',
] as const

export const MQL_STATUSES = ['qualified', 'nurture', 'disqualified'] as const
export const SQL_STATUSES = ['sales_ready', 'awaiting_engagement', 'nurture', 'disqualified'] as const
export const PQL_STATUSES = ['insufficient_product_signals', 'product_qualified', 'product_activated'] as const
export const PRIORITY_TIERS = ['urgent', 'high', 'medium', 'low'] as const

export type QualificationEvaluationType = (typeof QUALIFICATION_EVALUATION_TYPES)[number]
export type MqlStatus = (typeof MQL_STATUSES)[number]
export type SqlStatus = (typeof SQL_STATUSES)[number]
export type PqlStatus = (typeof PQL_STATUSES)[number]
export type PriorityTier = (typeof PRIORITY_TIERS)[number]

export type QualificationEvaluationResult = {
  evaluation_id: string
  lead_id: number | null
  profile_id: string | null
  account_id: string | null
  fit_score: number | null
  buying_intent: 'high' | 'medium' | 'low' | null
  mql_status: MqlStatus
  sql_status: SqlStatus
  pql_status: PqlStatus
  crm_ready: boolean
  outbound_ready: boolean
  priority_score: number
  priority_tier: PriorityTier
  explanation: string
  evaluated_at: string
}

export type QualificationSignalRequirements = {
  current_product_events: readonly ['signup', 'login', 'onboarding_started', 'onboarding_completed', 'dashboard_viewed']
  future_pql_events: readonly ['provider_connected', 'usage_synced', 'insight_generated', 'budget_created', 'alert_configured']
}

export const QUALIFICATION_SIGNAL_REQUIREMENTS: QualificationSignalRequirements = {
  current_product_events: ['signup', 'login', 'onboarding_started', 'onboarding_completed', 'dashboard_viewed'],
  future_pql_events: ['provider_connected', 'usage_synced', 'insight_generated', 'budget_created', 'alert_configured'],
}
