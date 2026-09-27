#!/usr/bin/env node
/**
 * M7 full-loop demo driver: SCRAPE -> INGEST -> ENGINE -> OUTREACH -> HubSpot.
 *
 * Reads the scraper's JSON output (npm run scrape -- --domains ... --output out.json),
 * keeps the decision-maker contacts, attaches strong ICP firmographics (a stand-in
 * for the Apollo ENRICHMENT stage, which is env-gated OFF in the demo), and POSTs
 * them to the v2 outbound webhook. The engine then: verify(env-off) -> dedup ->
 * enrich(env-off) -> jurisdiction -> Gemini score -> MX (sidecar) -> outbound gate
 * -> AI outreach (Gemini + real Brevo send) -> HubSpot contact upsert.
 *
 * NOTE: like M5/M6, the demo runs with the env-gated VERIFY stage off (blank
 * EMAIL_VERIFY_API_KEY in .env + n8n container recreate) because example.com is
 * a reserved domain Emailable rates `undeliverable`. Verification-ON behaviour is
 * proven separately: the engine rejects example.com with state=undeliverable.
 *
 * Usage:
 *   node scripts/demo_m7_loop.cjs [scrape_out.json] [webhook_url]
 *   defaults: /tmp/scrape_out.json  http://localhost:5678/webhook/outbound
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SCRAPE = process.argv[2] || '/tmp/scrape_out.json';
const WEBHOOK = process.argv[3] || 'http://localhost:5678/webhook/outbound';

// Strong ICP firmographics — stand-in for the Apollo enrichment stage output.
// (Same profile the M5/M6 demos used; scores the team >= 70 deterministically.)
const FIRMOGRAPHICS = {
  company_name: 'Acme Industries',
  industry: 'B2B SaaS - revenue operations platform',
  employees: '51-200',
  tech_stack: 'HubSpot, Salesforce, Clearbit, Slack',
  monthly_spend: '$3k-5k/mo',
  domain: 'example.com',
};

const all = JSON.parse(fs.readFileSync(SCRAPE, 'utf8'));

// Keep decision-makers (named OR role-bearing). Generic careers@/hello@ inboxes
// are not ICP targets — in a real run the ICP gate would filter them too.
const team = all.filter((c) => c.name || c.role);

if (!team.length) {
  console.error('No decision-maker contacts found in ' + SCRAPE);
  process.exit(1);
}

function post(contact, i) {
  // Demo-only domain mapping: the fixture site uses the fictional acmeindustries.com
  // (which has NO MX records, so the engine's MX gate would reject it). For the demo
  // the email is rewritten to example.com (real MX, synthetic, not a personal domain)
  // so the contact flows all the way through to outreach + HubSpot.
  const email = contact.email.replace(/@.*$/, '@example.com');
  const payload = {
    event_id: `evt_m7_loop_${Date.now()}_${i}`,
    email,
    company_name: contact.company || 'Acme Industries',
    source_type: 'outbound_scraped',
    ip: '203.0.113.' + ((i % 250) + 1), // synthetic demo IP
    name: contact.name || null,
    role: contact.role || null,
    domain: 'example.com',
    source_url: contact.source_url || null,
    raw_payload: { source: 'scraper-demo', url: contact.source_url || null },
    firmographics: FIRMOGRAPHICS,
  };
  const out = execSync(
    `curl -s -o /dev/null -w "%{http_code}" -X POST "${WEBHOOK}" ` +
    `-H "Content-Type: application/json" -d '${JSON.stringify(payload)}'`,
    { encoding: 'utf8' },
  ).trim();
  console.log(`POST ${email} (${contact.role || 'no role'}) -> HTTP ${out}`);
}

console.log(`Sending ${team.length} scraped decision-makers to ${WEBHOOK}`);
team.forEach(post);
console.log('Done. Wait ~30s, then check Supabase + outreach + HubSpot.');
