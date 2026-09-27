# Integration Guide

All credentials are runtime environment references. No adapter accepts a literal secret. HTTP parameter generation uses the integration registry's timeout, retry, error, and credential policies.

## Hookdeck

Webhook ingress for Lead Qualification. Configure `HOOKDECK_SOURCE_URL`; API and signing keys are optional runtime secrets. Verify signatures and deduplicate delivery IDs when enabled.

## Supabase

Existing persistence and RPC authority for all three workflows. `SUPABASE_URL` and server-only `SUPABASE_SERVICE_ROLE_KEY` are required. RPC names and payload contracts must already exist; the engine never creates schema.

## Emailable

Email verification uses `EMAIL_VERIFY_BASE_URL` and secret `EMAIL_VERIFY_API_KEY`. Normalize provider verdicts before qualification.

## MX Service

Local fallback validation using `MX_SERVICE_PORT`. It has no credential and fails closed on DNS errors.

## Apollo

Firmographic enrichment uses `ENRICH_BASE_URL` and secret `ENRICH_API_KEY`. A normalized domain is required and response fields are allowlisted.

## Google Gemini

Structured qualification and content generation uses `GEMINI_ENDPOINT`, optional `GEMINI_MODEL`, and secret `GEMINI_API_KEY`. Responses must satisfy the existing structured contract.

## HubSpot

Contact, deal, and lifecycle synchronization uses `HUBSPOT_BASE_URL` and server-only `HUBSPOT_ACCESS_TOKEN`. Existing object and workflow behavior remains authoritative.

## Slack

Operational notifications use secret `SLACK_WEBHOOK_URL`. Payloads must not contain credentials or unrestricted source payloads.

## Brevo

Qualified outreach and nurture delivery uses `BREVO_BASE_URL`, verified sender variables, and secret `BREVO_API_KEY`. Existing eligibility gates run before delivery.

## LiteLLM

Optional private model gateway using secret `LITELLM_MASTER_KEY`. It is registered for extension but is not inserted into migrated workflows.

## DeepSeek

Optional provider behind the model gateway using `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, and secret `DEEPSEEK_API_KEY`. It is registered for extension but is not inserted into migrated workflows.
