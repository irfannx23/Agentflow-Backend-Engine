// Throwaway test harness for Automation/n8n/Code_Nodes/n8n-jurisdiction-check.js
// Mocks n8n's $('NodeName') accessor and runs the jurisdictionCheck()
// function against enriched firmographics payloads.
const fs = require('fs');
const path = require('path');

const snippetPath = path.join(__dirname, '..', '..', '..', 'core', 'pre-crm', 'n8n-code-nodes', 'n8n-jurisdiction-check.js');
let snippetSrc = fs.readFileSync(snippetPath, 'utf8');
snippetSrc = snippetSrc.replace('export default function jurisdictionCheck()', 'function jurisdictionCheck()');
snippetSrc += '\nmodule.exports = { jurisdictionCheck };';
const mod = { exports: {} };
const fn = new Function('module', 'exports', 'require', snippetSrc);
fn(mod, mod.exports, require);
const jurisdictionCheck = mod.exports.jurisdictionCheck;

// Mock n8n's $('Node') lookup — returns { lead_id } from the dedup node and
// { lead_id, firmographics } from Parse Enrichment.
function runCheck(firmographics, leadId = 75) {
  global.$ = (nodeName) => {
    if (nodeName === 'Parse Enrichment') return { first: () => ({ json: { lead_id: leadId, firmographics } }) };
    if (nodeName === 'Dedup: Get or Create Lead') return { first: () => ({ json: { lead_id: leadId } }) };
    throw new Error('unexpected node: ' + nodeName);
  };
  return jurisdictionCheck()[0];
}

const CASES = [
  { name: 'country name Russia', firmographics: { country: 'Russia' }, blocked: true, code: 'RU' },
  { name: 'country name Russian Federation', firmographics: { country: 'Russian Federation' }, blocked: true, code: 'RU' },
  { name: 'country_code IR', firmographics: { country_code: 'IR' }, blocked: true, code: 'IR' },
  { name: 'country_code lowercase sy', firmographics: { country_code: 'sy' }, blocked: true, code: 'SY' },
  { name: 'country name Venezuela', firmographics: { country: 'Venezuela' }, blocked: true, code: 'VE' },
  { name: 'country name Myanmar (Burma)', firmographics: { country: 'Myanmar (Burma)' }, blocked: true, code: 'MM' },
  { name: 'country name United States (allowed)', firmographics: { country: 'United States' }, blocked: false, code: null },
  { name: 'country_code US (allowed)', firmographics: { country_code: 'US' }, blocked: false, code: 'US' },
  { name: 'empty firmographics', firmographics: {}, blocked: false, code: null },
  { name: 'missing firmographics', firmographics: undefined, blocked: false, code: null },
];

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | got: ${JSON.stringify(got)}${ok ? '' : ' | expected: ' + JSON.stringify(expected)}`);
}

for (const c of CASES) {
  const r = runCheck(c.firmographics);
  check(`${c.name} -> blocked:${c.blocked}`, r.jurisdiction_blocked, c.blocked);
  check(`${c.name} -> code`, r.country_code, c.code);
  check(`${c.name} -> lead_id passthrough`, r.lead_id, 75);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
