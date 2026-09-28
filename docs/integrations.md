# Integration Guide

All credentials are runtime environment references. No adapter accepts a literal secret. HTTP parameter generation uses the integration registry's timeout, retry, error, and credential policies.

## Supabase

Existing persistence and RPC authority for all three workflows. `SUPABASE_URL` and server-only `SUPABASE_SERVICE_ROLE_KEY` are required. Schema changes are migration-controlled under `supabase/migrations/`.

## Emailable

Email verification uses Emailable `GET /v1/verify`, with `email` and `api_key` query parameters. HTTP 249, 429, and server failures are retryable; exhausted retries stop with an explicit provider error. Only `state=deliverable` passes.

## MX Service

Local fallback validation using `MX_SERVICE_PORT`. It has no credential and fails closed on DNS errors. In the Compose network, n8n reaches it at `http://mx-service:9001`.

Build and start the compiled service:

```bash
pnpm build
pnpm mx:start
```

## Apollo

Firmographic enrichment uses `ENRICH_BASE_URL` and secret `ENRICH_API_KEY`. The URL must be a plain URL (not Markdown) for Apollo's single-organization enrichment endpoint. The workflow sends a GET request with the normalized domain as the `domain` query parameter and the API key in the `x-api-key` header; response fields are allowlisted.

## Google Gemini

Structured qualification and content generation uses required `GEMINI_MODEL`, a base `GEMINI_ENDPOINT`, and secret `GEMINI_API_KEY`. The final URL is `{base}/{model}:generateContent`, authenticated with `x-goog-api-key`, and requests JSON schema output. Missing candidates, safety blocks, and invalid JSON fail explicitly.

## HubSpot

Contacts use `/crm/v3/objects/contacts/batch/upsert` with email as `idProperty`. Only standard `email` and `company` properties are written. Deals require contact/deal write scopes and configured `default`/`appointmentscheduled` pipeline values. Deal creates are never blindly retried.

## Slack

Operational notifications use secret `SLACK_WEBHOOK_URL`. Payloads must not contain credentials or unrestricted source payloads.

## Brevo

Transactional delivery uses `POST {BREVO_BASE_URL}/v3/smtp/email`, the `api-key` header, verified sender name/email, recipient array, subject, and `textContent`. Sends are not blindly retried. The currently configured local credential fails the read-only account check and must be replaced.

## LiteLLM

Optional private model gateway using secret `LITELLM_MASTER_KEY`. It is registered for extension but is not inserted into migrated workflows.

## DeepSeek

Optional provider behind the model gateway using `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, and secret `DEEPSEEK_API_KEY`. It is registered for extension but is not inserted into migrated workflows.

## Docker runtime

The canonical local stack is `docker-compose.yml` at the repository root. It
passes an explicit allowlist of variables to each service, reuses the existing external n8n volume, binds development ports to loopback, and does not depend on any other source tree.
