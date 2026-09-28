# Supabase cleanup plan (no drops executed)

Classification: **A** core/keep, **B** derived reporting/keep, **C** legacy but referenced, **D** legacy and unreferenced, **E** duplicate/redundant, **F** investigate.

## Tables

- **A — CORE:** `abuse_events`, `product_events`, `staged_leads`, `lead_events`, `qualification_evaluations`, `sales_assignments`, `sales_assignment_history`, `outreach`, `sales_reps`, `internal_team`, `customer_health_evaluations`, `revops_signals`, `workflow_dispatch_outbox`, `spam_log`.
- **C — LEGACY BUT REFERENCED:** `profiles`, `accounts`, `account_members`, `account_plans`, `onboarding_responses`, `acquisition_touches`, `acquisition_creators`, `acquisition_partners`, `acquisition_referrals`, `usage_records`, `billing_transactions`, `budgets`, `cost_recommendations`, `product_alerts`, `provider_connections`, `provider_usage_limits`.
- **D — LEGACY AND UNREFERENCED:** none proven safe. Source search alone is insufficient because reporting views/functions reference the CostPilot-era tables.
- **E — DUPLICATE:** none proven at table level.

## Views

- **A — CORE:** `lead_qualification_signal_assembly`, `lead_current_qualification`, `sales_routing_signal_assembly`, `current_sales_queue`, `sdr_sales_queue`, `ae_sales_queue`, `unassigned_sales_queue`, `sales_handoff_queue`, `current_customer_health`, `revops_signal_queue`.
- **B — DERIVED/REPORTING:** `account_activation_state`, `account_health_signal_assembly`, `at_risk_accounts`, `customer_health_metrics`, `dormant_accounts`, `expansion_ready_accounts`, `hot_sales_leads`, `intervention_needed_accounts`, `payment_risk_accounts`, `recently_activated_accounts`, `acquisition_touch_lineage`, `acquisition_resolved_attribution`, `acquisition_channel_metrics`, `qualification_channel_metrics`, and every `gtm_*` view.
- **C — COST/PROVIDER REPORTING STILL REFERENCED:** `account_daily_spend_current_month`, `account_spend_summary_current_month`, `account_budget_status_current_month`, `account_current_plan`, `account_dashboard_overview`, `account_provider_spend_current_month`, `account_service_spend_current_month`.
- **E — POSSIBLY REDUNDANT:** optimized `gtm_*` summaries may overlap their assembly inputs, but dependency/performance testing is required before removal.

## Functions and RPCs

- **A — CORE LEAD/SALES:** `append_lead_event`, `capture_lead_acquisition_touches`, `count_abuse_since`, `count_events_since`, `count_leads_by_ip_since`, `evaluate_lead_qualification`, `get_or_create_lead`, `get_replied_outreach`, `insert_outreach`, `log_spam`, `mark_deal_created`, `mark_reply_deal_completed`, `mark_lead_blocked`, `mark_lead_emailed`, `mark_lead_unverified`, `mark_outreach_sent`, `mark_ready_to_push`, `override_sales_assignment`, `record_abuse`, `route_lead_to_sales`, `update_lead_score`, `update_sales_assignment_sync`.
- **A — CORE REVOPS:** `assign_pql_sales_owner`, `claim_revops_signal_step`, `evaluate_account_health`, `generate_revops_signals`, `record_revops_hubspot_step`, `record_revops_signal_outcome`, `record_revops_slack_step`, `resolve_revops_owner`, `revops_signal_owner_type`, `revops_signal_priority`, `upsert_revops_signal`.
- **A — DELIVERY:** `claim_workflow_dispatches`, `resolve_workflow_dispatch`.
- **C — SHARED LEGACY UTILITY:** `set_updated_at` (still required by 20 table triggers).

## Triggers, indexes, policies, constraints

- **A:** every `*_set_updated_at` trigger is required while its table remains. The new outbox trigger is core.
- **A:** primary keys, unique event/email/idempotency constraints, foreign keys, partial polling/queue indexes, and workflow lookup indexes.
- **B:** reporting/performance indexes supporting retained views.
- **C:** cost/budget/provider indexes and service-role policies remain required by currently referenced legacy tables.
- **F:** duplicate-looking composite indexes must be validated with `pg_stat_user_indexes` over a representative period before removal.
- RLS service-role policies are not cleanup candidates while n8n uses PostgREST.

## Candidate-object review

| Object | Type | Why it looks legacy | Current references | Data impact | Safe to remove? | Migration required? | Rollback |
|---|---|---|---|---|---|---|---|
| `profiles` | table | duplicates AgentFlow application profile concepts | product/account FKs, qualification and GTM views/RPCs | identity joins and history | **No** | dependency-removal migration first | restore joins/FKs and projection sync |
| `accounts` / `account_members` | tables | CostPilot account model | health, product events, RevOps, reporting | core RevOps account scope | **No** | ownership redesign first | restore account projection and FKs |
| cost/budget/provider table family | tables | CostPilot terminology and product domain | health/signal functions and reporting views | historical usage/billing intelligence | not yet | staged view/function rewrite | restore objects from migrations 16–41 |
| `gtm_*` views | views | broad reporting layer outside three workflows | downstream dashboards/other views may read them | reporting only, but unknown clients | not yet | usage evidence + ordered drops | recreate from fetched migrations |
| inactive CostPilot n8n workflows | n8n records | superseded by canonical workflows | inactive only | rollback/history | later, with approval | n8n export/record removal | import remediation snapshot |

## Backend `public.profiles` ownership decision

Backend `profiles` is **not** the authentication authority and active event ingestion does not create/update it. Firebase plus AgentFlow application data should remain authoritative. However, backend `profiles` is still operationally referenced by foreign keys, qualification/account views, acquisition attribution, and sales routing. RevOps depends on it indirectly through those projections; Lead Qualification can operate without a profile row initially but its downstream views/RPCs include `profile_id`.

Decision: retain it as a **deprecated backend projection** for now. Before a future drop: remove or replace every FK/view/RPC dependency, migrate required profile/account joins to stable external identity keys, verify all three workflows, then create a separately approved drop migration. It is not safe to delete in this pass.
