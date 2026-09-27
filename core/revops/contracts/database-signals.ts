import type { RevOpsSignalCategory, SignalPriority } from '../../product-signals.js'

export const DATABASE_REVOPS_SIGNAL_TYPES = [
  'PQL_REACHED',
  'EXPANSION_CANDIDATE',
  'ACCOUNT_AT_RISK',
  'HIGH_CHURN_RISK',
  'UPGRADE_INTENT',
  'BUDGET_PRESSURE',
  'ALLOWANCE_PRESSURE',
  'SIGNIFICANT_USAGE_GROWTH',
  'MEANINGFUL_INACTIVITY',
  'SUBSCRIPTION_ACTIVATED',
] as const

export type DatabaseRevOpsSignalType = (typeof DATABASE_REVOPS_SIGNAL_TYPES)[number]

export type PersistedRevOpsSignal = {
  id: string
  signalKey: string
  accountId: string
  leadId?: number
  signalType: DatabaseRevOpsSignalType
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'dismissed'
  priority: SignalPriority
  source: string
  createdAt: string
}

export type DatabaseSignalDefinition = {
  signalType: DatabaseRevOpsSignalType
  definitionId: string
  category: RevOpsSignalCategory
  sourceCapability: string
  derivation: string
}

export const DATABASE_SIGNAL_DEFINITIONS = [
  { signalType: 'PQL_REACHED', definitionId: 'database.pql-reached', category: 'revenue', sourceCapability: 'qualification_evaluations', derivation: 'Existing generate_revops_signals RPC and qualification state.' },
  { signalType: 'EXPANSION_CANDIDATE', definitionId: 'database.expansion-candidate', category: 'expansion', sourceCapability: 'current_customer_health', derivation: 'Existing account health expansion state.' },
  { signalType: 'ACCOUNT_AT_RISK', definitionId: 'database.account-at-risk', category: 'risk', sourceCapability: 'current_customer_health', derivation: 'Existing persisted account health state.' },
  { signalType: 'HIGH_CHURN_RISK', definitionId: 'database.high-churn-risk', category: 'risk', sourceCapability: 'current_customer_health', derivation: 'Existing persisted churn-risk evaluation.' },
  { signalType: 'UPGRADE_INTENT', definitionId: 'database.upgrade-intent', category: 'revenue', sourceCapability: 'product_events', derivation: 'Existing upgrade-request and account-health signals.' },
  { signalType: 'BUDGET_PRESSURE', definitionId: 'database.budget-pressure', category: 'risk', sourceCapability: 'account_budget_status_current_month', derivation: 'Existing budget and projected-spend evaluation.' },
  { signalType: 'ALLOWANCE_PRESSURE', definitionId: 'database.allowance-pressure', category: 'risk', sourceCapability: 'provider_usage_limits', derivation: 'Existing provider usage-limit evaluation.' },
  { signalType: 'SIGNIFICANT_USAGE_GROWTH', definitionId: 'database.significant-usage-growth', category: 'usage-intelligence', sourceCapability: 'account_health_signal_assembly', derivation: 'Existing trailing-versus-prior usage evaluation.' },
  { signalType: 'MEANINGFUL_INACTIVITY', definitionId: 'database.meaningful-inactivity', category: 'retention', sourceCapability: 'account_health_signal_assembly', derivation: 'Existing product, login, sync, and usage recency evaluation.' },
  { signalType: 'SUBSCRIPTION_ACTIVATED', definitionId: 'database.subscription-activated', category: 'activation', sourceCapability: 'account_plans', derivation: 'Existing subscription activation state.' },
] as const satisfies readonly DatabaseSignalDefinition[]
