export const SALES_ROUTING_RULE_VERSION = 'phase5_v1' as const

export const SALES_OWNER_TYPES = ['sdr', 'ae'] as const
export const SALES_ROUTING_STATUSES = [
  'pending',
  'assigned',
  'unassigned',
  'handoff_pending',
  'handed_off',
  'retry_required',
  'manually_overridden',
] as const

export const SALES_SYNC_STATUSES = [
  'not_started',
  'pending',
  'synced',
  'retry_required',
  'failed',
  'not_applicable',
] as const

export const SALES_SEGMENTS = ['smb', 'mid_market', 'enterprise', 'unknown'] as const
export const SALES_GEOGRAPHIES = ['north_america', 'europe', 'global', 'unknown'] as const

export type SalesOwnerType = (typeof SALES_OWNER_TYPES)[number]
export type SalesRoutingStatus = (typeof SALES_ROUTING_STATUSES)[number]
export type SalesSyncStatus = (typeof SALES_SYNC_STATUSES)[number]
export type SalesSegment = (typeof SALES_SEGMENTS)[number]
export type SalesGeography = (typeof SALES_GEOGRAPHIES)[number]

export type SalesRoutingDecision = {
  assignment_id: string
  lead_id: number
  profile_id: string | null
  account_id: string | null
  qualification_evaluation_id: string | null
  current_rep_id: string | null
  current_owner_type: SalesOwnerType | null
  routing_status: SalesRoutingStatus
  routing_reason: string
  segment: SalesSegment | null
  geography: SalesGeography | null
  priority_tier: 'urgent' | 'high' | 'medium' | 'low' | null
  priority_score: number
  crm_sync_status: SalesSyncStatus
  slack_sync_status: SalesSyncStatus
  evaluated_at: string
}
