import { mkdir, readFile, writeFile } from 'node:fs/promises'
import console from 'node:console'
import process from 'node:process'
import { URL } from 'node:url'

const root = new URL('../', import.meta.url)
const outputRoot = '/private/tmp/agentflow-n8n-remediation-import'
await mkdir(outputRoot, { recursive: true })

const workflows = [
  {
    source: 'workflows/pre-crm/lead-qualification.workflow.json',
    output: 'lead-qualification.json',
    id: process.env.N8N_LEAD_QUALIFICATION_WORKFLOW_ID || 'idce7uRAdybKu3PI',
    name: 'Lead Qualification',
  },
  {
    source: 'workflows/pre-crm/reply-to-deal.workflow.json',
    output: 'reply-to-deal.json',
    id: process.env.N8N_REPLY_TO_DEAL_WORKFLOW_ID || 'YKd8JZItw9IupV2z',
    name: 'Reply-to-Deal',
  },
  {
    source: 'workflows/revops/signal-orchestration.workflow.json',
    output: 'revops-signal-orchestration.json',
    id: process.env.N8N_REVOPS_WORKFLOW_ID || 'GFnlHS90i304UAAq',
    name: 'RevOps Signal Orchestration',
  },
]

for (const definition of workflows) {
  const workflow = JSON.parse(await readFile(new URL(definition.source, root), 'utf8'))
  workflow.id = definition.id
  workflow.name = definition.name
  workflow.active = false
  delete workflow.versionId
  await writeFile(`${outputRoot}/${definition.output}`, `${JSON.stringify(workflow, null, 2)}\n`)
}

console.log(`Prepared ${workflows.length} inactive workflow imports without credentials or secret values.`)
