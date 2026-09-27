// Throwaway test harness for Automation/n8n/Code_Nodes/n8n-ingestion-sanitize.js
// Mocks n8n's $input global and runs the sanitizeLead() function against
// the VALID and REJECTED payloads from Automation/Webhooks/simulate_webhook.cjs.
const fs = require('fs');
const path = require('path');

// Load the snippet (it exports default function sanitizeLead using $input)
const snippetPath = path.join(__dirname, '..', '..', '..', 'core', 'pre-crm', 'n8n-code-nodes', 'n8n-ingestion-sanitize.js');
let snippetSrc = fs.readFileSync(snippetPath, 'utf8');
// Convert ESM export to CJS for the harness
snippetSrc = snippetSrc.replace('export default function sanitizeLead()', 'function sanitizeLead()');
snippetSrc += '\nmodule.exports = { sanitizeLead };';
const mod = { exports: {} };
const fn = new Function('module', 'exports', 'require', snippetSrc);
fn(mod, mod.exports, require);
const sanitizeLead = mod.exports.sanitizeLead;

// Mock $input like n8n does
function runSanitize(lead) {
  global.$input = { first: () => ({ json: lead }) };
  return sanitizeLead();
}

// Test payloads (mirror Automation/Webhooks/simulate_webhook.cjs)
const VALID_LEAD = {
  event_id: 'evt_test_valid_001',
  email: '  Alex@ai-labs.io  ',
  company_name: '  AI   Labs  ',
  raw_payload: { source: 'test-simulator', form: 'website', message: 'Interested in RevOps automation' },
  firmographics: { industry: 'SaaS', employees: 50 },
  icp_score: null,
  personalized_icebreaker: null,
};

const REJECTED_LEAD = {
  event_id: 'evt_test_rejected_001',
  email: 'junk@tempmail.com',
  company_name: 'Spam\u0000Corp\u0007',
  raw_payload: { source: 'test-simulator', form: 'spam-bot', message: 'Buy\u0000now!!!\u0007' },
  firmographics: {},
  icp_score: null,
  personalized_icebreaker: null,
};

const EXTRA_CASES = [
  { name: 'personal gmail domain', lead: { ...VALID_LEAD, event_id: 'evt_personal_001', email: 'john@gmail.com' } },
  { name: 'malformed email (no @)', lead: { ...VALID_LEAD, event_id: 'evt_malformed_001', email: 'not-an-email' } },
  { name: 'missing email', lead: { ...VALID_LEAD, event_id: 'evt_missing_001', email: undefined } },
  { name: 'nested malformed text', lead: { ...VALID_LEAD, event_id: 'evt_nested_001', raw_payload: { ...VALID_LEAD.raw_payload, nested: { msg: 'ok\u0000bad' } } } },
  { name: 'student .edu domain', lead: { ...VALID_LEAD, event_id: 'evt_student_001', email: 'student@harvard.edu' } },
  { name: 'competitor domain', lead: { ...VALID_LEAD, event_id: 'evt_competitor_001', email: 'sales@hubspot.com' } },
  { name: 'blocked jurisdiction code RU', lead: { ...VALID_LEAD, event_id: 'evt_jur_code_001', country_code: 'RU' } },
  { name: 'blocked jurisdiction name Russia', lead: { ...VALID_LEAD, event_id: 'evt_jur_name_001', country: 'Russia' } },
  { name: 'blocked jurisdiction name Russian Federation', lead: { ...VALID_LEAD, event_id: 'evt_jur_name_002', country: 'Russian Federation' } },
  { name: 'allowed jurisdiction code US', lead: { ...VALID_LEAD, event_id: 'evt_jur_code_002', country_code: 'US' } },
  { name: 'allowed jurisdiction name United States', lead: { ...VALID_LEAD, event_id: 'evt_jur_name_003', country: 'United States' } },
];

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | got: ${JSON.stringify(got)}${ok ? '' : ' | expected: ' + JSON.stringify(expected)}`);
}

console.log('=== VALID lead ===');
const r1 = runSanitize(VALID_LEAD).json;
console.log(JSON.stringify(r1, null, 2));
check('valid -> sanitized:true', r1.sanitized, true);
check('valid -> email normalized', r1.email, 'alex@ai-labs.io');
check('valid -> email_domain', r1.email_domain, 'ai-labs.io');
check('valid -> company_name stripped', r1.company_name, 'AI Labs');

console.log('\n=== REJECTED lead ===');
const r2 = runSanitize(REJECTED_LEAD).json;
console.log(JSON.stringify(r2, null, 2));
check('rejected -> sanitized:false', r2.sanitized, false);
check('rejected -> reason', r2.reason, 'temporary_email_provider');

console.log('\n=== extra cases ===');
check('gmail -> personal_domain', runSanitize(EXTRA_CASES[0].lead).json.reason, 'personal_domain');
check('malformed -> email_invalid_format', runSanitize(EXTRA_CASES[1].lead).json.reason, 'email_invalid_format');
check('missing -> email_missing', runSanitize(EXTRA_CASES[2].lead).json.reason, 'email_missing');
const nested = runSanitize(EXTRA_CASES[3].lead).json;
check('nested control chars stripped', nested.raw_payload.nested.msg, 'ok bad');
check('student .edu -> student_domain', runSanitize(EXTRA_CASES[4].lead).json.reason, 'student_domain');
check('competitor -> competitor_domain', runSanitize(EXTRA_CASES[5].lead).json.reason, 'competitor_domain');
check('jurisdiction code RU -> blocked_jurisdiction', runSanitize(EXTRA_CASES[6].lead).json.reason, 'blocked_jurisdiction');
check('jurisdiction name Russia -> blocked_jurisdiction', runSanitize(EXTRA_CASES[7].lead).json.reason, 'blocked_jurisdiction');
check('jurisdiction name Russian Federation -> blocked_jurisdiction', runSanitize(EXTRA_CASES[8].lead).json.reason, 'blocked_jurisdiction');
check('jurisdiction code US -> sanitized:true', runSanitize(EXTRA_CASES[9].lead).json.sanitized, true);
check('jurisdiction name United States -> sanitized:true', runSanitize(EXTRA_CASES[10].lead).json.sanitized, true);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
