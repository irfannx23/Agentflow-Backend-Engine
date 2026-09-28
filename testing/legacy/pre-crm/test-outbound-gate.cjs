// Throwaway test harness for Automation/n8n/Code_Nodes/n8n-outbound-gate.js
const fs = require('fs');
const path = require('path');

const snippetPath = path.join(__dirname, '..', '..', '..', 'core', 'pre-crm', 'n8n-code-nodes', 'n8n-outbound-gate.js');
let src = fs.readFileSync(snippetPath, 'utf8');
src = src.replace('export default function outboundGate()', 'function outboundGate()');
src += '\nmodule.exports = { outboundGate };';
const mod = { exports: {} };
new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
const outboundGate = mod.exports.outboundGate;

function run(mxResponse, scoreJson) {
  global.$json = mxResponse;
  global.$ = (nodeName) => {
    if (nodeName === 'Normalize Score Context') return { first: () => ({ json: scoreJson }) };
    return { first: () => ({ json: {} }) };
  };
  return outboundGate()[0];
}

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ` | got: ${JSON.stringify(got)} expected: ${JSON.stringify(expected)}`}`);
}

// MX ok + high score -> pass
let r = run({ hasMx: true, domain: 'example.com' }, { icp_score: 82, buying_intent: 'unknown' });
check('mx-ok + 82 -> pass', r.outbound_gate, 'pass');
check('pass reason null', r.outbound_reason, null);

// MX ok + low score -> fail low_score
r = run({ hasMx: true, domain: 'example.com' }, { icp_score: 55 });
check('mx-ok + 55 -> fail', r.outbound_gate, 'fail');
check('low score reason', r.outbound_reason, 'low_score');

// No MX + high score -> fail no_mx
r = run({ hasMx: false, domain: 'acme.invalid', error: 'ENOTFOUND' }, { icp_score: 90 });
check('no-mx + 90 -> fail', r.outbound_gate, 'fail');
check('no-mx reason', r.outbound_reason, 'no_mx');
check('no-mx error surfaced', r.mx_error, 'ENOTFOUND');

// Boundary: exactly 70 -> pass
r = run({ hasMx: true }, { icp_score: 70 });
check('mx-ok + exactly 70 -> pass', r.outbound_gate, 'pass');

// No mx response (undefined) -> fail no_mx (conservative)
r = run(undefined, { icp_score: 99 });
check('missing mx response -> fail no_mx', r.outbound_reason, 'no_mx');

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
