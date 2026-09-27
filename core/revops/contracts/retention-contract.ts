export const RETENTION_RULE_VERSION = 'phase7_v1' as const

export const CUSTOMER_HEALTH_STATES = ['healthy', 'watch', 'at_risk', 'critical'] as const
export const CUSTOMER_LIFECYCLE_STATES = ['new', 'onboarding', 'newly_activated', 'activated', 'low_adoption', 'dormant', 'churned'] as const
export const CUSTOMER_CHURN_RISKS = ['low', 'medium', 'high', 'critical'] as const
export const CUSTOMER_EXPANSION_STATES = ['none', 'watch', 'expansion_candidate', 'upgrade_ready', 'sales_followup'] as const

export type CustomerHealthState = (typeof CUSTOMER_HEALTH_STATES)[number]
export type CustomerLifecycleState = (typeof CUSTOMER_LIFECYCLE_STATES)[number]
export type CustomerChurnRisk = (typeof CUSTOMER_CHURN_RISKS)[number]
export type CustomerExpansionState = (typeof CUSTOMER_EXPANSION_STATES)[number]

export type CustomerHealthEvaluationResult = {
  evaluation_id: string
  account_id: string
  health_score: number
  health_state: CustomerHealthState
  lifecycle_state: CustomerLifecycleState
  churn_risk: CustomerChurnRisk
  expansion_score: number
  expansion_state: CustomerExpansionState
  recommended_action: string
  recommended_lead_id: number | null
  recommended_owner_type: 'sdr' | 'ae' | null
  authoritative_churned: boolean
  needs_intervention: boolean
  evaluated_at: string
}
