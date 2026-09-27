#!/usr/bin/env node
/**
 * Unit tests for the Stage 4 enrichment merger (mergeEnrichment).
 * Extracts the REAL function from Automation/n8n/Code_Nodes/n8n-enrich-parse.js.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const snippetPath = path.join(__dirname, '..', '..', '..', 'core', 'pre-crm', 'n8n-code-nodes', 'n8n-enrich-parse.js');
const source = fs.readFileSync(snippetPath, 'utf8');

const head = source.split('export default')[0];
const start = head.indexOf('function mergeEnrichment');
if (start === -1) {
  console.error('FAIL: mergeEnrichment not found in snippet');
  process.exit(1);
}
const fnCode = head.slice(start).replace(/\}\s*$/, '}');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fnCode + '\nthis.mergeEnrichment = mergeEnrichment;', sandbox);
const mergeEnrichment = sandbox.mergeEnrichment;

const base = { industry: 'AI', employees: 30, tech_stack: ['Python'] };
const apolloOrg = {
  name: 'Duck Labs',
  industry: 'Email privacy SaaS',
  estimated_num_employees: 120,
  country: 'US',
  city: 'San Francisco',
};

const cases = [
  // [name, inputJson, base, expected checks]
  ['full org enriches and wins', { organization: apolloOrg }, base, (o) =>
    o.industry === 'Email privacy SaaS' && o.employees === 120 &&
    o.country === 'US' && o.city === 'San Francisco' && o.enriched_by === 'apollo' &&
    Array.isArray(o.tech_stack) && o.tech_stack[0] === 'Python'],
  ['no org -> base unchanged', { ok: true }, base, (o) =>
    o.industry === 'AI' && o.employees === 30 && !o.enriched_by],
  ['no org, empty base', { ok: true }, {}, (o) => JSON.stringify(o) === '{}'],
  ['null input -> base', null, base, (o) => o.industry === 'AI' && !o.enriched_by],
  ['partial org fills gaps only', { organization: { country: 'DE' } }, base, (o) =>
    o.industry === 'AI' && o.employees === 30 && o.country === 'DE' && o.enriched_by === 'apollo'],
];

let pass = 0;
for (const [name, input, baseData, check] of cases) {
  const got = mergeEnrichment(input, baseData);
  const ok = check(got);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(got)}`);
  if (ok) pass++;
}

console.log(`\n${pass}/${cases.length} tests passed`);
process.exit(pass === cases.length ? 0 : 1);
