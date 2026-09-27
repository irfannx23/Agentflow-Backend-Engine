// Throwaway test harness for Automation/n8n/Code_Nodes/n8n-nurture-parse.js
const fs = require('fs');
const path = require('path');

const snippetPath = path.join(__dirname, '..', '..', '..', 'core', 'pre-crm', 'n8n-code-nodes', 'n8n-nurture-parse.js');
let src = fs.readFileSync(snippetPath, 'utf8');
src = src.replace('export default function parseNurtureEmail()', 'function parseNurtureEmail()');
src += '\nmodule.exports = { parseNurtureEmail };';
const mod = { exports: {} };
new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
const parseNurtureEmail = mod.exports.parseNurtureEmail;

function run(geminiJson, built = { lead_id: 99, email: 'founder@nebulaops.io' }) {
  global.$ = (nodeName) => {
    const map = { 'Call Gemini (Nurture Email)': geminiJson, 'Build Nurture Email': built };
    return { first: () => ({ json: map[nodeName] }) };
  };
  return parseNurtureEmail()[0];
}

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ` | got: ${JSON.stringify(got)} expected: ${JSON.stringify(expected)}`}`);
}

const good = {
  candidates: [{ content: { parts: [{ text: '{"subject":"Thoughts on data pipelines","body":"Hi there,\\nQuick thought for your team."}' }] } }],
};
const r1 = run(good);
check('subject extracted', r1.subject, 'Thoughts on data pipelines');
check('body extracted', r1.body, 'Hi there,\nQuick thought for your team.');
check('to_email passthrough', r1.to_email, 'founder@nebulaops.io');
check('lead_id passthrough', r1.lead_id, 99);

// Fenced markdown response (Gemini sometimes wraps in ```json)
const fenced = {
  candidates: [{ content: { parts: [{ text: '```json\n{"subject":"S1","body":"B1"}\n```' }] } }],
};
const r2 = run(fenced);
check('fenced subject', r2.subject, 'S1');
check('fenced body', r2.body, 'B1');

// Stray commentary around the JSON
const noisy = {
  candidates: [{ content: { parts: [{ text: 'Here you go:\n{"subject":"S2","body":"B2"}\nHope that helps!' }] } }],
};
const r3 = run(noisy);
check('noisy subject', r3.subject, 'S2');
check('noisy body', r3.body, 'B2');

// Empty/garbage response -> fallback template, no crash
const r4 = run({ candidates: [{ content: { parts: [{ text: 'oops' }] } }] });
check('garbage -> fallback subject', r4.subject, 'A quick thought for your team');
check('garbage -> fallback body non-empty', r4.body.length > 20, true);
check('garbage -> to_email kept', r4.to_email, 'founder@nebulaops.io');

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
