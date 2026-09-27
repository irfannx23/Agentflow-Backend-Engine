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
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })
  return Array.isArray(rows) ? rows[0] : rows
}

async function patchRows(path, payload) {
  const rows = await rest(path, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })
  return Array.isArray(rows) ? rows : []
}

async function fetchRows(path) {
  return rest(path, { method: 'GET' })
}

function uniqueToken(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

async function evaluateAndRoute(leadId, evaluationType = 'score_update', trigger = 'test_route', sourceRuntime = 'precrm_n8n') {
  await rpc('evaluate_lead_qualification', {
    p_lead_id: leadId,
    p_evaluation_type: evaluationType,
    p_source_runtime: sourceRuntime,
  })

  return rpc('route_lead_to_sales', {
    p_lead_id: leadId,
    p_trigger: trigger,
    p_force_reassign: false,
  })
}

runtimeTest('blocked or unverified leads are never routed to sales', async () => {
  const token = uniqueToken('blocked')
  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: `${token}@example.com`,
    company_name: 'Blocked Co',
    raw_payload: { source: 'website' },
    firmographics: { industry: 'AI', employees: 90, country_code: 'US' },
    icp_score: 85,
    buying_intent: 'high',
    status: 'unverified',
    source_type: 'inbound',
  })

  const routed = await evaluateAndRoute(lead.id, 'verification_failed', 'blocked_test')
  assert.equal(routed[0].routing_status, 'unassigned')
  assert.equal(routed[0].current_rep_id, null)
})

runtimeTest('outbound SQL leads route to SDR ownership first', async () => {
  const token = uniqueToken('outbound')
  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: `${token}@example.com`,
    company_name: 'Outbound SQL Inc',
    raw_payload: { source: 'scraper' },
    firmographics: { industry: 'AI', employees: 70, country_code: 'US' },
    icp_score: 79,
    buying_intent: 'high',
    status: 'ready_to_push',
    source_type: 'outbound_scraped',
  })

  await insertRow('lead_events', {
    lead_id: lead.id,
    event_type: 'lead.ready_to_push',
    event_data: {},
  })

  const routed = await evaluateAndRoute(lead.id, 'outbound_ready', 'outbound_sql')
  assert.equal(routed[0].current_owner_type, 'sdr')
  assert.equal(routed[0].routing_status, 'assigned')
  assert.equal(routed[0].routing_reason, 'outbound_sql_to_sdr')
})

runtimeTest('enterprise high-intent inbound SQL can route directly to AE', async () => {
  const token = uniqueToken('enterprise')
  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: `${token}@example.com`,
    company_name: 'Enterprise Buyer',
    raw_payload: { source: 'demo_request' },
    firmographics: { industry: 'FinTech', employees: 350, country_code: 'US' },
    icp_score: 88,
    buying_intent: 'high',
    status: 'qualified',
    source_type: 'inbound',
  })

  const routed = await evaluateAndRoute(lead.id, 'score_update', 'enterprise_inbound')
  assert.equal(routed[0].current_owner_type, 'ae')
  assert.equal(routed[0].segment, 'enterprise')
  assert.equal(routed[0].routing_reason, 'enterprise_high_intent_sql')
})

runtimeTest('reply or deal activity hands an SDR-owned lead to AE', async () => {
  const token = uniqueToken('handoff')
  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: `${token}@example.com`,
    company_name: 'Reply Handoff Co',
    raw_payload: { source: 'scraper' },
    firmographics: { industry: 'Security', employees: 120, country_code: 'US' },
    icp_score: 82,
    buying_intent: 'high',
    status: 'ready_to_push',
    source_type: 'outbound_scraped',
  })

  await insertRow('lead_events', {
    lead_id: lead.id,
    event_type: 'lead.ready_to_push',
    event_data: {},
  })

  const firstRoute = await evaluateAndRoute(lead.id, 'outbound_ready', 'handoff_seed')
  assert.equal(firstRoute[0].current_owner_type, 'sdr')

  await insertRow('outreach', {
    lead_id: lead.id,
    email: lead.email,
    subject: 'Quick question',
    body: 'Can we help?',
    status: 'replied',
    reply_received_at: '2026-08-27T11:00:00.000Z',
    deal_id: 'hs_deal_handoff',
  })

  const secondRoute = await evaluateAndRoute(lead.id, 'deal_created', 'reply_handoff', 'reply_deal_workflow')
  assert.equal(secondRoute[0].current_owner_type, 'ae')
  assert.equal(secondRoute[0].routing_status, 'handed_off')
  assert.equal(secondRoute[0].routing_reason, 'reply_or_deal_handoff')
})

runtimeTest('routing is idempotent for unchanged qualification state', async () => {
  const token = uniqueToken('idem')
  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: `${token}@example.com`,
    company_name: 'Idempotent Co',
    raw_payload: { source: 'demo_request' },
    firmographics: { industry: 'SaaS', employees: 45, country_code: 'US' },
    icp_score: 76,
    buying_intent: 'medium',
    status: 'qualified',
    source_type: 'inbound',
  })

  const first = await evaluateAndRoute(lead.id, 'score_update', 'idem_first')
  const historyBefore = await fetchRows(`sales_assignment_history?lead_id=eq.${lead.id}&select=id`)
  const second = await rpc('route_lead_to_sales', {
    p_lead_id: lead.id,
    p_trigger: 'idem_second',
    p_force_reassign: false,
  })
  const historyAfter = await fetchRows(`sales_assignment_history?lead_id=eq.${lead.id}&select=id`)

  assert.equal(first[0].assignment_id, second[0].assignment_id)
  assert.equal(historyAfter.length, historyBefore.length)
})

runtimeTest('manual override is preserved on later auto-routing', async () => {
  const token = uniqueToken('override')
  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: `${token}@example.com`,
    company_name: 'Manual Override Co',
    raw_payload: { source: 'demo_request' },
    firmographics: { industry: 'SaaS', employees: 85, country_code: 'US' },
    icp_score: 77,
    buying_intent: 'medium',
    status: 'qualified',
    source_type: 'inbound',
  })

  await evaluateAndRoute(lead.id, 'score_update', 'override_seed')

  const overridden = await rpc('override_sales_assignment', {
    p_lead_id: lead.id,
    p_rep_code: 'ethan_cole',
    p_reason: 'manual_hot_account',
    p_force_owner_type: 'ae',
  })
  assert.equal(overridden[0].routing_status, 'manually_overridden')

  const rerouted = await rpc('route_lead_to_sales', {
    p_lead_id: lead.id,
    p_trigger: 'override_reroute',
    p_force_reassign: false,
  })

  assert.equal(rerouted[0].routing_status, 'manually_overridden')
  assert.equal(rerouted[0].current_owner_type, 'ae')
})

runtimeTest('missing matching rep falls back to retry_required', async () => {
  const sdrs = await fetchRows('sales_reps?role=eq.sdr&select=id,rep_code,active')
  const disabled = await patchRows('sales_reps?role=eq.sdr&select=*', { active: false })
  assert.equal(disabled.length >= 1, true)

  try {
    const token = uniqueToken('retry')
    const lead = await insertRow('staged_leads', {
      event_id: token,
      email: `${token}@example.com`,
      company_name: 'Retry Queue Co',
      raw_payload: { source: 'scraper' },
      firmographics: { industry: 'AI', employees: 60, country_code: 'US' },
      icp_score: 81,
      buying_intent: 'high',
      status: 'ready_to_push',
      source_type: 'outbound_scraped',
    })

    await insertRow('lead_events', {
      lead_id: lead.id,
      event_type: 'lead.ready_to_push',
      event_data: {},
    })

    const routed = await evaluateAndRoute(lead.id, 'outbound_ready', 'retry_required')
    assert.equal(routed[0].routing_status, 'retry_required')
    assert.equal(routed[0].current_rep_id, null)
  } finally {
    for (const rep of sdrs) {
      await patchRows(`sales_reps?id=eq.${rep.id}&select=*`, { active: rep.active })
    }
  }
})

runtimeTest('queue surfaces expose hot leads in descending priority order', async () => {
  const leads = []

  for (const [suffix, score, intent] of [['hota', 90, 'high'], ['hotb', 78, 'medium']]) {
    const token = uniqueToken(suffix)
    const lead = await insertRow('staged_leads', {
      event_id: token,
      email: `${token}@example.com`,
      company_name: `Hot ${suffix}`,
      raw_payload: { source: 'demo_request' },
      firmographics: { industry: 'AI', employees: 110, country_code: 'US' },
      icp_score: score,
      buying_intent: intent,
      status: 'qualified',
      source_type: 'inbound',
    })

    await evaluateAndRoute(lead.id, 'score_update', `hot_${suffix}`)
    leads.push(lead)
  }

  const hot = await fetchRows('hot_sales_leads?select=lead_id,priority_score&order=priority_score.desc&limit=2')
  assert.equal(hot.length >= 2, true)
  assert.equal(hot[0].priority_score >= hot[1].priority_score, true)
})

runtimeTest('sync state updates are tracked for CRM and Slack delivery', async () => {
  const token = uniqueToken('sync')
  const lead = await insertRow('staged_leads', {
    event_id: token,
    email: `${token}@example.com`,
    company_name: 'Sync State Co',
    raw_payload: { source: 'demo_request' },
    firmographics: { industry: 'AI', employees: 95, country_code: 'US' },
    icp_score: 80,
    buying_intent: 'high',
    status: 'qualified',
    source_type: 'inbound',
  })

  await evaluateAndRoute(lead.id, 'score_update', 'sync_seed')

  const updated = await rpc('update_sales_assignment_sync', {
    p_lead_id: lead.id,
    p_crm_sync_status: 'synced',
    p_slack_sync_status: 'retry_required',
    p_last_error: 'slack_timeout',
    p_increment_retry: true,
    p_reason: 'post_notification',
  })

  assert.equal(updated[0].crm_sync_status, 'synced')
  assert.equal(updated[0].slack_sync_status, 'retry_required')
  assert.equal(updated[0].routing_status, 'retry_required')
  assert.equal(updated[0].retry_count >= 1, true)
})
