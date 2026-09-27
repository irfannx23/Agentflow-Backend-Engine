#!/usr/bin/env python3
"""Rebuild n8n/ingestion_workflow.json with RPC-based dedup + Stage 6 Gemini scoring + Module 4 CRM routing."""
import json
import os
import re

# Resolve the agentflow-backend-engine root from this script's own location.
# Override with AGENTFLOW_BACKEND_ENGINE_ROOT when embedding the builder elsewhere.
BASE = os.environ.get('AGENTFLOW_BACKEND_ENGINE_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUPA_CRED = {"supabaseApi": {"id": "configure-supabase-credential", "name": "Supabase"}}
HDR_CRED = {"httpHeaderAuth": {"id": "configure-supabase-service-role", "name": "Supabase Service Role"}}
SUPABASE_HEADER_JSON = "={{ JSON.stringify({ apikey: $env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + $env.SUPABASE_SERVICE_ROLE_KEY }) }}"


def supabase_rpc(name):
    """Resolve the PostgREST RPC endpoint from the runtime env inside n8n."""
    return f"={{{{ $env.SUPABASE_URL + '/rest/v1/rpc/{name}' }}}}"


def patch_supabase_rpc_node(node):
    """Normalize hosted Supabase RPC calls onto the v2 HTTP node format.

    In the current n8n runtime, these nodes reliably preserve custom headers
    via headerParametersJson, while the v4.2 credential path dropped the
    required apikey/Authorization headers for hosted Supabase.
    """
    params = node.get("parameters", {})
    url = params.get("url", "")
    if node.get("type") != "n8n-nodes-base.httpRequest" or "/rest/v1/rpc/" not in url:
        return node

    json_body = params.get("jsonBody") or params.get("bodyParametersJson") or "={{ JSON.stringify({}) }}"
    node["typeVersion"] = 2
    node.pop("credentials", None)
    node["parameters"] = {
        "url": url,
        "requestMethod": params.get("method") or params.get("requestMethod") or "POST",
        "jsonParameters": True,
        "headerParametersJson": SUPABASE_HEADER_JSON,
        "bodyParametersJson": json_body,
        "options": params.get("options", {"response": {"response": {"responseFormat": "json"}}}),
    }
    return node


def flatten_snippet(code):
    """Strip an 'export default [async] function NAME() { ... }' wrapper so the
    body can be embedded directly in an n8n Code node (which is itself wrapped
    in an async function by n8n)."""
    m = re.search(r'export default (?:async )?function \w+\(\)', code)
    if not m:
        return code
    head, body = code.split(m.group(0), 1)
    body = body.strip()
    if body.startswith('{'):
        body = body[1:]
    if body.rstrip().endswith('}'):
        body = body.rstrip()[:-1]
    body = body.replace(
        ' * Paste this into an n8n "Code" node (JavaScript mode).',
        ' * Embedded in the n8n "Code" node (JavaScript mode).')
    return head + body


# 1. Read current workflow to preserve webhook params
with open(f'{BASE}/workflows/pre-crm/lead-qualification.workflow.json') as f:
    old = json.load(f)
webhook_params = next(n['parameters'] for n in old['nodes'] if n['type'] == 'n8n-nodes-base.webhook')
webhook_id = next(n['webhookId'] for n in old['nodes'] if n['type'] == 'n8n-nodes-base.webhook')

# 2. Read + flatten the Code-node snippets
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-ingestion-sanitize.js') as f:
    sanitizer_code = flatten_snippet(f.read())
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-gemini-score.js') as f:
    gemini_score_code = flatten_snippet(f.read())
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-gemini-parse.js') as f:
    gemini_parse_code = flatten_snippet(f.read())
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-verify-parse.js') as f:
    verify_parse_code = flatten_snippet(f.read())
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-enrich-parse.js') as f:
    enrich_parse_code = flatten_snippet(f.read())
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-jurisdiction-check.js') as f:
    jurisdiction_code = flatten_snippet(f.read())
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-nurture-prompt.js') as f:
    nurture_prompt_code = flatten_snippet(f.read())
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-nurture-parse.js') as f:
    nurture_parse_code = flatten_snippet(f.read())
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-anti-abuse.js') as f:
    anti_abuse_code = flatten_snippet(f.read())
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-outbound-gate.js') as f:
    outbound_gate_code = flatten_snippet(f.read())
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-outreach-prompt.js') as f:
    outreach_prompt_code = flatten_snippet(f.read())
with open(f'{BASE}/core/pre-crm/n8n-code-nodes/n8n-outreach-parse.js') as f:
    outreach_parse_code = flatten_snippet(f.read())

dedup_context_code = """
  const dedupRaw = $('Dedup: Get or Create Lead').first().json;
  const dedup = Array.isArray(dedupRaw) ? (dedupRaw[0] || {}) : (dedupRaw || {});
  const sanitized = $('Sanitize Lead').first().json || {};

  return [{
    ...sanitized,
    ...dedup,
  }];
"""

timeline_context_code = """
  const normalized = $('Normalize Lead Context').first().json || {};

  return [{
    ...normalized,
    timeline_logged: true,
  }];
"""

qualification_context_code = """
  const raw = $input.first().json;
  const qualification = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});

  return [{
    ...qualification,
  }];
"""

# 3. Nodes
nodes = [
    {"id": "webhook-hookdeck", "name": "Webhook - Hookdeck Ingest", "type": "n8n-nodes-base.webhook",
     "typeVersion": 2, "position": [0, 0], "webhookId": webhook_id, "parameters": webhook_params},

    # v2: second webhook for OUTBOUND (scraped/list) leads — same engine core,
    # tagged source_type='outbound_scraped'. Serves /webhook/outbound.
    {"id": "webhook-outbound", "name": "Webhook - Outbound Ingest", "type": "n8n-nodes-base.webhook",
     "typeVersion": 2, "position": [0, 200], "webhookId": "pre-crm-outbound-lead-ingest",
     "parameters": {
         "httpMethod": "POST",
         "path": "outbound",
         "responseMode": "onReceived",
         "options": {"responseHeaders": {"entries": [{"name": "Content-Type", "value": "application/json"}]}},
     }},

    # v2 (M0.5): Anti-abuse gate — position 0, BEFORE sanitize. Free checks
    # (honeypot, too-fast). drop -> record_abuse + end (never reaches a paid stage).
    {"id": "code-anti-abuse", "name": "Anti-Abuse Gate", "type": "n8n-nodes-base.code",
     "typeVersion": 2, "position": [320, 100], "parameters": {"jsCode": anti_abuse_code}},

    {"id": "if-abuse-ok", "name": "Abuse OK?", "type": "n8n-nodes-base.if",
     "typeVersion": 2, "position": [640, 100],
     "parameters": {
         "conditions": {
             "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
             "conditions": [{"id": "cond-abuse-ok", "leftValue": "={{ $json.abuse_gate }}",
                             "rightValue": "pass", "operator": {"type": "string", "operation": "equals"}}],
         },
         "options": {},
     }},

    {"id": "rpc-record-abuse", "name": "Record Abuse", "type": "n8n-nodes-base.httpRequest",
     "typeVersion": 4.2, "position": [640, 420], "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("record_abuse"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_reason: $json.abuse_reason, p_ip: ($json.body && $json.body.ip) || $json.ip || null, p_email: ($json.body && $json.body.email) || $json.email || null, p_payload: ($json.body && $json.body.raw_payload) || $json.raw_payload || {} }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    {"id": "code-sanitize", "name": "Sanitize Lead", "type": "n8n-nodes-base.code",
     "typeVersion": 2, "position": [960, 80], "parameters": {"jsCode": sanitizer_code}},

    {"id": "if-sanitized", "name": "Is Sanitized?", "type": "n8n-nodes-base.if",
     "typeVersion": 2, "position": [1280, 80],
     "parameters": {
         "conditions": {
             "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
             "conditions": [{"id": "cond-sanitized", "leftValue": "={{ $json.sanitized }}",
                             "rightValue": True, "operator": {"type": "boolean", "operation": "true"}}],
         },
         "options": {},
     }},

    # Stage 3: get_or_create_lead RPC — ALWAYS returns exactly 1 row (no zero-item trap)
    {"id": "rpc-get-or-create", "name": "Dedup: Get or Create Lead",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [1600, 80],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("get_or_create_lead"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_event_id: $json.event_id, p_email: $json.email, p_company_name: $json.company_name || '', p_raw_payload: $json.raw_payload || {}, p_firmographics: $json.firmographics || {}, p_source_type: $json.source_type || 'inbound', p_ip: $json.ip || null }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    {"id": "code-normalize-dedup", "name": "Normalize Lead Context",
     "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [1920, 80],
     "parameters": {"jsCode": dedup_context_code}},

    # Append timeline event based on is_new
    {"id": "rpc-append-event", "name": "Append Timeline Event",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [2240, 80],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("append_lead_event"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $json.lead_id, p_event_type: $json.is_new ? 'lead.captured' : 'lead.captured.duplicate', p_event_data: $('Sanitize Lead').first().json.raw_payload }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    {"id": "code-restore-after-timeline", "name": "Preserve Lead Context",
     "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [2560, 80],
     "parameters": {"jsCode": timeline_context_code}},

    # Stage 2a: verification gate — ACTIVE ONLY when EMAIL_VERIFY_API_KEY is
    # set in the n8n container env. Without a key the false branch flows
    # straight to scoring (current behavior preserved).
    {"id": "if-verify-enabled", "name": "Verify Email?", "type": "n8n-nodes-base.if",
     "typeVersion": 2, "position": [2880, 80],
     "parameters": {
         "conditions": {
             "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
             "conditions": [
                 {"id": "cond-is-new", "leftValue": "={{ $('Normalize Lead Context').first().json.is_new }}",
                  "rightValue": True, "operator": {"type": "boolean", "operation": "true"}},
                 {"id": "cond-verify-key", "leftValue": "={{ $env.EMAIL_VERIFY_API_KEY }}",
                  "rightValue": "", "operator": {"type": "string", "operation": "notEmpty"}},
             ],
         },
         "options": {},
     }},

    # Stage 2b: provider call (Hunter or ZeroBounce — URL built from env)
    {"id": "http-verify", "name": "Call Verify API",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [3200, 0],
     "parameters": {
         "method": "GET",
         "url": "={{ $env.EMAIL_VERIFY_BASE_URL + '?api_key=' + $env.EMAIL_VERIFY_API_KEY + '&email=' + encodeURIComponent($('Sanitize Lead').first().json.email) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    # Stage 2c: normalize provider response -> { deliverable, verdict }
    {"id": "code-verify-parse", "name": "Parse Verification",
     "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [3520, 0],
     "parameters": {"jsCode": verify_parse_code}},

    {"id": "if-deliverable", "name": "Is Deliverable?", "type": "n8n-nodes-base.if",
     "typeVersion": 2, "position": [3840, 0],
     "parameters": {
         "conditions": {
             "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
             "conditions": [{"id": "cond-deliverable", "leftValue": "={{ $json.deliverable }}",
                             "rightValue": True, "operator": {"type": "boolean", "operation": "true"}}],
         },
         "options": {},
     }},

    # Stage 2 fail path: tag the lead unverified (kept in DB, never scored/CRM'd)
    {"id": "rpc-mark-unverified", "name": "Mark Unverified",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [3840, 420],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("mark_lead_unverified"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Normalize Lead Context').first().json.lead_id }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    {"id": "rpc-evaluate-unverified", "name": "Evaluate Qualification (Unverified)",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [4160, 420],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("evaluate_lead_qualification"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Normalize Lead Context').first().json.lead_id, p_evaluation_type: 'verification_failed', p_source_runtime: 'precrm_n8n' }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    # Stage 4a: enrichment gate — ACTIVE only when ENRICH_API_KEY is set AND
    # the lead has a company domain (from the sanitizer). Runs after
    # verification passes, so credits are never spent on undeliverable leads.
    {"id": "if-enrich-enabled", "name": "Enrich Company?", "type": "n8n-nodes-base.if",
     "typeVersion": 2, "position": [4160, 80],
     "parameters": {
         "conditions": {
             "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
             "conditions": [
                 {"id": "cond-enrich-key", "leftValue": "={{ $env.ENRICH_API_KEY }}",
                  "rightValue": "", "operator": {"type": "string", "operation": "notEmpty"}},
                 {"id": "cond-enrich-domain", "leftValue": "={{ $('Sanitize Lead').first().json.email_domain }}",
                  "rightValue": "", "operator": {"type": "string", "operation": "notEmpty"}},
             ],
         },
         "options": {},
     }},

    # Stage 4b: Apollo organization enrichment call
    # CRITICAL (n8n 2.34.5): custom headers are ONLY sent on HTTP Request
    # typeVersion 2, and ONLY via headerParametersJson when jsonParameters=true
    # (headerParametersUi is display-gated to jsonParameters=false; v4 nodes
    # drop custom headers entirely; credentials don't apply either).
    {"id": "http-enrich", "name": "Call Enrich API",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 2, "position": [4480, 0],
     "parameters": {
         "url": "={{ $env.ENRICH_BASE_URL }}",
         "requestMethod": "POST",
         "jsonParameters": True,
         "headerParametersJson": "={{ JSON.stringify({ 'X-Api-Key': $env.ENRICH_API_KEY }) }}",
         "bodyParametersJson": "={{ JSON.stringify({ domain: $('Sanitize Lead').first().json.email_domain }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    # Stage 4c: merge org data into firmographics (or pass through unchanged)
    {"id": "code-enrich-parse", "name": "Parse Enrichment",
     "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [4800, 80],
     "parameters": {"jsCode": enrich_parse_code}},

    # Stage 5a: blocked-jurisdiction hard exclusion — runs AFTER enrichment
    # (which may reveal the country via firmographics, name-form) and BEFORE
    # scoring. A blocked lead is never scored/CRM'd.
    {"id": "code-jurisdiction-check", "name": "Check Jurisdiction",
     "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [5120, 80],
     "parameters": {"jsCode": jurisdiction_code}},

    # Stage 5b: gate — true branch (NOT blocked) flows to Gemini scoring;
    # false branch disqualifies the lead and ends the branch.
    {"id": "if-jurisdiction-ok", "name": "Jurisdiction OK?", "type": "n8n-nodes-base.if",
     "typeVersion": 2, "position": [5440, 80],
     "parameters": {
         "conditions": {
             "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
             "conditions": [{"id": "cond-jurisdiction-ok", "leftValue": "={{ $json.jurisdiction_blocked }}",
                             "rightValue": False, "operator": {"type": "boolean", "operation": "false"}}],
         },
         "options": {},
     }},

    # Stage 5c: fail path — persist the disqualification (kept in DB, tagged,
    # timeline event) so the lead is never scored or sent to a CRM.
    {"id": "rpc-block-jurisdiction", "name": "Block Jurisdiction",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [5440, 420],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("mark_lead_blocked"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $json.lead_id, p_country: $json.country_code }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    {"id": "rpc-evaluate-blocked", "name": "Evaluate Qualification (Blocked)",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [5760, 420],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("evaluate_lead_qualification"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Normalize Lead Context').first().json.lead_id, p_evaluation_type: 'jurisdiction_blocked', p_source_runtime: 'precrm_n8n' }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    # Stage 6a: decide + build the Gemini prompt (no key touched here)
    {"id": "code-gemini-score", "name": "Score Lead (Gemini)",
     "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [5760, 80],
     "parameters": {"jsCode": gemini_score_code}},

    # Stage 6b: the actual Gemini call via HTTP Request. Key comes from the
    # n8n container env (GEMINI_API_KEY, set via docker-compose interpolation
    # from the gitignored .env) using an n8n expression — the expression
    # engine has env access even though the Code-node sandbox does not.
    # Model is centralized in GEMINI_ENDPOINT (.env) — currently
    # gemini-2.5-flash-lite (2.5-flash free-tier daily quota is low and
    # exhausts quickly under E2E testing; lite has a separate, higher pool).
    {"id": "http-gemini-call", "name": "Call Gemini API",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [6080, 80],
     "parameters": {
         "method": "POST",
         "url": "={{ $env.GEMINI_ENDPOINT + '?key=' + $env.GEMINI_API_KEY }}",
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ contents: [{ parts: [{ text: $json.prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 512 } }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    # Stage 6c: parse + validate the strict score, hand to the RPC node
    {"id": "code-gemini-parse", "name": "Parse Gemini Score",
     "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [6400, 80],
     "parameters": {"jsCode": gemini_parse_code}},

    # Stage 6: persist the score + status + lead.scored timeline event
    {"id": "rpc-update-score", "name": "Update Lead Score",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [6720, 80],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("update_lead_score"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $json.lead_id, p_icp_score: $json.icp_score, p_buying_intent: $json.buying_intent, p_icebreaker: $json.personalized_icebreaker, p_status: $json.status, p_firmographics: $('Parse Enrichment').first().json.firmographics }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
         }},

         {"id": "rpc-evaluate-score", "name": "Evaluate Qualification",
        "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [7040, 80],
         "credentials": HDR_CRED,
         "parameters": {
          "method": "POST",
          "url": supabase_rpc("evaluate_lead_qualification"),
          "sendBody": True,
          "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Parse Gemini Score').first().json.lead_id, p_evaluation_type: 'score_update', p_source_runtime: 'precrm_n8n' }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
         }},

         {"id": "code-normalize-qualification", "name": "Normalize Qualification Context",
        "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [7200, 80],
         "parameters": {"jsCode": qualification_context_code}},

         {"id": "rpc-route-inbound", "name": "Route Lead to Sales (Inbound)",
        "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [7680, 0],
         "credentials": HDR_CRED,
         "parameters": {
          "method": "POST",
          "url": supabase_rpc("route_lead_to_sales"),
          "sendBody": True,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ p_lead_id: $json.lead_id, p_trigger: 'inbound_sql_runtime', p_force_reassign: false }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
         }},

         # v2 (M4): Outbound route — after scoring, branch by source_type.
         # outbound_scraped -> MX check + relevance gate -> ready_to_push.
         # inbound -> existing CRM Ready? path (untouched).
         {"id": "if-outbound", "name": "Outbound Lead?", "type": "n8n-nodes-base.if",
        "typeVersion": 2, "position": [7360, 80],
         "parameters": {
          "conditions": {
              "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
              "conditions": [{"id": "cond-outbound", "leftValue": "={{ $('Sanitize Lead').first().json.source_type }}",
                              "rightValue": "outbound_scraped", "operator": {"type": "string", "operation": "equals"}}],
          },
          "options": {},
         }},

         # Outbound gate: MX health via the sidecar service (Code-node sandbox can't
         # do DNS). typeVersion 2 GET.
         {"id": "http-mx-check", "name": "Check MX (Outbound)", "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 2, "position": [7680, 240],
         "parameters": {
          "url": "={{ 'http://mx-service:9001/mx?domain=' + encodeURIComponent(($('Sanitize Lead').first().json.email_domain || '')) }}",
          "requestMethod": "GET",
          "options": {"response": {"response": {"responseFormat": "json"}}},
         }},

         {"id": "code-outbound-gate", "name": "Outbound Gate", "type": "n8n-nodes-base.code",
        "typeVersion": 2, "position": [8000, 240], "parameters": {"jsCode": outbound_gate_code}},

         {"id": "if-outbound-pass", "name": "Outbound Gate Pass?", "type": "n8n-nodes-base.if",
        "typeVersion": 2, "position": [8320, 240],
         "parameters": {
          "conditions": {
              "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
              "conditions": [{"id": "cond-outbound-pass", "leftValue": "={{ $json.outbound_gate }}",
                              "rightValue": "pass", "operator": {"type": "string", "operation": "equals"}}],
          },
          "options": {},
         }},

         {"id": "rpc-ready-to-push", "name": "Mark Ready to Push", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [8640, 240], "credentials": HDR_CRED,
         "parameters": {
          "method": "POST",
          "url": supabase_rpc("mark_ready_to_push"),
          "sendBody": True,
          "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Normalize Lead Context').first().json.lead_id, p_reason: null }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
         }},

         {"id": "rpc-evaluate-outbound-ready", "name": "Evaluate Qualification (Outbound Ready)", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [8960, 240], "credentials": HDR_CRED,
         "parameters": {
          "method": "POST",
          "url": supabase_rpc("evaluate_lead_qualification"),
          "sendBody": True,
          "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Normalize Lead Context').first().json.lead_id, p_evaluation_type: 'outbound_ready', p_source_runtime: 'precrm_n8n' }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
         }},

         {"id": "rpc-route-outbound-ready", "name": "Route Lead to Sales (Outbound Ready)", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [9280, 240], "credentials": HDR_CRED,
         "parameters": {
          "method": "POST",
          "url": supabase_rpc("route_lead_to_sales"),
          "sendBody": True,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Normalize Lead Context').first().json.lead_id, p_trigger: 'outbound_ready_runtime', p_force_reassign: false }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
         }},

         {"id": "slack-ready-to-push", "name": "Slack Alert: Ready to Push", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [9600, 240],
         "parameters": {
          "method": "POST",
          "url": "={{ $env.SLACK_WEBHOOK_URL }}",
          "sendBody": True,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ text: '📬 READY TO PUSH (outbound): ' + ($('Sanitize Lead').first().json.company_name || 'Unknown') + ' (' + $('Sanitize Lead').first().json.email + ')\\nICP ' + $('Parse Gemini Score').first().json.icp_score + '/100 · MX OK\\nOwner: ' + (($('Route Lead to Sales (Outbound Ready)').first().json.current_owner_type || 'unassigned').toUpperCase()) + ' · Priority: ' + ($('Route Lead to Sales (Outbound Ready)').first().json.priority_tier || 'low') + ' · Route: ' + ($('Route Lead to Sales (Outbound Ready)').first().json.routing_reason || 'n/a') }) }}",
          "options": {"response": {"response": {"responseFormat": "text"}}},
          }},

          {"id": "rpc-sales-sync-outbound-slack", "name": "Sales Assignment Sync (Outbound Slack)", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [9920, 240], "credentials": HDR_CRED,
          "parameters": {
          "method": "POST",
          "url": supabase_rpc("update_sales_assignment_sync"),
          "sendBody": True,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Normalize Lead Context').first().json.lead_id, p_slack_sync_status: 'synced', p_reason: 'outbound_ready_sales_alert' }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
          }},

          # v2 (M5): AI outreach loop — for ready_to_push outbound leads.
          {"id": "code-outreach-prompt", "name": "Build Outreach Email", "type": "n8n-nodes-base.code",
         "typeVersion": 2, "position": [10240, 240], "parameters": {"jsCode": outreach_prompt_code}},

          {"id": "http-gemini-outreach", "name": "Call Gemini (Outreach)", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [10560, 240],
          "parameters": {
          "method": "POST",
          "url": "={{ $env.GEMINI_ENDPOINT + '?key=' + $env.GEMINI_API_KEY }}",
          "sendBody": True,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ contents: [{ parts: [{ text: $json.prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 512 } }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
          }},

          {"id": "code-outreach-parse", "name": "Parse Outreach Email", "type": "n8n-nodes-base.code",
         "typeVersion": 2, "position": [10880, 240], "parameters": {"jsCode": outreach_parse_code}},

          {"id": "rpc-insert-outreach", "name": "Insert Outreach Row", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [11200, 240], "credentials": HDR_CRED,
          "parameters": {
          "method": "POST",
          "url": supabase_rpc("insert_outreach"),
          "sendBody": True,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ p_lead_id: $json.lead_id, p_email: $json.to_email, p_subject: $json.subject, p_body: $json.body, p_status: 'queued' }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
          }},

          {"id": "if-outreach-send", "name": "Send Outreach Email?", "type": "n8n-nodes-base.if",
         "typeVersion": 2, "position": [11520, 240],
          "parameters": {
          "conditions": {
              "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
              "conditions": [{"id": "cond-brevo-outreach", "leftValue": "={{ $env.BREVO_API_KEY }}",
                              "rightValue": "", "operator": {"type": "string", "operation": "notEmpty"}}],
          },
          "options": {},
          }},

          {"id": "http-brevo-outreach", "name": "Send Outreach (Brevo)", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 2, "position": [11840, 240],
          "parameters": {
          "url": "={{ $env.BREVO_BASE_URL }}",
          "requestMethod": "POST",
          "jsonParameters": True,
          "headerParametersJson": "={{ JSON.stringify({ 'api-key': $env.BREVO_API_KEY }) }}",
          "bodyParametersJson": "={{ JSON.stringify({ sender: { name: $env.BREVO_SENDER_NAME, email: $env.BREVO_SENDER_EMAIL }, to: [{ email: $('Parse Outreach Email').first().json.to_email }], subject: $('Parse Outreach Email').first().json.subject, textContent: $('Parse Outreach Email').first().json.body }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
          }},

          {"id": "rpc-outreach-sent", "name": "Mark Outreach Sent", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [12160, 240], "credentials": HDR_CRED,
          "parameters": {
          "method": "POST",
          "url": supabase_rpc("mark_outreach_sent"),
          "sendBody": True,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ p_id: $('Insert Outreach Row').first().json.id }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
          }},

          {"id": "rpc-lead-emailed", "name": "Mark Lead Emailed", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [12480, 240], "credentials": HDR_CRED,
          "parameters": {
          "method": "POST",
          "url": supabase_rpc("mark_lead_emailed"),
          "sendBody": True,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Parse Outreach Email').first().json.lead_id }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
          }},

          {"id": "rpc-evaluate-outreach-sent", "name": "Evaluate Qualification (Outreach Sent)", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [12800, 240], "credentials": HDR_CRED,
          "parameters": {
          "method": "POST",
          "url": supabase_rpc("evaluate_lead_qualification"),
          "sendBody": True,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Parse Outreach Email').first().json.lead_id, p_evaluation_type: 'outreach_sent', p_source_runtime: 'precrm_n8n' }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
          }},

          {"id": "slack-outreach-sent", "name": "Slack: Outreach Sent", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [13120, 240],
          "parameters": {
          "method": "POST",
          "url": "={{ $env.SLACK_WEBHOOK_URL }}",
          "sendBody": True,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ text: '✉️ OUTREACH SENT: ' + ($('Sanitize Lead').first().json.company_name || 'Unknown') + ' (' + $('Parse Outreach Email').first().json.to_email + ')\\nOwner: ' + (($('Route Lead to Sales (Outbound Ready)').first().json.current_owner_type || 'unassigned').toUpperCase()) + ' · Route: ' + ($('Route Lead to Sales (Outbound Ready)').first().json.routing_reason || 'n/a') }) }}",
          "options": {"response": {"response": {"responseFormat": "text"}}},
          }},

          # v2 (M6): HubSpot outbound contact sync — the outbound path never hit
          # HubSpot before (inbound-only upsert in Module 4b). Upsert the contact
          # with lead_source + outreach_status after the email is sent so the
          # reply->deal cron (workflow id=2) can find it by email and associate.
          {"id": "http-hs-outbound-contact", "name": "HubSpot: Sync Outbound Contact",
         "type": "n8n-nodes-base.httpRequest", "typeVersion": 2, "position": [13440, 240],
          "parameters": {
          "url": "={{ $env.HUBSPOT_BASE_URL + '/crm/v3/objects/contacts?&idProperty=email' }}",
          "requestMethod": "POST",
          "jsonParameters": True,
          "headerParametersJson": "={{ JSON.stringify({ Authorization: 'Bearer ' + $env.HUBSPOT_ACCESS_TOKEN }) }}",
          "bodyParametersJson": "={{ JSON.stringify({ properties: { email: $('Sanitize Lead').first().json.email, company: $('Sanitize Lead').first().json.company_name || '', lead_source: 'outbound_scraped', outreach_status: 'emailed' } }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
          }},

          {"id": "rpc-sales-sync-outbound-crm", "name": "Sales Assignment Sync (Outbound CRM)", "type": "n8n-nodes-base.httpRequest",
         "typeVersion": 4.2, "position": [13760, 240], "credentials": HDR_CRED,
          "parameters": {
          "method": "POST",
          "url": supabase_rpc("update_sales_assignment_sync"),
          "sendBody": True,
          "specifyBody": "json",
          "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Parse Outreach Email').first().json.lead_id, p_crm_sync_status: 'synced', p_reason: 'outbound_contact_sync' }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
          }},

          {"id": "rpc-log-gate-fail", "name": "Log Outbound Gate Fail", "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2, "position": [8320, 420], "credentials": HDR_CRED,
         "parameters": {
          "method": "POST",
          "url": supabase_rpc("append_lead_event"),
          "sendBody": True,
          "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Normalize Lead Context').first().json.lead_id, p_event_type: 'lead.outbound.gate.failed', p_event_data: { reason: $json.outbound_reason, icp_score: $json.icp_score } }) }}",
          "options": {"response": {"response": {"responseFormat": "json"}}},
         }},

         # Module 4a: CRM Gatekeeper — only icp_score >= 70 reaches HubSpot.
    # Deliverability is guaranteed upstream (Stage 2 gate: only verified
    # leads are scored), so the score is the sole CRM gate here.
    {"id": "if-crm-ready", "name": "CRM Ready?", "type": "n8n-nodes-base.if",
     "typeVersion": 2, "position": [8000, 0],
     "parameters": {
         "conditions": {
             "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
             "conditions": [{"id": "cond-crm-ready", "leftValue": "={{ $('Normalize Qualification Context').first().json.crm_ready }}",
                             "rightValue": True, "operator": {"type": "boolean", "operation": "true"}}],
         },
         "options": {},
     }},

    # Module 4b: upsert the contact by email (idProperty=email), returns the
    # HubSpot contact id so the deal can be associated to it.
    {"id": "http-hs-contact", "name": "HubSpot: Upsert Contact",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 2, "position": [8320, 0],
     "parameters": {
         "url": "={{ $env.HUBSPOT_BASE_URL + '/crm/v3/objects/contacts?&idProperty=email' }}",
         "requestMethod": "POST",
         "jsonParameters": True,
         "headerParametersJson": "={{ JSON.stringify({ Authorization: 'Bearer ' + $env.HUBSPOT_ACCESS_TOKEN }) }}",
         "bodyParametersJson": "={{ JSON.stringify({ properties: { email: $('Sanitize Lead').first().json.email, company: $('Sanitize Lead').first().json.company_name || '' } }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    # Module 4b.1: normalize HubSpot response once so downstream nodes never
    # re-parse raw API shapes or accidentally use composite/object-source ids.
    {"id": "code-hs-contact-context", "name": "Normalize HubSpot Contact Context",
     "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [8480, 0],
     "parameters": {"jsCode": """const raw = $input.first()?.json || {};
const firstResult = Array.isArray(raw.results) ? raw.results[0] : null;
const candidateId =
  raw.id ??
  raw.hs_object_id ??
  raw.properties?.hs_object_id ??
  firstResult?.id ??
  firstResult?.hs_object_id ??
  firstResult?.properties?.hs_object_id;
const contactId = String(candidateId || '').replace(/^0-1-/, '').trim();

if (!contactId) {
  throw new Error('missing_hubspot_contact_id');
}

return [{
  json: {
    ...raw,
    hubspot_contact_id: contactId,
    hubspot_contact_email: $('Sanitize Lead').first().json.email,
    hubspot_contact_status: raw.createdAt ? 'created_or_updated' : 'upserted',
  },
}];
"""}},

    # Module 4c: create the deal associated to the contact just upserted.
    {"id": "http-hs-deal", "name": "HubSpot: Create Deal",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 2, "position": [8800, 0],
     "parameters": {
         "url": "={{ $env.HUBSPOT_BASE_URL + '/crm/v3/objects/deals' }}",
         "requestMethod": "POST",
         "jsonParameters": True,
         "headerParametersJson": "={{ JSON.stringify({ Authorization: 'Bearer ' + $env.HUBSPOT_ACCESS_TOKEN }) }}",
         "bodyParametersJson": "={{ JSON.stringify({ properties: { dealname: ($('Sanitize Lead').first().json.company_name || 'Lead') + ' — PreCRM', amount: '0', pipeline: 'default', dealstage: 'appointmentscheduled' }, associations: [{ types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }], to: { id: $('Normalize HubSpot Contact Context').first().json.hubspot_contact_id } }] }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    {"id": "rpc-sales-sync-inbound-crm", "name": "Sales Assignment Sync (Inbound CRM)",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [8960, 0],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("update_sales_assignment_sync"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Normalize Qualification Context').first().json.lead_id, p_crm_sync_status: 'synced', p_reason: 'inbound_hubspot_sync' }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    # Module 4d: qualified-lead Slack alert (speed-to-lead). Slack webhook
    # responds with plain text "ok" — use responseFormat text, NOT json.
    {"id": "http-slack-qualified", "name": "Slack Alert: Qualified Lead",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [9280, 0],
     "parameters": {
         "method": "POST",
         "url": "={{ $env.SLACK_WEBHOOK_URL }}",
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ text: '🚀 QUALIFIED LEAD: ' + ($('Sanitize Lead').first().json.company_name || 'Unknown') + ' (' + $('Sanitize Lead').first().json.email + ')\\nICP score: ' + $('Parse Gemini Score').first().json.icp_score + '/100 · Intent: ' + $('Parse Gemini Score').first().json.buying_intent + '\\nOwner: ' + (($('Route Lead to Sales (Inbound)').first().json.current_owner_type || 'unassigned').toUpperCase()) + ' · Priority: ' + ($('Route Lead to Sales (Inbound)').first().json.priority_tier || 'low') + ' · Route: ' + ($('Route Lead to Sales (Inbound)').first().json.routing_reason || 'n/a') + '\\nIcebreaker: ' + ($('Parse Gemini Score').first().json.personalized_icebreaker || '—') + '\\nDeal: ' + $json.url }) }}",
         "options": {"response": {"response": {"responseFormat": "text"}}},
     }},

    {"id": "rpc-sales-sync-inbound-slack", "name": "Sales Assignment Sync (Inbound Slack)",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [9600, 0],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("update_sales_assignment_sync"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Normalize Qualification Context').first().json.lead_id, p_slack_sync_status: 'synced', p_reason: 'inbound_sales_alert' }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    # Module 4e: nurture notice — leads below 70 are NOT CRM'd; Slack gets a
    # gentle heads-up so the pipeline is observable end to end.
    {"id": "http-slack-nurture", "name": "Slack Alert: Nurture",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [8320, 520],
     "parameters": {
         "method": "POST",
         "url": "={{ $env.SLACK_WEBHOOK_URL }}",
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ text: '🌱 NURTURE: ' + ($('Sanitize Lead').first().json.company_name || 'Unknown') + ' (' + $('Sanitize Lead').first().json.email + ') — ICP ' + $('Parse Gemini Score').first().json.icp_score + '/100. Not CRM-ready yet.' }) }}",
         "options": {"response": {"response": {"responseFormat": "text"}}},
     }},

    # Module 4f: nurture email gate — active only when BREVO_API_KEY is set.
    # Without a key the nurture branch ends after the Slack notice.
    {"id": "if-nurture-email", "name": "Send Nurture Email?", "type": "n8n-nodes-base.if",
     "typeVersion": 2, "position": [8640, 520],
     "parameters": {
         "conditions": {
             "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
             "conditions": [{"id": "cond-brevo-key", "leftValue": "={{ $env.BREVO_API_KEY }}",
                             "rightValue": "", "operator": {"type": "string", "operation": "notEmpty"}}],
         },
         "options": {},
     }},

    # Module 4g: build the Gemini prompt for the nurture email copy.
    {"id": "code-nurture-prompt", "name": "Build Nurture Email",
     "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [8960, 520],
     "parameters": {"jsCode": nurture_prompt_code}},

    # Module 4h: the actual Gemini call for the nurture email copy.
    # Same centralized model config as scoring (GEMINI_ENDPOINT).
    {"id": "http-gemini-nurture", "name": "Call Gemini (Nurture Email)",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [9280, 520],
     "parameters": {
         "method": "POST",
         "url": "={{ $env.GEMINI_ENDPOINT + '?key=' + $env.GEMINI_API_KEY }}",
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ contents: [{ parts: [{ text: $json.prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 512 } }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    # Module 4i: parse { subject, body } out of the Gemini response.
    {"id": "code-nurture-parse", "name": "Parse Nurture Email",
     "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [9600, 520],
     "parameters": {"jsCode": nurture_parse_code}},

    # Module 4j: send via Brevo transactional email API (api-key header).
    {"id": "http-brevo-send", "name": "Send Nurture Email (Brevo)",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 2, "position": [9920, 520],
     "parameters": {
         "url": "={{ $env.BREVO_BASE_URL }}",
         "requestMethod": "POST",
         "jsonParameters": True,
         "headerParametersJson": "={{ JSON.stringify({ 'api-key': $env.BREVO_API_KEY }) }}",
         "bodyParametersJson": "={{ JSON.stringify({ sender: { name: $env.BREVO_SENDER_NAME, email: $env.BREVO_SENDER_EMAIL }, to: [{ email: $json.to_email }], subject: $json.subject, textContent: $json.body }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    # Module 4k: log the nurture email on the timeline. NOTE: input here is
    # the Brevo API response — pull the email data from Parse Nurture Email.
    {"id": "rpc-log-nurture-email", "name": "Log Nurture Email",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [10240, 520],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("append_lead_event"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Parse Nurture Email').first().json.lead_id, p_event_type: 'lead.nurture.email.sent', p_event_data: { subject: $('Parse Nurture Email').first().json.subject, to: $('Parse Nurture Email').first().json.to_email } }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    {"id": "rpc-evaluate-nurture", "name": "Evaluate Qualification (Nurture Sent)",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [10560, 520],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("evaluate_lead_qualification"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_lead_id: $('Parse Nurture Email').first().json.lead_id, p_evaluation_type: 'nurture_sent', p_source_runtime: 'precrm_n8n' }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},

    # Stage 1 fail path: log spam
    {"id": "rpc-log-spam", "name": "Log Spam",
     "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [1280, 420],
     "credentials": HDR_CRED,
     "parameters": {
         "method": "POST",
         "url": supabase_rpc("log_spam"),
         "sendBody": True,
         "specifyBody": "json",
         "jsonBody": "={{ JSON.stringify({ p_event_id: $json.event_id, p_email: $json.email, p_reason: $json.reason, p_raw_payload: $json.raw_payload }) }}",
         "options": {"response": {"response": {"responseFormat": "json"}}},
     }},
]

connections = {
    "Webhook - Hookdeck Ingest": {"main": [[{"node": "Anti-Abuse Gate", "type": "main", "index": 0}]]},
    "Webhook - Outbound Ingest": {"main": [[{"node": "Anti-Abuse Gate", "type": "main", "index": 0}]]},
    "Anti-Abuse Gate": {"main": [[{"node": "Abuse OK?", "type": "main", "index": 0}]]},
    "Abuse OK?": {
        "main": [
            [{"node": "Sanitize Lead", "type": "main", "index": 0}],
            [{"node": "Record Abuse", "type": "main", "index": 0}],
        ]
    },
    "Sanitize Lead": {"main": [[{"node": "Is Sanitized?", "type": "main", "index": 0}]]},
    "Is Sanitized?": {
        "main": [
            [{"node": "Dedup: Get or Create Lead", "type": "main", "index": 0}],
            [{"node": "Log Spam", "type": "main", "index": 0}],
        ]
    },
    "Dedup: Get or Create Lead": {"main": [[{"node": "Normalize Lead Context", "type": "main", "index": 0}]]},
    "Normalize Lead Context": {"main": [[{"node": "Append Timeline Event", "type": "main", "index": 0}]]},
    "Append Timeline Event": {"main": [[{"node": "Preserve Lead Context", "type": "main", "index": 0}]]},
    "Preserve Lead Context": {"main": [[{"node": "Verify Email?", "type": "main", "index": 0}]]},
    "Verify Email?": {
        "main": [
            [{"node": "Call Verify API", "type": "main", "index": 0}],
            [{"node": "Parse Enrichment", "type": "main", "index": 0}],
        ]
    },
    "Call Verify API": {"main": [[{"node": "Parse Verification", "type": "main", "index": 0}]]},
    "Parse Verification": {"main": [[{"node": "Is Deliverable?", "type": "main", "index": 0}]]},
    "Is Deliverable?": {
        "main": [
            [{"node": "Enrich Company?", "type": "main", "index": 0}],
            [{"node": "Mark Unverified", "type": "main", "index": 0}],
        ]
    },
    "Mark Unverified": {"main": [[{"node": "Evaluate Qualification (Unverified)", "type": "main", "index": 0}]]},
    "Enrich Company?": {
        "main": [
            [{"node": "Call Enrich API", "type": "main", "index": 0}],
            [{"node": "Parse Enrichment", "type": "main", "index": 0}],
        ]
    },
    "Call Enrich API": {"main": [[{"node": "Parse Enrichment", "type": "main", "index": 0}]]},
    "Parse Enrichment": {"main": [[{"node": "Check Jurisdiction", "type": "main", "index": 0}]]},
    "Check Jurisdiction": {"main": [[{"node": "Jurisdiction OK?", "type": "main", "index": 0}]]},
    "Jurisdiction OK?": {
        "main": [
            [{"node": "Score Lead (Gemini)", "type": "main", "index": 0}],
            [{"node": "Block Jurisdiction", "type": "main", "index": 0}],
        ]
    },
    "Block Jurisdiction": {"main": [[{"node": "Evaluate Qualification (Blocked)", "type": "main", "index": 0}]]},
    "Score Lead (Gemini)": {"main": [[{"node": "Call Gemini API", "type": "main", "index": 0}]]},
    "Call Gemini API": {"main": [[{"node": "Parse Gemini Score", "type": "main", "index": 0}]]},
    "Parse Gemini Score": {"main": [[{"node": "Update Lead Score", "type": "main", "index": 0}]]},
    "Update Lead Score": {"main": [[{"node": "Evaluate Qualification", "type": "main", "index": 0}]]},
    "Evaluate Qualification": {"main": [[{"node": "Normalize Qualification Context", "type": "main", "index": 0}]]},
    "Normalize Qualification Context": {"main": [[{"node": "Outbound Lead?", "type": "main", "index": 0}]]},
    "Outbound Lead?": {
        "main": [
            [{"node": "Check MX (Outbound)", "type": "main", "index": 0}],
            [{"node": "Route Lead to Sales (Inbound)", "type": "main", "index": 0}],
        ]
    },
    "Route Lead to Sales (Inbound)": {"main": [[{"node": "CRM Ready?", "type": "main", "index": 0}]]},
    "Check MX (Outbound)": {"main": [[{"node": "Outbound Gate", "type": "main", "index": 0}]]},
    "Outbound Gate": {"main": [[{"node": "Outbound Gate Pass?", "type": "main", "index": 0}]]},
    "Outbound Gate Pass?": {
        "main": [
            [{"node": "Mark Ready to Push", "type": "main", "index": 0}],
            [{"node": "Log Outbound Gate Fail", "type": "main", "index": 0}],
        ]
    },
    "Mark Ready to Push": {"main": [[{"node": "Evaluate Qualification (Outbound Ready)", "type": "main", "index": 0}]]},
    "Evaluate Qualification (Outbound Ready)": {"main": [[{"node": "Route Lead to Sales (Outbound Ready)", "type": "main", "index": 0}]]},
    "Route Lead to Sales (Outbound Ready)": {"main": [[{"node": "Slack Alert: Ready to Push", "type": "main", "index": 0}]]},
    "Slack Alert: Ready to Push": {"main": [[{"node": "Sales Assignment Sync (Outbound Slack)", "type": "main", "index": 0}]]},
    "Sales Assignment Sync (Outbound Slack)": {"main": [[{"node": "Build Outreach Email", "type": "main", "index": 0}]]},
    "Build Outreach Email": {"main": [[{"node": "Call Gemini (Outreach)", "type": "main", "index": 0}]]},
    "Call Gemini (Outreach)": {"main": [[{"node": "Parse Outreach Email", "type": "main", "index": 0}]]},
    "Parse Outreach Email": {"main": [[{"node": "Insert Outreach Row", "type": "main", "index": 0}]]},
    "Insert Outreach Row": {"main": [[{"node": "Send Outreach Email?", "type": "main", "index": 0}]]},
    "Send Outreach Email?": {
        "main": [
            [{"node": "Send Outreach (Brevo)", "type": "main", "index": 0}],
            [],
        ]
    },
    "Send Outreach (Brevo)": {"main": [[{"node": "Mark Outreach Sent", "type": "main", "index": 0}]]},
    "Mark Outreach Sent": {"main": [[{"node": "Mark Lead Emailed", "type": "main", "index": 0}]]},
    "Mark Lead Emailed": {"main": [[{"node": "Evaluate Qualification (Outreach Sent)", "type": "main", "index": 0}]]},
    "Evaluate Qualification (Outreach Sent)": {"main": [[{"node": "Slack: Outreach Sent", "type": "main", "index": 0}]]},
    "Slack: Outreach Sent": {"main": [[{"node": "HubSpot: Sync Outbound Contact", "type": "main", "index": 0}]]},
    "HubSpot: Sync Outbound Contact": {"main": [[{"node": "Sales Assignment Sync (Outbound CRM)", "type": "main", "index": 0}]]},
    "CRM Ready?": {
        "main": [
            [{"node": "HubSpot: Upsert Contact", "type": "main", "index": 0}],
            [{"node": "Slack Alert: Nurture", "type": "main", "index": 0}],
        ]
    },
    "HubSpot: Upsert Contact": {"main": [[{"node": "Normalize HubSpot Contact Context", "type": "main", "index": 0}]]},
    "Normalize HubSpot Contact Context": {"main": [[{"node": "HubSpot: Create Deal", "type": "main", "index": 0}]]},
    "HubSpot: Create Deal": {"main": [[{"node": "Sales Assignment Sync (Inbound CRM)", "type": "main", "index": 0}]]},
    "Sales Assignment Sync (Inbound CRM)": {"main": [[{"node": "Slack Alert: Qualified Lead", "type": "main", "index": 0}]]},
    "Slack Alert: Qualified Lead": {"main": [[{"node": "Sales Assignment Sync (Inbound Slack)", "type": "main", "index": 0}]]},
    "Slack Alert: Nurture": {"main": [[{"node": "Send Nurture Email?", "type": "main", "index": 0}]]},
    "Send Nurture Email?": {
        "main": [
            [{"node": "Build Nurture Email", "type": "main", "index": 0}],
            [],
        ]
    },
    "Build Nurture Email": {"main": [[{"node": "Call Gemini (Nurture Email)", "type": "main", "index": 0}]]},
    "Call Gemini (Nurture Email)": {"main": [[{"node": "Parse Nurture Email", "type": "main", "index": 0}]]},
    "Parse Nurture Email": {"main": [[{"node": "Send Nurture Email (Brevo)", "type": "main", "index": 0}]]},
    "Send Nurture Email (Brevo)": {"main": [[{"node": "Log Nurture Email", "type": "main", "index": 0}]]},
    "Log Nurture Email": {"main": [[{"node": "Evaluate Qualification (Nurture Sent)", "type": "main", "index": 0}]]},
}

wf = {
    "id": "1",
    "name": "Pre-CRM Ingestion — Hookdeck → Sanitize → Gate → Verify → Enrich → Jurisdiction → AI Score → CRM/Slack",
    "nodes": [patch_supabase_rpc_node(node) for node in nodes],
    "connections": connections,
    "settings": {"executionOrder": "v1"},
    "pinData": {},
    "meta": {"templateCredsSetupCompleted": True},
}

with open(f'{BASE}/workflows/pre-crm/lead-qualification.workflow.json', 'w') as f:
    json.dump(wf, f, indent=2)
print(f"Built workflow: {len(nodes)} nodes, {len(connections)} connections")
for n in nodes:
    print(f"  - {n['name']} ({n['type']})")
