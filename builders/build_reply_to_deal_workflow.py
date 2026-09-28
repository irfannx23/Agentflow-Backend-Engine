#!/usr/bin/env python3
"""Build the canonical Reply-to-Deal workflow with per-item linkage and recovery."""
import json
import os
import sys

BASE = os.environ.get('AGENTFLOW_BACKEND_ENGINE_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUPABASE_HEADERS = "={{ JSON.stringify({ apikey: $env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + $env.SUPABASE_SERVICE_ROLE_KEY }) }}"
HUBSPOT_HEADERS = "={{ JSON.stringify({ Authorization: 'Bearer ' + $env.HUBSPOT_ACCESS_TOKEN }) }}"


def http_node(node_id, name, x, url, body=None, method='POST', safe_retry=False, response='json'):
    parameters = {
        'url': url,
        'requestMethod': method,
        'jsonParameters': True,
        'options': {'timeout': 30000, 'response': {'response': {'responseFormat': response}}},
    }
    if '/rest/v1/' in url:
        parameters['headerParametersJson'] = SUPABASE_HEADERS
    elif 'HUBSPOT_BASE_URL' in url:
        parameters['headerParametersJson'] = HUBSPOT_HEADERS
    if body is not None:
        parameters['bodyParametersJson'] = body
    return {
        'id': node_id, 'name': name, 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 2,
        'position': [x, 0], 'retryOnFail': safe_retry, 'maxTries': 3 if safe_retry else 1,
        'waitBetweenTries': 5000 if safe_retry else 0, 'onError': 'stopWorkflow', 'parameters': parameters,
    }


nodes = [
    {'id': 'backend-event-trigger', 'name': 'Reply Cron: Backend Event Trigger', 'type': 'n8n-nodes-base.webhook',
     'typeVersion': 2, 'position': [0, 180], 'webhookId': 'agentflow-reply-to-deal-webhook',
     'parameters': {'httpMethod': 'POST', 'path': 'agentflow-reply-to-deal', 'responseMode': 'responseNode', 'options': {}}},
    {'id': 'sched-reply-cron', 'name': 'Reply Cron: Every 15 min', 'type': 'n8n-nodes-base.scheduleTrigger',
     'typeVersion': 1.2, 'position': [0, 0], 'parameters': {'rule': {'interval': [{'field': 'minutes', 'minutesInterval': 15}]}}},
    {'id': 'validate-backend-dispatch', 'name': 'Reply Cron: Validate Backend Dispatch Secret', 'type': 'n8n-nodes-base.code',
     'typeVersion': 2, 'position': [220, 180], 'parameters': {'jsCode': """const expected = String($env.N8N_DISPATCH_SECRET || '');
const headers = $json.headers || {};
const supplied = String(headers['x-agentflow-dispatch-secret'] || headers['X-AgentFlow-Dispatch-Secret'] || '');
return [{ json: { ...$json, dispatch_authorized: Boolean(expected && supplied && supplied === expected) } }];
"""}},
    {'id': 'if-dispatch-authorized', 'name': 'Reply Cron: Backend Dispatch Authorized?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2,
     'position': [330, 180], 'parameters': {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose'},
       'conditions': [{'id': 'cond-dispatch-authorized', 'leftValue': '={{ $json.dispatch_authorized }}', 'rightValue': True,
                       'operator': {'type': 'boolean', 'operation': 'true'}}]}, 'options': {}}},
    {'id': 'respond-dispatch-accepted', 'name': 'Reply Cron: Respond Accepted', 'type': 'n8n-nodes-base.respondToWebhook',
     'typeVersion': 1.5, 'position': [440, 180], 'parameters': {'respondWith': 'json', 'responseBody': "={{ { status: 'accepted' } }}", 'options': {'responseCode': 202}}},
    {'id': 'respond-dispatch-unauthorized', 'name': 'Reply Cron: Respond Unauthorized', 'type': 'n8n-nodes-base.respondToWebhook',
     'typeVersion': 1.5, 'position': [440, 300], 'parameters': {'respondWith': 'json', 'responseBody': "={{ { error: 'unauthorized' } }}", 'options': {'responseCode': 401}}},
    http_node('rpc-get-replied', 'Reply Cron: Get Replied', 440,
              "={{ $env.SUPABASE_URL + '/rest/v1/rpc/get_replied_outreach' }}",
              "={{ JSON.stringify({ p_limit: 10 }) }}", safe_retry=True),
    {'id': 'code-split-replied', 'name': 'Reply Cron: Split Rows', 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
     'position': [660, 0], 'parameters': {'jsCode': """const raw = $input.first()?.json;
const payload = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
const rows = Array.isArray(payload.rows) ? payload.rows : [];
if (!rows.length) return [];
return rows.map((row) => ({ json: row }));
"""}},
    {'id': 'if-existing-deal', 'name': 'Reply Cron: Existing Deal?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2,
     'position': [880, 0], 'parameters': {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose'},
       'conditions': [{'id': 'cond-existing-deal', 'leftValue': '={{ $json.deal_id }}', 'rightValue': '', 'operator': {'type': 'string', 'operation': 'notEmpty'}}]}, 'options': {}}},
    http_node('hs-upsert-contact', 'Reply Cron: Upsert Contact', 1100,
              "={{ $env.HUBSPOT_BASE_URL + '/crm/v3/objects/contacts/batch/upsert' }}",
              "={{ JSON.stringify({ inputs: [{ id: $json.email, idProperty: 'email', properties: { email: $json.email, company: $json.company_name || '' } }] }) }}", safe_retry=True),
    http_node('hs-create-deal', 'Reply Cron: Create Deal', 1320,
              "={{ $env.HUBSPOT_BASE_URL + '/crm/v3/objects/deals' }}",
              "={{ JSON.stringify({ properties: { dealname: 'Outbound Reply — ' + ($('Reply Cron: Split Rows').item.json.company_name || $('Reply Cron: Split Rows').item.json.email), amount: '0', pipeline: 'default', dealstage: 'appointmentscheduled' }, associations: [{ types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }], to: { id: $json.results[0].id } }] }) }}"),
    http_node('rpc-mark-deal', 'Reply Cron: Mark Deal Created', 1540,
              "={{ $env.SUPABASE_URL + '/rest/v1/rpc/mark_deal_created' }}",
              "={{ JSON.stringify({ p_id: $('Reply Cron: Split Rows').item.json.id, p_deal_id: $json.id }) }}"),
    http_node('rpc-evaluate-deal', 'Reply Cron: Evaluate Qualification', 1760,
              "={{ $env.SUPABASE_URL + '/rest/v1/rpc/evaluate_lead_qualification' }}",
              "={{ JSON.stringify({ p_lead_id: $('Reply Cron: Split Rows').item.json.lead_id, p_evaluation_type: 'deal_created', p_source_runtime: 'reply_deal_workflow' }) }}", safe_retry=True),
    http_node('rpc-route-deal', 'Reply Cron: Route Lead to Sales', 1980,
              "={{ $env.SUPABASE_URL + '/rest/v1/rpc/route_lead_to_sales' }}",
              "={{ JSON.stringify({ p_lead_id: $('Reply Cron: Split Rows').item.json.lead_id, p_trigger: 'reply_deal_handoff', p_force_reassign: false }) }}", safe_retry=True),
    http_node('rpc-sync-deal-crm', 'Reply Cron: Sales Sync CRM', 2200,
              "={{ $env.SUPABASE_URL + '/rest/v1/rpc/update_sales_assignment_sync' }}",
              "={{ JSON.stringify({ p_lead_id: $('Reply Cron: Split Rows').item.json.lead_id, p_crm_sync_status: 'synced', p_reason: 'reply_deal_crm_sync' }) }}"),
    {'id': 'slack-reply-deal', 'name': 'Reply Cron: Slack Alert', 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2,
     'position': [2420, 0], 'retryOnFail': False, 'maxTries': 1, 'waitBetweenTries': 0, 'onError': 'stopWorkflow',
     'parameters': {'method': 'POST', 'url': '={{ $env.SLACK_WEBHOOK_URL }}', 'sendBody': True, 'specifyBody': 'json',
       'jsonBody': "={{ JSON.stringify({ text: '🤝 REPLY → DEAL: ' + ($('Reply Cron: Split Rows').item.json.company_name || 'Unknown') + ' (' + $('Reply Cron: Split Rows').item.json.email + ') — deal ' + ($('Reply Cron: Split Rows').item.json.deal_id || $('Reply Cron: Create Deal').item.json.id) + '\\nOwner: ' + (($('Reply Cron: Route Lead to Sales').item.json.current_owner_type || 'unassigned').toUpperCase()) + ' · Priority: ' + ($('Reply Cron: Route Lead to Sales').item.json.priority_tier || 'low') }) }}",
       'options': {'timeout': 30000, 'response': {'response': {'responseFormat': 'text'}}}}},
    http_node('rpc-sync-deal-slack', 'Reply Cron: Sales Sync Slack', 2640,
              "={{ $env.SUPABASE_URL + '/rest/v1/rpc/update_sales_assignment_sync' }}",
              "={{ JSON.stringify({ p_lead_id: $('Reply Cron: Split Rows').item.json.lead_id, p_slack_sync_status: 'synced', p_reason: 'reply_deal_sales_alert' }) }}"),
    http_node('rpc-mark-reply-complete', 'Reply Cron: Mark Processing Complete', 2860,
              "={{ $env.SUPABASE_URL + '/rest/v1/rpc/mark_reply_deal_completed' }}",
              "={{ JSON.stringify({ p_id: $('Reply Cron: Split Rows').item.json.id }) }}"),
]


def target(name):
    return {'node': name, 'type': 'main', 'index': 0}


connections = {
    'Reply Cron: Backend Event Trigger': {'main': [[target('Reply Cron: Validate Backend Dispatch Secret')]]},
    'Reply Cron: Validate Backend Dispatch Secret': {'main': [[target('Reply Cron: Backend Dispatch Authorized?')]]},
    'Reply Cron: Backend Dispatch Authorized?': {'main': [[target('Reply Cron: Respond Accepted')], [target('Reply Cron: Respond Unauthorized')]]},
    'Reply Cron: Respond Accepted': {'main': [[target('Reply Cron: Get Replied')]]},
    'Reply Cron: Every 15 min': {'main': [[target('Reply Cron: Get Replied')]]},
    'Reply Cron: Get Replied': {'main': [[target('Reply Cron: Split Rows')]]},
    'Reply Cron: Split Rows': {'main': [[target('Reply Cron: Existing Deal?')]]},
    'Reply Cron: Existing Deal?': {'main': [[target('Reply Cron: Evaluate Qualification')], [target('Reply Cron: Upsert Contact')]]},
    'Reply Cron: Upsert Contact': {'main': [[target('Reply Cron: Create Deal')]]},
    'Reply Cron: Create Deal': {'main': [[target('Reply Cron: Mark Deal Created')]]},
    'Reply Cron: Mark Deal Created': {'main': [[target('Reply Cron: Evaluate Qualification')]]},
    'Reply Cron: Evaluate Qualification': {'main': [[target('Reply Cron: Route Lead to Sales')]]},
    'Reply Cron: Route Lead to Sales': {'main': [[target('Reply Cron: Sales Sync CRM')]]},
    'Reply Cron: Sales Sync CRM': {'main': [[target('Reply Cron: Slack Alert')]]},
    'Reply Cron: Slack Alert': {'main': [[target('Reply Cron: Sales Sync Slack')]]},
    'Reply Cron: Sales Sync Slack': {'main': [[target('Reply Cron: Mark Processing Complete')]]},
}

workflow = {
    'id': 'reply-to-deal', 'name': 'Reply-to-Deal', 'nodes': nodes, 'connections': connections,
    'settings': {'executionOrder': 'v1'}, 'active': False, 'pinData': {},
    'meta': {'templateCredsSetupCompleted': True}, 'tags': [{'name': 'agentflow'}, {'name': 'pre-crm'}],
}

PATH = f'{BASE}/workflows/pre-crm/reply-to-deal.workflow.json'
if '--check' in sys.argv:
    with open(PATH) as source:
        current = json.load(source)
    if current != workflow:
        raise SystemExit('Reply-to-Deal workflow differs from canonical builder output')
    print(f'Reply-to-Deal workflow is canonical: {len(nodes)} nodes')
    raise SystemExit(0)

with open(PATH, 'w') as output:
    json.dump(workflow, output, indent=2)
    output.write('\n')

print(f'Built Reply-to-Deal workflow: {len(nodes)} nodes')
