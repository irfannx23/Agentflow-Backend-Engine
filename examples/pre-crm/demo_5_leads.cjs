#!/usr/bin/env node
/**
 * Demo: fire 5 sample inbound leads through the PRODUCTION path
 * (Hookdeck public URL -> local n8n -> Supabase -> Gemini -> HubSpot/Slack).
 */
const https = require('https');

const HOOKDECK_URL = 'https://hkdk.events/3at57n99zasz2d';

const leads = [
  // 1. VALID new business lead -> full path: verify -> enrich -> score -> HubSpot + Slack
  {
    event_id: 'evt_demo_001',
    email: 'test21@duck.com',
    company_name: 'DuckDuckGo Inc',
    country: 'United States',
    country_code: 'US',
    raw_payload: {
      source: 'demo-run',
      form: 'website',
      message: 'Interested in pipeline automation for our sales team',
    },
    firmographics: { industry: 'Software', employees: 200 },
    icp_score: null,
    personalized_icebreaker: null,
  },
  // 2. DUPLICATE of existing lead (test20@duck.com already in DB, qualified 85)
  {
    event_id: 'evt_demo_002',
    email: 'test20@duck.com',
    company_name: 'DuckDuckGo Inc',
    country: 'United States',
    country_code: 'US',
    raw_payload: {
      source: 'demo-run',
      form: 'website',
      message: 'Second form submission, same person',
    },
    firmographics: {},
    icp_score: null,
    personalized_icebreaker: null,
  },
  // 3. REJECTED: temporary email provider + malformed text
  {
    event_id: 'evt_demo_003',
    email: 'junk@tempmail.com',
    company_name: 'Spam\u0000Corp\u0007',
    country: 'US',
    country_code: 'US',
    raw_payload: {
      source: 'demo-run',
      form: 'spam-bot',
      message: 'Buy\u0000now!!!\u0007',
    },
    firmographics: {},
    icp_score: null,
    personalized_icebreaker: null,
  },
  // 4. REJECTED: personal domain (never scored / CRM'd)
  {
    event_id: 'evt_demo_004',
    email: 'john.doe@gmail.com',
    company_name: 'Personal',
    country: 'US',
    country_code: 'US',
    raw_payload: {
      source: 'demo-run',
      form: 'website',
      message: 'Just me, no company',
    },
    firmographics: {},
    icp_score: null,
    personalized_icebreaker: null,
  },
  // 5. BLOCKED: unsupported jurisdiction at the door (Russia)
  {
    event_id: 'evt_demo_005',
    email: 'ivan@ruscorp.io',
    company_name: 'RusCorp',
    country: 'Russia',
    country_code: 'RU',
    raw_payload: {
      source: 'demo-run',
      form: 'website',
      message: 'Interested in your service',
    },
    firmographics: {},
    icp_score: null,
    personalized_icebreaker: null,
  },
];

function send(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      HOOKDECK_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data.slice(0, 200) }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log(`Firing ${leads.length} sample leads -> ${HOOKDECK_URL}\n`);
  for (const lead of leads) {
    try {
      const res = await send(lead);
      console.log(`  [${lead.event_id}] ${lead.email.padEnd(24)} HTTP ${res.status}`);
    } catch (err) {
      console.error(`  [${lead.event_id}] ERROR: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('\nAll fired. Waiting 45s for the pipeline (verify/enrich/Gemini)...');
})();
