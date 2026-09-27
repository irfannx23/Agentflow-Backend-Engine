// Throwaway test harness for Automation/n8n/Code_Nodes/n8n-nurture-prompt.js
const fs = require('fs');
const path = require('path');

const snippetPath = path.join(__dirname, '..', '..', '..', 'core', 'pre-crm', 'n8n-code-nodes', 'n8n-nurture-prompt.js');
let src = fs.readFileSync(snippetPath, 'utf8');
src = src.replace('export default function buildNurtureEmailPrompt()', 'function buildNurtureEmailPrompt()');
src += '\nmodule.exports = { buildNurtureEmailPrompt };';
const mod = { exports: {} };
new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
const buildNurtureEmailPrompt = mod.exports.buildNurtureEmailPrompt;

function run(lead, score, leadId = 99) {
  global.$ = (nodeName) => {
    const map = {
      'Sanitize Lead': lead,
      'Parse Gemini Score': score,
      'Dedup: Get or Create Lead': { lead_id: leadId },
    };
    return { first: () => ({ json: map[nodeName] }) };
  };
  return buildNurtureEmailPrompt()[0];
}

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ` | got: ${JSON.stringify(got)} expected: ${JSON.stringify(expected)}`}`);
}

const lead = { email: 'founder@nebulaops.io', company_name: 'Nebula Ops', firmographics: { industry: 'SaaS', employees: 8 } };
const score = { icp_score: 40, buying_intent: 'low', personalized_icebreaker: 'Curious how Nebula Ops handles data pipelines.' };

const out = run(lead, score);
check('lead_id passthrough', out.lead_id, 99);
check('email passthrough', out.email, 'founder@nebulaops.io');
check('company_name passthrough', out.company_name, 'Nebula Ops');
check('prompt is a string', typeof out.prompt, 'string');
check('prompt mentions company', out.prompt.includes('Nebula Ops'), true);
check('prompt mentions email', out.prompt.includes('founder@nebulaops.io'), true);
check('prompt mentions icp_score', out.prompt.includes('40'), true);
check('prompt asks for strict JSON', out.prompt.toLowerCase().includes('strict json'), true);
check('prompt asks for subject', out.prompt.includes('subject'), true);
check('prompt asks for body', out.prompt.includes('body'), true);

// Edge: missing firmographics should not crash
const out2 = run({ ...lead, firmographics: undefined }, score);
check('no firmographics still builds', typeof out2.prompt, 'string');

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
