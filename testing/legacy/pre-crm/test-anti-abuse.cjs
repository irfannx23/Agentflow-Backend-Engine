// Throwaway test harness for the M0.5 anti-abuse shield snippets.
// Covers Automation/n8n/Code_Nodes/n8n-anti-abuse.js (evaluateAntiAbuse) and
// Automation/n8n/Code_Nodes/n8n-turnstile-parse.js (evaluateTurnstile).
const fs = require('fs');
const path = require('path');

function load(name, exportsObj) {
  const p = path.join(__dirname, '..', '..', '..', 'core', 'pre-crm', 'n8n-code-nodes', name);
  let src = fs.readFileSync(p, 'utf8');
  src = src.replace(/export default function (\w+)/, 'function $1');
  src += `\nmodule.exports = { ${Object.keys(exportsObj).join(', ')} };`;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
  return mod.exports;
}

const { evaluateAntiAbuse } = load('n8n-anti-abuse.js', { evaluateAntiAbuse: 1 });
const { evaluateTurnstile } = load('n8n-turnstile-parse.js', { evaluateTurnstile: 1 });

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ` | got: ${JSON.stringify(got)} expected: ${JSON.stringify(expected)}`}`);
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---------- evaluateAntiAbuse ----------
let r = evaluateAntiAbuse({ hp: 'im-a-bot' }, { ipFloodCount: 0, dailyCount: 0 });
check('honeypot -> drop', r.action, 'drop');
check('honeypot -> reason', r.reason, 'honeypot');

r = evaluateAntiAbuse({ submitted_at: new Date(Date.now() - 200).toISOString() }, {});
check('sub-1s -> drop too_fast', r.reason, 'too_fast');

r = evaluateAntiAbuse({ submitted_at: new Date(Date.now() + 60000).toISOString() }, {});
check('future submitted_at -> drop too_fast', r.reason, 'too_fast');

r = evaluateAntiAbuse({ submitted_at: new Date(Date.now() - 5000).toISOString() }, { ipFloodCount: 0, dailyCount: 0 });
check('normal human -> pass', r.action, 'pass');

r = evaluateAntiAbuse({}, { ipFloodCount: 31, dailyCount: 5 });
check('31/10min same IP -> drop ip_flood', r.reason, 'ip_flood');

r = evaluateAntiAbuse({}, { ipFloodCount: 3, dailyCount: 501 });
check('501/day -> drop daily_cap', r.reason, 'daily_cap');

r = evaluateAntiAbuse({ email: 'lead@example.com' }, undefined);
check('outbound-like (no hp/submitted_at, no counts) -> pass', r.action, 'pass');

r = evaluateAntiAbuse({ email: 'a@b.co' }, { ipFloodCount: 29, dailyCount: 499 });
check('edge below thresholds -> pass', r.action, 'pass');

// ---------- evaluateTurnstile ----------
r = evaluateTurnstile({ success: true });
check('siteverify success:true -> ok', r.turnstile_ok, true);
check('siteverify success:true -> pass', r.abuse_gate, 'pass');

r = evaluateTurnstile({ success: false, 'error-codes': ['invalid-input-response'] });
check('siteverify success:false -> not ok', r.turnstile_ok, false);
check('siteverify success:false -> drop turnstile_failed', r.abuse_reason, 'turnstile_failed');

r = evaluateTurnstile({});
check('empty response -> drop', r.abuse_reason, 'turnstile_failed');

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
