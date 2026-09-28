import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import test from 'node:test'
import vm from 'node:vm'

import {
  buildScoringPrompt,
  extractGeminiText,
  parseGeminiResponse,
} from '../core/revops/contracts/ai-qualification-score.js'
import { workflowRegistry } from '../registry/index.js'
import { loadWorkflow } from '../runtime/workflow-loader.js'

const execFileAsync = promisify(execFile)

async function snippetFunctions(path: string, names: readonly string[]) {
  const source = await readFile(path, 'utf8')
  const prefix = source.split('export default')[0]
  const sandbox: Record<string, unknown> = {}
  vm.createContext(sandbox)
  vm.runInContext(`${prefix}\n${names.map(name => `this.${name} = ${name};`).join('\n')}`, sandbox)
  return sandbox
}

test('AgentFlow prompt uses firmographic fit and never fabricates signup intent', () => {
  const prompt = buildScoringPrompt({
    company_name: 'Automation Systems',
    industry: 'software',
    employee_count: 420,
    technologies: ['n8n', 'HubSpot'],
  })
  assert.match(prompt, /AgentFlow/)
  assert.match(prompt, /buying_intent must be "unknown"/)
  assert.match(prompt, /Never invent technology usage/)
  assert.doesNotMatch(prompt, /CostPilot|CostPulse|tech stack maturity/i)
})

test('strong and weak firmographic score responses satisfy the new ICP contract', () => {
  const strong = parseGeminiResponse(JSON.stringify({
    icp_score: 91,
    fit: 'high',
    buying_intent: 'unknown',
    qualification_reason: 'B2B software company with 420 employees and explicit integration technologies.',
    company_summary: 'Automation Systems is a B2B software company.',
    personalized_icebreaker: 'Your integration footprint suggests meaningful workflow complexity. AgentFlow may help orchestrate those processes.',
  }))
  const weak = parseGeminiResponse(JSON.stringify({
    icp_score: 24,
    fit: 'low',
    buying_intent: 'unknown',
    qualification_reason: 'The available company evidence is limited and does not show operational automation needs.',
    company_summary: 'A small organization with limited available enrichment.',
    personalized_icebreaker: 'I noticed your organization is still early in its growth. AgentFlow can be revisited as integration needs develop.',
  }))
  assert.equal(strong.fit, 'high')
  assert.equal(weak.fit, 'low')
  assert.equal(strong.buying_intent, 'unknown')
  assert.equal(weak.buying_intent, 'unknown')
})

test('Apollo normalization allowlists real fields and does not invent missing company data', async () => {
  const functions = await snippetFunctions(
    'core/pre-crm/n8n-code-nodes/n8n-enrich-parse.js',
    ['normalizeFirmographics'],
  )
  const normalize = functions.normalizeFirmographics as (
    input: unknown,
    base: unknown,
    context: unknown,
  ) => Record<string, unknown>

  const personal = normalize({}, { monthly_spend: 50_000, tech_stack: ['invented'] }, {
    domain: 'gmail.com',
    email_classification: 'personal',
  })
  assert.deepEqual(Object.keys(personal).sort(), ['domain', 'email_classification'])
  assert.equal('company_name' in personal, false)
  assert.equal('employee_count' in personal, false)
  assert.equal('technologies' in personal, false)

  const apollo = normalize({ organization: {
    name: 'Automation Systems',
    primary_domain: 'automation.example',
    industry: 'software',
    estimated_num_employees: 420,
    state: 'California',
    country: 'United States',
    technology_names: ['n8n'],
    current_technologies: [{ name: 'HubSpot' }],
  } }, {}, { email_verification_status: 'deliverable' })
  assert.equal(apollo.employee_count, 420)
  assert.deepEqual([...(apollo.technologies as string[])], ['n8n', 'HubSpot'])
  assert.equal(apollo.enrichment_provider, 'apollo')
})

test('missing Apollo fields stay missing', async () => {
  const functions = await snippetFunctions(
    'core/pre-crm/n8n-code-nodes/n8n-enrich-parse.js',
    ['normalizeFirmographics'],
  )
  const normalize = functions.normalizeFirmographics as (input: unknown, base: unknown, context: unknown) => Record<string, unknown>
  const normalized = normalize({ organization: { name: 'Known Name' } }, {}, {})
  assert.equal('employee_count' in normalized, false)
  assert.equal('technologies' in normalized, false)
})

test('Gemini malformed JSON and empty candidates fail explicitly', () => {
  assert.throws(() => parseGeminiResponse('{bad json'))
  assert.throws(() => extractGeminiText({ candidates: [] }), /gemini_response_missing_candidates/)
  assert.throws(
    () => parseGeminiResponse(JSON.stringify({
      icp_score: 80,
      fit: 'high',
      buying_intent: 'high',
      qualification_reason: 'Invalid inferred intent.',
      company_summary: '',
      personalized_icebreaker: '',
    })),
    /gemini_response_unexpected_agentflow_icp_shape/,
  )
})

test('Apollo no-match produces an explicit low-confidence outcome', async () => {
  const functions = await snippetFunctions(
    'core/pre-crm/n8n-code-nodes/n8n-low-confidence-score.js',
    ['buildLowConfidenceQualification'],
  )
  const build = functions.buildLowConfidenceQualification as (context: Record<string, unknown>) => Record<string, unknown>
  const result = build({ lead_id: 42, enrichment_status: 'not_found' })
  assert.equal(result.scoring_status, 'skipped')
  assert.equal(result.enrichment_status, 'not_found')
  assert.equal(result.buying_intent, 'unknown')
  assert.equal(result.confidence, 'low')
})

test('signup qualification does not create a PQL; product signals remain in RevOps', async () => {
  const leadDefinition = workflowRegistry.get('pre-crm.lead-qualification')
  const revopsDefinition = workflowRegistry.get('revops.signal-orchestration')
  assert.ok(leadDefinition)
  assert.ok(revopsDefinition)
  const lead = JSON.stringify(await loadWorkflow(leadDefinition))
  const revops = JSON.stringify(await loadWorkflow(revopsDefinition))
  assert.doesNotMatch(lead, /PQL_REACHED/)
  assert.match(revops, /PQL_REACHED/)
})

test('all canonical builders and committed workflow JSON are in parity', async () => {
  for (const builder of [
    'builders/build_lead_qualification_workflow.py',
    'builders/build_reply_to_deal_workflow.py',
    'builders/build_revops_signal_workflow.py',
  ]) {
    await execFileAsync('python3', [builder, '--check'])
  }
})
