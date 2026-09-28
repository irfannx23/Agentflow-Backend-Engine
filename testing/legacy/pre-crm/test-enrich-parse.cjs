const fs = require('fs');
const path = require('path');
const vm = require('vm');

const snippetPath = path.join(__dirname, '..', '..', '..', 'core', 'pre-crm', 'n8n-code-nodes', 'n8n-enrich-parse.js');
const source = fs.readFileSync(snippetPath, 'utf8');
const head = source.split('export default')[0];
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${head}\nthis.normalizeFirmographics = normalizeFirmographics;`, sandbox);
const normalize = sandbox.normalizeFirmographics;

const apollo = normalize({ organization: {
  name: 'AgentFlow Systems',
  primary_domain: 'agentflow.example',
  industry: 'software',
  estimated_num_employees: 120,
  country: 'US',
  state: 'California',
  city: 'San Francisco',
  short_description: 'Workflow automation software.',
  total_funding: 5000000,
  technology_names: ['n8n'],
  current_technologies: [{ name: 'HubSpot' }],
} }, { monthly_spend: 10000, tech_stack: ['invented'] }, {
  email_verification_status: 'deliverable',
  email_classification: 'business',
  acquisition_source: 'agentflow_signup',
});

const noMatch = normalize({}, { monthly_spend: 10000, tech_stack: ['invented'] }, {
  domain: 'gmail.com',
  email_classification: 'personal',
});

const checks = [
  ['Apollo company name', apollo.company_name === 'AgentFlow Systems'],
  ['Apollo employee count', apollo.employee_count === 120],
  ['Apollo technologies explicit only', JSON.stringify(apollo.technologies) === JSON.stringify(['n8n', 'HubSpot'])],
  ['raw monthly spend excluded', !('monthly_spend' in apollo)],
  ['raw tech stack excluded', !('tech_stack' in apollo)],
  ['personal no-match has no company', !('company_name' in noMatch)],
  ['missing employee count stays missing', !('employee_count' in noMatch)],
  ['missing technologies stay missing', !('technologies' in noMatch)],
];

let pass = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) pass += 1;
}
console.log(`\n${pass}/${checks.length} tests passed`);
process.exit(pass === checks.length ? 0 : 1);
