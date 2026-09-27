#!/usr/bin/env node
/**
 * Unit tests for the Stage 2 verification normalizer (parseVerifyResponse).
 * Extracts the REAL function from Automation/n8n/Code_Nodes/n8n-verify-parse.js and
 * runs it against simulated Hunter / ZeroBounce responses.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const snippetPath = path.join(__dirname, '..', '..', '..', 'core', 'pre-crm', 'n8n-code-nodes', 'n8n-verify-parse.js');
const source = fs.readFileSync(snippetPath, 'utf8');

// Extract the function declaration (everything between 'function parseVerifyResponse'
// and the last '}' before the 'export default' marker).
const head = source.split('export default')[0];
const start = head.indexOf('function parseVerifyResponse');
if (start === -1) {
  console.error('FAIL: parseVerifyResponse not found in snippet');
  process.exit(1);
}
const fnCode = head.slice(start).replace(/\}\s*$/, '}');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fnCode + '\nthis.parseVerifyResponse = parseVerifyResponse;', sandbox);
const parseVerifyResponse = sandbox.parseVerifyResponse;

const cases = [
  // [name, provider response, expected deliverable, expected verdict]
  ['hunter deliverable',  { data: { status: 'valid', result: 'deliverable' } }, true, 'deliverable'],
  ['hunter undeliverable',{ data: { status: 'invalid', result: 'undeliverable' } }, false, 'undeliverable'],
  ['hunter risky',        { data: { status: 'risky', result: 'risky' } }, false, 'risky'],
  ['zerobounce valid',    { status: 'valid' }, true, 'deliverable'],
  ['zerobounce invalid',  { status: 'invalid', sub_status: 'mailbox_not_found' }, false, 'invalid'],
  ['zerobounce catch-all',{ status: 'catch-all' }, false, 'catch-all'],
  ['abstract deliverable',{ deliverability: 'DELIVERABLE', is_disposable_email: false, is_mx_found: true, is_smtp_valid: true }, true, 'deliverable'],
  ['abstract undeliverable', { deliverability: 'UNDELIVERABLE', is_mx_found: false }, false, 'undeliverable'],
  ['abstract risky',      { deliverability: 'RISKY' }, false, 'risky'],
  ['abstract disposable', { deliverability: 'DELIVERABLE', is_disposable_email: true }, false, 'deliverable'],
  ['mailboxlayer valid',  { format_valid: true, mx_found: true, smtp_check: true, catch_all: false, disposable: false }, true, 'deliverable'],
  ['mailboxlayer catch-all', { format_valid: true, mx_found: true, smtp_check: false, catch_all: true, disposable: false }, false, 'unknown'],
  ['mailboxlayer no-smtp', { format_valid: true, mx_found: false, smtp_check: false, catch_all: false, disposable: false }, false, 'unknown'],
  ['emailable deliverable', { state: 'deliverable', reason: 'accepted_email' }, true, 'deliverable'],
  ['emailable undeliverable', { state: 'undeliverable', reason: 'invalid_domain' }, false, 'undeliverable'],
  ['emailable risky', { state: 'risky' }, false, 'risky'],
  ['emailable unknown', { state: 'unknown' }, false, 'unknown'],
  ['empty response',      {}, false, 'unknown'],
  ['null response',       null, false, 'unknown'],
];

let pass = 0;
for (const [name, resp, expDel, expVerdict] of cases) {
  const got = parseVerifyResponse(resp);
  const ok = got.deliverable === expDel && got.verdict === expVerdict;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: deliverable=${got.deliverable} verdict=${got.verdict}${ok ? '' : ` (expected ${expDel}/${expVerdict})`}`);
  if (ok) pass++;
}

console.log(`\n${pass}/${cases.length} tests passed`);
process.exit(pass === cases.length ? 0 : 1);
