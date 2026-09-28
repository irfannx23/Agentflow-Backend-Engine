# Deterministic Loom/demo checklist

## Preconditions

- `docker compose ps` shows n8n, MX, and LiteLLM healthy.
- Backend `/health` and AgentFlow return HTTP 200.
- The active n8n workflows are `Lead Qualification`, `Reply-to-Deal`, and `RevOps Signal Orchestration`; no second active workflow shares their paths.
- Replace the currently invalid Brevo key and verify the configured sender before demonstrating email delivery.
- Use a HubSpot sandbox/test account and a dedicated Slack demo channel webhook.
- Confirm Apollo credits are available. Automated tests never spend them.

## Demo identity/data

Use a company-controlled mailbox on a real corporate domain that:

- can receive mail and returns Emailable `deliverable`;
- publishes a non-null MX record;
- has an Apollo organization record;
- is not already present in `staged_leads` for the chosen event ID/email;
- is safe to create/update in the configured HubSpot sandbox.

Reserved/fake domains such as `.test` will intentionally fail verification/enrichment and are unsuitable for the full path. Do not weaken production gates. Use a unique Firebase test user and a unique event ID for each recording rehearsal.

## Signup path

1. Start AgentFlow, the backend event server, and canonical Compose services.
2. Open n8n executions in a separate window.
3. Register the controlled test Firebase user in AgentFlow.
4. Confirm AgentFlow emits `user.registered`; `user.logged_in` must not contain email and must not trigger Lead Qualification.
5. Observe backend HMAC acceptance, `product_events` persistence, outbox success, and n8n webhook execution.
6. Show sanitization, real anti-abuse counters, Emailable, MX where applicable, Apollo, Gemini structured scoring, qualification, and sales routing.
7. Show only sandbox/test CRM and notification destinations.

## Product/RevOps path

1. Emit a supported product event for a known backend account ID.
2. Confirm backend dispatch carries that `accountId`; it must not switch to all-account mode.
3. Confirm one of the ten canonical signals is retained.
4. Verify PQL handoff runs only for `PQL_REACHED` or `UPGRADE_INTENT`.
5. Confirm claim/record steps prevent repeated HubSpot/Slack side effects.

## Safe rehearsal limits

- Do not send real email or Slack during automated rehearsal.
- Do not create CRM contacts/deals outside a sandbox.
- A complete visible CRM/Slack/email Loom is blocked until destinations are confirmed safe and the Brevo key is replaced.
- The repository includes `scripts/safe-event-e2e.mjs` for a non-lead HMAC/persistence/dedup replay check.
