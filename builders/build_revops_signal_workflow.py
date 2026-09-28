#!/usr/bin/env python3
"""Normalize the canonical RevOps workflow and persist runtime/security policy."""
import json
import os
import re
import sys

BASE = os.environ.get('AGENTFLOW_BACKEND_ENGINE_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = f'{BASE}/workflows/revops/signal-orchestration.workflow.json'

with open(PATH) as source:
    workflow = json.load(source)
original_workflow = json.loads(json.dumps(workflow))

nodes = workflow['nodes']
by_name = {node['name']: node for node in nodes}

by_name['RevOps: Backend Event Trigger']['parameters']['responseMode'] = 'responseNode'
by_name['RevOps: Backend Event Trigger']['webhookId'] = 'agentflow-revops-signals-webhook'
by_name['RevOps: Validate Backend Dispatch Secret']['parameters']['jsCode'] = """const expected = String($env.N8N_DISPATCH_SECRET || '');
const headers = $json.headers || {};
const supplied = String(headers['x-agentflow-dispatch-secret'] || headers['X-AgentFlow-Dispatch-Secret'] || '');
return [{ json: { ...$json, dispatch_authorized: Boolean(expected && supplied && supplied === expected) } }];
"""

security_nodes = [
    {'id': 'if-dispatch-authorized', 'name': 'RevOps: Backend Dispatch Authorized?', 'type': 'n8n-nodes-base.if', 'typeVersion': 2,
     'position': [240, 360], 'parameters': {'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose'},
       'conditions': [{'id': 'cond-dispatch-authorized', 'leftValue': '={{ $json.dispatch_authorized }}', 'rightValue': True,
                       'operator': {'type': 'boolean', 'operation': 'true'}}]}, 'options': {}}},
    {'id': 'respond-dispatch-accepted', 'name': 'RevOps: Respond Accepted', 'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.5,
     'position': [320, 360], 'parameters': {'respondWith': 'json', 'responseBody': "={{ { status: 'accepted' } }}", 'options': {'responseCode': 202}}},
    {'id': 'respond-dispatch-unauthorized', 'name': 'RevOps: Respond Unauthorized', 'type': 'n8n-nodes-base.respondToWebhook', 'typeVersion': 1.5,
     'position': [320, 500], 'parameters': {'respondWith': 'json', 'responseBody': "={{ { error: 'unauthorized' } }}", 'options': {'responseCode': 401}}},
]
for security_node in security_nodes:
    if security_node['name'] not in by_name:
        nodes.append(security_node)
        by_name[security_node['name']] = security_node

split = by_name['RevOps: Split Signals']['parameters']['jsCode']
for signal_type in ['EXPANSION_CANDIDATE', 'ACCOUNT_AT_RISK', 'HIGH_CHURN_RISK', 'MEANINGFUL_INACTIVITY']:
    if f"'{signal_type}'" not in split:
        split = split.replace("  'BUDGET_PRESSURE',", f"  'BUDGET_PRESSURE',\n  '{signal_type}',")
by_name['RevOps: Split Signals']['parameters']['jsCode'] = split

gate_name = 'RevOps: PQL Handoff Required?'
if gate_name not in by_name:
    gate = {
        'id': 'pql-signal-gate', 'name': gate_name, 'type': 'n8n-nodes-base.if', 'typeVersion': 2,
        'position': [1600, 80], 'parameters': {
            'conditions': {'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose'},
                           'conditions': [{'id': 'cond-pql-handoff',
                                           'leftValue': "={{ ['PQL_REACHED', 'UPGRADE_INTENT'].includes($json[0].signal_type) }}",
                                           'rightValue': True,
                                           'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}]},
            'options': {},
        },
    }
    nodes.append(gate)
    by_name[gate_name] = gate

safe_rpcs = {
    'assign_pql_sales_owner', 'claim_revops_signal_step', 'generate_revops_signals',
    'record_revops_hubspot_step', 'record_revops_signal_outcome', 'record_revops_slack_step',
}
for node in nodes:
    if node.get('type') != 'n8n-nodes-base.httpRequest':
        continue
    parameters = node.setdefault('parameters', {})
    parameters.setdefault('options', {}).setdefault('timeout', 30000)
    method = str(parameters.get('method') or parameters.get('requestMethod') or 'GET').upper()
    url = str(parameters.get('url') or '')
    match = re.search(r'/rpc/([a-z0-9_]+)', url, re.I)
    safe = method == 'GET' or bool(match and match.group(1) in safe_rpcs)
    node['retryOnFail'] = safe
    node['maxTries'] = 3 if safe else 1
    node['waitBetweenTries'] = 5000 if safe else 0
    node['onError'] = 'stopWorkflow'
    # Preserve n8n item lineage across multi-signal executions.
    for key in ('bodyParametersJson', 'jsonBody', 'url'):
        value = parameters.get(key)
        if isinstance(value, str):
            parameters[key] = re.sub(r"(\$\('[^']+'\))\.first\(\)", r'\1.item', value)


def target(name):
    return {'node': name, 'type': 'main', 'index': 0}


connections = workflow['connections']
connections['RevOps: Backend Event Trigger'] = {'main': [[target('RevOps: Validate Backend Dispatch Secret')]]}
connections['RevOps: Validate Backend Dispatch Secret'] = {'main': [[target('RevOps: Backend Dispatch Authorized?')]]}
connections['RevOps: Backend Dispatch Authorized?'] = {'main': [[target('RevOps: Respond Accepted')], [target('RevOps: Respond Unauthorized')]]}
connections['RevOps: Respond Accepted'] = {'main': [[target('RevOps: Dynamic Signal Scope')]]}
connections['RevOps: Get Signal Detail'] = {'main': [[target(gate_name)]]}
connections[gate_name] = {'main': [[target('RevOps: PQL Sales Handoff')], [target('RevOps: Claim HubSpot Step')]]}

workflow['name'] = 'RevOps Signal Orchestration'
workflow['settings'] = {**workflow.get('settings', {}), 'executionOrder': 'v1'}
workflow['active'] = False

if '--check' in sys.argv:
    if original_workflow != workflow:
        raise SystemExit('RevOps workflow differs from canonical builder output')
    print(f'RevOps workflow is canonical: {len(nodes)} nodes')
    raise SystemExit(0)

with open(PATH, 'w') as output:
    json.dump(workflow, output, indent=2)
    output.write('\n')

print(f'Built RevOps workflow: {len(nodes)} nodes')
