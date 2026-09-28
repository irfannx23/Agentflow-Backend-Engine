const fs = require('fs');
const path = require('path');

function loadJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'workflows', relPath), 'utf8'));
}

function check(name, actual, expected) {
  if (actual !== expected) {
    console.error(`FAIL | ${name} | expected: ${JSON.stringify(expected)} | got: ${JSON.stringify(actual)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS | ${name}`);
}

function hasNode(workflow, nodeName) {
  return workflow.nodes.some((node) => node.name === nodeName);
}

function firstTarget(workflow, nodeName) {
  return workflow.connections?.[nodeName]?.main?.[0]?.[0]?.node || null;
}

function rpcUrls(workflow) {
  return workflow.nodes
    .filter((node) => node.type === 'n8n-nodes-base.httpRequest' && node.parameters?.url)
    .map((node) => String(node.parameters.url))
    .filter((url) => url.includes('/rpc/'));
}

function rpcNodes(workflow) {
  return workflow.nodes.filter(
    (node) =>
      node.type === 'n8n-nodes-base.httpRequest' &&
      String(node.parameters?.url || '').includes('/rest/v1/rpc/'),
  );
}

const inbound = loadJson('pre-crm/lead-qualification.workflow.json');
const reply = loadJson('pre-crm/reply-to-deal.workflow.json');

check('inbound has routing node', hasNode(inbound, 'Route Lead to Sales (Inbound)'), true);
check('inbound has outbound routing node', hasNode(inbound, 'Route Lead to Sales (Outbound Ready)'), true);
check('inbound has inbound CRM sync node', hasNode(inbound, 'Sales Assignment Sync (Inbound CRM)'), true);
check('inbound has inbound Slack sync node', hasNode(inbound, 'Sales Assignment Sync (Inbound Slack)'), true);
check('inbound has outbound CRM sync node', hasNode(inbound, 'Sales Assignment Sync (Outbound CRM)'), true);
check('inbound has outbound Slack sync node', hasNode(inbound, 'Sales Assignment Sync (Outbound Slack)'), true);
check('inbound normalizes dedup output before timeline write', hasNode(inbound, 'Normalize Lead Context'), true);
check('inbound preserves lead context after timeline write', hasNode(inbound, 'Preserve Lead Context'), true);
check('inbound false branch routes before CRM gate', firstTarget(inbound, 'Route Lead to Sales (Inbound)'), 'CRM Ready?');
check('outbound ready routes before ready-to-push Slack', firstTarget(inbound, 'Evaluate Qualification (Outbound Ready)'), 'Route Lead to Sales (Outbound Ready)');
check('qualified branch records CRM sync before Slack', firstTarget(inbound, 'HubSpot: Create Deal'), 'Sales Assignment Sync (Inbound CRM)');
check('outbound contact sync records CRM sync', firstTarget(inbound, 'HubSpot: Sync Outbound Contact'), 'Sales Assignment Sync (Outbound CRM)');
check('HubSpot contact upsert normalizes contact context', firstTarget(inbound, 'HubSpot: Upsert Contact'), 'Normalize HubSpot Contact Context');
check('normalized HubSpot contact context creates deal', firstTarget(inbound, 'Normalize HubSpot Contact Context'), 'HubSpot: Create Deal');
check('dedup hands off through normalized context', firstTarget(inbound, 'Dedup: Get or Create Lead'), 'Normalize Lead Context');
check('normalized context hands off to timeline append', firstTarget(inbound, 'Normalize Lead Context'), 'Append Timeline Event');
check('append timeline hands off through preserved context', firstTarget(inbound, 'Append Timeline Event'), 'Preserve Lead Context');
check('preserved context hands off to verify gate', firstTarget(inbound, 'Preserve Lead Context'), 'Verify Email?');

const enrichGate = inbound.nodes.find((node) => node.name === 'Enrich Company?');
const enrichCall = inbound.nodes.find((node) => node.name === 'Call Enrich API');
const hubspotNormalize = inbound.nodes.find((node) => node.name === 'Normalize HubSpot Contact Context');
const hubspotDeal = inbound.nodes.find((node) => node.name === 'HubSpot: Create Deal');

check(
  'enrichment gate uses canonical ENRICH_API_KEY',
  JSON.stringify(enrichGate?.parameters || {}).includes('$env.ENRICH_API_KEY'),
  true,
);
check(
  'enrichment call uses canonical ENRICH_API_KEY header',
  JSON.stringify(enrichCall?.parameters || {}).includes('x-api-key') &&
    JSON.stringify(enrichCall?.parameters || {}).includes('$env.ENRICH_API_KEY'),
  true,
);
const scoringNode = inbound.nodes.find((node) => node.name === 'Score Lead (Gemini)');
const scoringCall = inbound.nodes.find((node) => node.name === 'Call Gemini API');
const scoreUpdate = inbound.nodes.find((node) => node.name === 'Update Lead Score');
check('AgentFlow scoring prompt is active', String(scoringNode?.parameters?.jsCode || '').includes('lead qualification intelligence layer for AgentFlow'), true);
check('signup buying intent is strictly unknown', JSON.stringify(scoringCall?.parameters || {}).includes("enum: ['unknown']"), true);
check('old scoring assumptions absent', /CostPilot|CostPulse|tech stack maturity/i.test(String(scoringNode?.parameters?.jsCode || '')), false);
check('Apollo no-match has deterministic branch', hasNode(inbound, 'Build Low-Confidence Qualification'), true);
check('database intent persists as null at signup', String(scoreUpdate?.parameters?.bodyParametersJson || '').includes('p_buying_intent: null'), true);
check(
  'HubSpot contact normalizer emits hubspot_contact_id',
  String(hubspotNormalize?.parameters?.jsCode || '').includes('hubspot_contact_id'),
  true,
);
check(
  'HubSpot contact normalizer strips composite 0-1 prefix',
  String(hubspotNormalize?.parameters?.jsCode || '').includes("replace(/^0-1-/"),
  true,
);
check(
  'HubSpot deal consumes normalized plain contact id',
  String(hubspotDeal?.parameters?.bodyParametersJson || '').includes('hubspot_contact_id'),
  true,
);
check(
  'HubSpot deal no longer uses raw $json.id association',
  String(hubspotDeal?.parameters?.bodyParametersJson || '').includes('to: { id: $json.id }'),
  false,
);
check(
  'HubSpot deal body contains no hardcoded composite contact object prefix',
  String(hubspotDeal?.parameters?.bodyParametersJson || '').includes('0-1-'),
  false,
);

check('reply workflow has sales route node', hasNode(reply, 'Reply Cron: Route Lead to Sales'), true);
check('reply workflow has CRM sync node', hasNode(reply, 'Reply Cron: Sales Sync CRM'), true);
check('reply workflow has Slack sync node', hasNode(reply, 'Reply Cron: Sales Sync Slack'), true);
check('reply workflow routes after qualification refresh', firstTarget(reply, 'Reply Cron: Evaluate Qualification'), 'Reply Cron: Route Lead to Sales');
check('reply workflow marks CRM sync before Slack', firstTarget(reply, 'Reply Cron: Route Lead to Sales'), 'Reply Cron: Sales Sync CRM');
check('reply workflow marks Slack sync after alert', firstTarget(reply, 'Reply Cron: Slack Alert'), 'Reply Cron: Sales Sync Slack');
check('reply workflow completes polling only after Slack sync', firstTarget(reply, 'Reply Cron: Sales Sync Slack'), 'Reply Cron: Mark Processing Complete');
check('reply workflow has no cross-row first() reference', JSON.stringify(reply).includes("$('Reply Cron: Split Rows').first()"), false);
check('reply workflow retries get replied on transient failures', (() => {
  const node = reply.nodes.find((candidate) => candidate.name === 'Reply Cron: Get Replied');
  return Boolean(node && node.retryOnFail === true && node.maxTries === 3 && node.waitBetweenTries === 5000);
})(), true);
check(
  'inbound RPC URLs use env-based Supabase endpoint',
  rpcUrls(inbound).every((url) => /^=\{\{\s*\$env\.SUPABASE_URL \+ '\/rest\/v1\/rpc\//.test(url)),
  true,
);
check(
  'reply RPC URLs use env-based Supabase endpoint',
  rpcUrls(reply).every((url) => /^=\{\{\s*\$env\.SUPABASE_URL \+ '\/rest\/v1\/rpc\//.test(url)),
  true,
);
check(
  'no workflow RPC URL targets local docker Supabase',
  [...rpcUrls(inbound), ...rpcUrls(reply)].some((url) => url.includes('host.docker.internal:54321')),
  false,
);
check(
  'inbound RPC nodes send explicit hosted Supabase auth headers',
  rpcNodes(inbound).every(
    (node) =>
      node.typeVersion === 2 &&
      String(node.parameters?.headerParametersJson || '').includes('$env.SUPABASE_SERVICE_ROLE_KEY') &&
      !node.credentials,
  ),
  true,
);
check(
  'reply RPC nodes send explicit hosted Supabase auth headers',
  rpcNodes(reply).every(
    (node) =>
      node.typeVersion === 2 &&
      String(node.parameters?.headerParametersJson || '').includes('$env.SUPABASE_SERVICE_ROLE_KEY') &&
      !node.credentials,
  ),
  true,
);

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('\n=== RESULT: sales routing workflow structure verified ===');
