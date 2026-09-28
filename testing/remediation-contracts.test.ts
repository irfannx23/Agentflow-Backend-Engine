import assert from 'node:assert/strict'
import test from 'node:test'

import { workflowRegistry } from '../registry/index.js'
import { loadWorkflow } from '../runtime/workflow-loader.js'
import { checkMx, clearMxCache, setMxResolver } from '../integrations/mx-service/mx-check.js'

async function workflow(id: string) {
  const definition = workflowRegistry.get(id)
  assert.ok(definition)
  return loadWorkflow(definition)
}

test('Lead Qualification uses current Emailable, Gemini, HubSpot, and Brevo contracts', async () => {
  const lead = await workflow('pre-crm.lead-qualification')
  const node = (name: string) => lead.nodes.find(candidate => candidate.name === name)
  assert.match(String(node('Call Verify API')?.parameters?.url), /\/v1\/verify/)
  assert.match(JSON.stringify(node('Call Verify API')?.parameters), /api_key/)
  assert.match(JSON.stringify(node('Call Verify API')?.parameters), /email/)
  assert.match(String(node('Call Gemini API')?.parameters?.url), /GEMINI_MODEL/)
  assert.match(JSON.stringify(node('Call Gemini API')?.parameters), /x-goog-api-key/)
  assert.match(JSON.stringify(node('Call Gemini API')?.parameters), /responseJsonSchema/)
  assert.match(JSON.stringify(node('Call Gemini API')?.parameters), /qualification_reason/)
  assert.match(JSON.stringify(node('Call Gemini API')?.parameters), /company_summary/)
  assert.match(JSON.stringify(node('Call Gemini API')?.parameters), /enum.*unknown/)
  assert.ok(node('Build Low-Confidence Qualification'))
  assert.ok(node('Normalize Score Context'))
  assert.ok(node('Record Gemini Scoring Failure'))
  assert.equal(node('Call Gemini API')?.onError, 'continueErrorOutput')
  assert.equal(node('Parse Gemini Score')?.onError, 'continueErrorOutput')
  assert.equal(lead.connections['Call Gemini API']?.main?.[1]?.[0]?.node, 'Normalize Gemini Scoring Failure')
  assert.equal(lead.connections['Gemini Scoring Required?']?.main?.[1]?.[0]?.node, 'Deterministic Qualification Required?')
  assert.doesNotMatch(String(node('Score Lead (Gemini)')?.parameters?.jsCode), /CostPilot|CostPulse|tech stack maturity/i)
  assert.match(String(node('HubSpot: Upsert Contact')?.parameters?.url), /contacts\/batch\/upsert/)
  assert.doesNotMatch(JSON.stringify(node('HubSpot: Sync Outbound Contact')?.parameters), /lead_source|outreach_status/)
  assert.match(String(node('Send Nurture Email (Brevo)')?.parameters?.url), /\/v3\/smtp\/email/)
})

test('all backend webhooks validate the dispatch secret before business operations', async () => {
  for (const id of ['pre-crm.lead-qualification', 'pre-crm.reply-to-deal', 'revops.signal-orchestration']) {
    const value = await workflow(id)
    assert.match(JSON.stringify(value), /N8N_DISPATCH_SECRET/, id)
    assert.match(JSON.stringify(value), /Respond[^"]*Unauthorized/, id)
    const backendWebhook = value.nodes.find(node => node.name.includes('Backend') && node.type === 'n8n-nodes-base.webhook')
    assert.equal(backendWebhook?.parameters?.responseMode, 'responseNode', id)
  }
})

test('Reply-to-Deal preserves per-item linkage and defers completion until downstream work succeeds', async () => {
  const reply = await workflow('pre-crm.reply-to-deal')
  const serialized = JSON.stringify(reply)
  assert.doesNotMatch(serialized, /Reply Cron: Split Rows'\)\.first/)
  assert.match(serialized, /Reply Cron: Split Rows'\)\.item/)
  assert.ok(reply.nodes.some(node => node.name === 'Reply Cron: Existing Deal?'))
  assert.equal(reply.connections['Reply Cron: Sales Sync Slack']?.main?.[0]?.[0]?.node, 'Reply Cron: Mark Processing Complete')
  assert.equal(reply.connections['Reply Cron: Existing Deal?']?.main?.[0]?.[0]?.node, 'Reply Cron: Evaluate Qualification')
})

test('RevOps accepts every canonical signal and gates PQL handoff', async () => {
  const revops = await workflow('revops.signal-orchestration')
  const serialized = JSON.stringify(revops)
  for (const signal of [
    'PQL_REACHED', 'EXPANSION_CANDIDATE', 'ACCOUNT_AT_RISK', 'HIGH_CHURN_RISK',
    'UPGRADE_INTENT', 'BUDGET_PRESSURE', 'ALLOWANCE_PRESSURE',
    'SIGNIFICANT_USAGE_GROWTH', 'MEANINGFUL_INACTIVITY', 'SUBSCRIPTION_ACTIVATED',
  ]) assert.match(serialized, new RegExp(signal))
  assert.ok(revops.nodes.some(node => node.name === 'RevOps: PQL Handoff Required?'))
  assert.match(serialized, /p_account_id/)
  assert.match(serialized, /revops_backend_dispatch_requires_account_id/)
})

test('MX check rejects RFC 7505 null MX', async () => {
  clearMxCache()
  setMxResolver(async () => [{ priority: 0, exchange: '.' }])
  const result = await checkMx('null-mx.example')
  assert.equal(result.hasMx, false)
  assert.equal(result.error, 'null_mx')
})
