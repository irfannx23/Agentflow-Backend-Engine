import test from 'node:test'
import assert from 'node:assert/strict'

const baseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const runtimeTestOptions =
  baseUrl && serviceRoleKey
    ? {}
    : { skip: 'requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY' }

const runtimeTest = (name, fn) => test(name, runtimeTestOptions, fn)

async function rest(path, init = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`REST ${path} failed: ${response.status} ${body}`)
  }

  if (response.status === 204) return null
  return response.json()
}

async function rpc(name, payload) {
  return rest(`rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  })
}

async function insertRow(path, payload) {
  const rows = await rest(`${path}?select=*`, {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  })
  return Array.isArray(rows) ? rows[0] : rows
}

async function fetchRows(path) {
  return rest(path, { method: 'GET' })
}

function uniqueToken(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

runtimeTest('signal assembly reuses acquisition, engagement, and lead data', async () => {
  const token = uniqueToken('assembly')
  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: `${token}@example.com`,
    company_name: 'Assembly Labs',
    raw_payload: { source: 'demo_request', campaign: 'launch_q4' },
    firmographics: { industry: 'FinTech', employees: 65 },
    icp_score: 72,
    buying_intent: 'medium',
    status: 'qualified',
    source_type: 'inbound',
  })

  await insertRow('lead_events', {
    lead_id: lead.id,
    event_type: 'lead.captured',
    event_data: { source: 'demo_request' },
  })

  await insertRow('acquisition_touches', {
    lead_id: lead.id,
    channel: 'inbound',
    source: 'demo_request',
    source_id: token,
    medium: 'web_form',
    campaign: 'launch_q4',
    touch_type: 'last_touch',
    metadata: { test_case: token },
  })

  const rows = await fetchRows(`lead_qualification_signal_assembly?lead_id=eq.${lead.id}&select=*`)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].lead_id, lead.id)
  assert.equal(rows[0].acquisition_channel, 'inbound')
  assert.equal(rows[0].acquisition_source, 'demo_request')
  assert.equal(rows[0].lead_event_count >= 1, true)
})

runtimeTest('formal MQL can qualify a moderate-fit high-intent lead before SQL', async () => {
  const token = uniqueToken('mql')
  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: `${token}@example.com`,
    company_name: 'MQL Systems',
    raw_payload: { source: 'pricing_form' },
    firmographics: { industry: 'SaaS', employees: 40, monthly_spend: 2500 },
    icp_score: 65,
    buying_intent: 'high',
    status: 'nurture',
    source_type: 'inbound',
  })

  const result = await rpc('evaluate_lead_qualification', {
    p_lead_id: lead.id,
    p_evaluation_type: 'score_update',
    p_source_runtime: 'precrm_n8n',
  })

  assert.equal(result[0].mql_status, 'qualified')
  assert.equal(result[0].sql_status, 'awaiting_engagement')
  assert.equal(result[0].crm_ready, false)
  assert.equal(result[0].pql_status, 'insufficient_product_signals')
})

runtimeTest('outbound readiness upgrades SQL without inventing a second scorer', async () => {
  const token = uniqueToken('sql')
  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: `${token}@example.com`,
    company_name: 'Outbound Ready Co',
    raw_payload: { source: 'scraper', url: 'https://example.com' },
    firmographics: { industry: 'AI', employees: 150 },
    icp_score: 78,
    buying_intent: 'high',
    status: 'ready_to_push',
    source_type: 'outbound_scraped',
  })

  await insertRow('lead_events', {
    lead_id: lead.id,
    event_type: 'lead.ready_to_push',
    event_data: {},
  })

  const result = await rpc('evaluate_lead_qualification', {
    p_lead_id: lead.id,
    p_evaluation_type: 'outbound_ready',
    p_source_runtime: 'precrm_n8n',
  })

  assert.equal(result[0].sql_status, 'sales_ready')
  assert.equal(result[0].outbound_ready, true)
  assert.equal(['urgent', 'high', 'medium'].includes(result[0].priority_tier), true)
})

runtimeTest('PQL remains insufficient even when current product events exist', async () => {
  const token = uniqueToken('pql')
  const profile = await insertRow('profiles', {
    firebase_uid: `${token}-uid`,
    email: `${token}@example.com`,
    display_name: 'PQL User',
    auth_provider: 'password',
    last_login_at: '2026-08-27T10:00:00.000Z',
  })

  const account = await insertRow('accounts', {
    name: 'PQL Account',
    slug: token,
    primary_domain: 'example.com',
    onboarding_status: 'completed',
  })

  await insertRow('account_members', {
    account_id: account.id,
    profile_id: profile.id,
    role: 'owner',
    is_owner: true,
  })

  await insertRow('onboarding_responses', {
    profile_id: profile.id,
    account_id: account.id,
    company_size: '11–50',
    providers: ['OpenAI', 'AWS'],
    estimated_monthly_spend: '$1K–$5K',
    raw_answers: {
      company_size: '11–50',
      providers: ['OpenAI', 'AWS'],
      estimated_monthly_spend: '$1K–$5K',
    },
    completed_at: '2026-08-27T10:05:00.000Z',
  })

  await insertRow('product_events', {
    profile_id: profile.id,
    account_id: account.id,
    firebase_uid: profile.firebase_uid,
    event_name: 'signup',
    event_source: 'web_app',
    event_properties: {},
  })
  await insertRow('product_events', {
    profile_id: profile.id,
    account_id: account.id,
    firebase_uid: profile.firebase_uid,
    event_name: 'onboarding_completed',
    event_source: 'web_app',
    event_properties: { company_size: '11–50', provider_count: 2 },
  })
  await insertRow('product_events', {
    profile_id: profile.id,
    account_id: account.id,
    firebase_uid: profile.firebase_uid,
    event_name: 'dashboard_viewed',
    event_source: 'web_app',
    event_properties: {},
  })

  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: profile.email,
    company_name: 'PQL Maybe Inc',
    raw_payload: { source: 'website' },
    firmographics: { industry: 'Infra', employees: 30 },
    icp_score: 74,
    buying_intent: 'medium',
    status: 'qualified',
    source_type: 'inbound',
  })

  const result = await rpc('evaluate_lead_qualification', {
    p_lead_id: lead.id,
    p_evaluation_type: 'score_update',
    p_source_runtime: 'precrm_n8n',
  })

  const signalRows = await fetchRows(`lead_qualification_signal_assembly?lead_id=eq.${lead.id}&select=product_event_count,onboarding_completed_count,dashboard_viewed_count`)
  assert.equal(signalRows[0].product_event_count >= 3, true)
  assert.equal(signalRows[0].onboarding_completed_count >= 1, true)
  assert.equal(result[0].pql_status, 'insufficient_product_signals')
})

runtimeTest('reply or deal activity raises priority and current-state views stay queryable', async () => {
  const token = uniqueToken('deal')
  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: `${token}@example.com`,
    company_name: 'Deal Signal LLC',
    raw_payload: { source: 'scraper', url: 'https://example.com' },
    firmographics: { industry: 'Security', employees: 220 },
    icp_score: 83,
    buying_intent: 'high',
    status: 'emailed',
    source_type: 'outbound_scraped',
  })

  await insertRow('lead_events', {
    lead_id: lead.id,
    event_type: 'lead.ready_to_push',
    event_data: {},
  })

  await insertRow('outreach', {
    lead_id: lead.id,
    email: lead.email,
    subject: 'Quick question',
    body: 'Can we help?',
    status: 'replied',
    reply_received_at: '2026-08-27T11:00:00.000Z',
    deal_id: 'hs_deal_123',
  })

  const result = await rpc('evaluate_lead_qualification', {
    p_lead_id: lead.id,
    p_evaluation_type: 'deal_created',
    p_source_runtime: 'reply_deal_workflow',
  })

  assert.equal(result[0].sql_status, 'sales_ready')
  assert.equal(result[0].priority_tier, 'urgent')

  const current = await fetchRows(`lead_current_qualification?lead_id=eq.${lead.id}&select=lead_id,sql_status,priority_tier`)
  assert.equal(current[0].sql_status, 'sales_ready')

  const metrics = await fetchRows('qualification_channel_metrics?select=acquisition_channel,sql_leads')
  assert.equal(Array.isArray(metrics), true)
})
