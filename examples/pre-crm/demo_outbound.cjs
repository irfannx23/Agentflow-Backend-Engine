#!/usr/bin/env node
/**
 * Demo: fire OUTBOUND (scraped/list) contacts through the PRODUCTION path
 * into the v2 outbound webhook (localhost n8n -> Supabase). This is the v2
 * front door for the scraper output.
 *
 * Usage:
 *   node scripts/demo_outbound.cjs                 # 2 inline synthetic contacts
 *   node scripts/demo_outbound.cjs --file /tmp/scrape_out.json   # scraper output
 *   node scripts/demo_outbound.cjs --webhook http://localhost:5678/webhook/outbound
 */
const fs = require('fs');
const { execSync } = require('child_process');

const WEBHOOK = process.argv.find((_, i) => process.argv[i - 1] === '--webhook')
  || 'http://localhost:5678/webhook/outbound';

const INLINE = [
  {
    email: 'sarah.ops@example.com',
    name: 'Sarah Ops',
    role: 'Head of Sales',
    company: 'RevOps Flow',
    domain: 'example.com',
    source_url: 'http://localhost:8080/team.html',
    firmographics: {
      company_name: 'RevOps Flow',
      industry: 'B2B SaaS - revenue operations platform',
      employees: '51-200',
      tech_stack: 'HubSpot, Salesforce, Clearbit, Slack',
      monthly_spend: '$3k-5k/mo',
      domain: 'example.com',
    },
  },
  {
    email: 'dev.lead@example.com',
    name: 'Dev Lead',
    role: 'CTO',
    company: 'RevOps Flow',
    domain: 'example.com',
    source_url: 'http://localhost:8080/team.html',
    firmographics: {
      company_name: 'RevOps Flow',
      industry: 'B2B SaaS - revenue operations platform',
      employees: '51-200',
      tech_stack: 'HubSpot, Salesforce, Clearbit, Slack',
      monthly_spend: '$3k-5k/mo',
      domain: 'example.com',
    },
  },
];

let contacts;
const fileFlag = process.argv.indexOf('--file');
if (fileFlag >= 0) {
  contacts = JSON.parse(fs.readFileSync(process.argv[fileFlag + 1], 'utf8'));
} else {
  contacts = INLINE;
}

function post(contact, i) {
  const payload = {
    event_id: `evt_out_demo_${Date.now()}_${i}`,
    email: contact.email,
    company_name: contact.company || contact.domain,
    source_type: 'outbound_scraped',
    ip: '203.0.113.' + ((i % 250) + 1), // synthetic demo IP
    name: contact.name || null,
    role: contact.role || null,
    domain: contact.domain || null,
    source_url: contact.source_url || null,
    raw_payload: { source: 'scraper-demo', url: contact.source_url || null },
    firmographics: contact.firmographics || {},
  };
  const out = execSync(
    `curl -s -o /dev/null -w "%{http_code}" -X POST "${WEBHOOK}" ` +
    `-H "Content-Type: application/json" -d '${JSON.stringify(payload)}'`,
    { encoding: 'utf8' },
  ).trim();
  console.log(`POST ${contact.email} -> HTTP ${out}`);
}

console.log(`Sending ${contacts.length} outbound contacts to ${WEBHOOK}`);
contacts.forEach(post);
console.log('Done. Wait ~25s, then check Supabase staged_leads (source_type=outbound_scraped).');
