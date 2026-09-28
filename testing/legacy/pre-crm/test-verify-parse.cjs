#!/usr/bin/env node
/**
 * Unit tests for the Stage 2 verification normalizer (parseVerifyResponse).
 * Extracts the REAL function from Automation/n8n/Code_Nodes/n8n-verify-parse.js and
 * runs it against the canonical Emailable response contract.
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
  ['emailable deliverable', { state: 'deliverable', reason: 'accepted_email' }, true, 'deliverable'],
  ['emailable wrapped deliverable', { data: { state: 'deliverable' } }, true, 'deliverable'],
  ['emailable undeliverable', { state: 'undeliverable', reason: 'invalid_domain' }, false, 'undeliverable'],
  ['emailable risky', { state: 'risky' }, false, 'risky'],
  ['emailable unknown', { state: 'unknown' }, false, 'unknown'],
];

let pass = 0;
for (const [name, resp, expDel, expVerdict] of cases) {
  const got = parseVerifyResponse(resp);
  const ok = got.deliverable === expDel && got.verdict === expVerdict;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: deliverable=${got.deliverable} verdict=${got.verdict}${ok ? '' : ` (expected ${expDel}/${expVerdict})`}`);
  if (ok) pass++;
}

for (const [name, response, message] of [
  ['empty response', {}, 'emailable_response_missing_state'],
  ['null response', null, 'emailable_response_missing_state'],
  ['invalid state', { state: 'valid' }, 'emailable_response_invalid_state:valid'],
]) {
  let error = null;
  try { parseVerifyResponse(response); } catch (caught) { error = caught; }
  const ok = error && error.message === message;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${error?.message || 'no_error'}`);
  if (ok) pass++;
}

const total = cases.length + 3;
console.log(`\n${pass}/${total} tests passed`);
process.exit(pass === total ? 0 : 1);
