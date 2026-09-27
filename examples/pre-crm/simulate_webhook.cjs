/**
 * ============================================
 * Pre-CRM Engine — Webhook Simulation Script
 * ============================================
 * Fires two simulated lead payloads to the local
 * Hookdeck tunnel (which forwards to the n8n webhook).
 *
 *  1. VALID lead   -> alex@ai-labs.io (professional formatting)
 *  2. REJECTED lead -> @tempmail.com + malformed text
 *
 * This confirms the Ingestion & Sanitization logic
 * (Step 2) is working before Module 3: Claude AI.
 *
 * Usage:
 *   node scripts/simulate_webhook.js
 *
 * Environment variables (optional, with defaults):
 *   WEBHOOK_URL  - the n8n webhook URL (or Hookdeck tunnel URL)
 *                  Default: http://localhost:5678/webhook/hookdeck-lead-ingest
 *   HOOKDECK_URL - if set, overrides WEBHOOK_URL (Hookdeck tunnel)
 *
 * Data privacy: uses strictly synthetic test payloads.
 * ============================================
 */

const http = require('http');
const https = require('https');

// --- Configuration ---------------------------------------------------------
const WEBHOOK_URL =
  process.env.HOOKDECK_URL ||
  process.env.WEBHOOK_URL ||
  'http://localhost:5678/webhook/hookdeck-lead-ingest';

// --- Test payloads ---------------------------------------------------------

// 1. VALID lead — professional formatting, business domain.
const VALID_LEAD = {
  event_id: 'evt_test_valid_001',
  email: '  Alex@ai-labs.io  ', // extra whitespace to test normalization
  company_name: '  AI   Labs  ', // extra whitespace to test text stripping
  raw_payload: {
    source: 'test-simulator',
    form: 'website',
    message: 'Interested in RevOps automation',
  },
  firmographics: {
    industry: 'SaaS',
    employees: 50,
  },
  icp_score: null,
  personalized_icebreaker: null,
};

// 2. REJECTED lead — temporary email provider + malformed text.
const REJECTED_LEAD = {
  event_id: 'evt_test_rejected_001',
  email: 'junk@tempmail.com', // blocked temporary provider
  company_name: 'Spam\u0000Corp\u0007', // control characters (malformed)
  raw_payload: {
    source: 'test-simulator',
    form: 'spam-bot',
    message: 'Buy\u0000now!!!\u0007',
  },
  firmographics: {},
  icp_score: null,
  personalized_icebreaker: null,
};

// --- HTTP helpers ----------------------------------------------------------

function sendRequest(url, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const body = JSON.stringify(payload);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --- Main ------------------------------------------------------------------

async function main() {
  console.log('============================================');
  console.log('Pre-CRM Engine — Webhook Simulation');
  console.log('============================================');
  console.log(`Target URL: ${WEBHOOK_URL}\n`);

  const cases = [
    { label: 'VALID lead (alex@ai-labs.io)', payload: VALID_LEAD },
    { label: 'REJECTED lead (@tempmail.com)', payload: REJECTED_LEAD },
  ];

  for (const c of cases) {
    console.log(`--- ${c.label} ---`);
    try {
      const res = await sendRequest(WEBHOOK_URL, c.payload);
      console.log(`  HTTP ${res.status}`);
      if (res.body) {
        console.log(`  Response: ${res.body.slice(0, 300)}`);
      }
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      console.error(
        '  Is n8n running and the webhook active? Is the Hookdeck tunnel up?'
      );
    }
    console.log('');
  }

  console.log('Done. Check n8n execution logs to confirm sanitization.');
}

main();
