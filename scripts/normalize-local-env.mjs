import { readFile, writeFile } from 'node:fs/promises'
import console from 'node:console'
import { URL } from 'node:url'

const path = new URL('../.env', import.meta.url)
const source = await readFile(path, 'utf8')
const lines = source.split(/\r?\n/)
const lastIndex = new Map()

for (const [index, line] of lines.entries()) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
  if (match) lastIndex.set(match[1], index)
}

const canonical = new Map([
  ['N8N_LEAD_QUALIFICATION_DISPATCH_URL', 'http://127.0.0.1:5678/webhook/agentflow-lead-qualification'],
  ['EMAIL_VERIFY_BASE_URL', 'https://api.emailable.com'],
  ['GEMINI_ENDPOINT', 'https://generativelanguage.googleapis.com/v1beta/models'],
  ['GEMINI_MODEL', 'gemini-3.8-flash'],
  ['BREVO_BASE_URL', 'https://api.brevo.com'],
  ['DEEPSEEK_MODEL', 'deepseek/deepseek-flash'],
])

const output = []
const seen = new Set()
for (const [index, line] of lines.entries()) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line)
  if (!match) {
    output.push(line)
    continue
  }
  const key = match[1]
  if (lastIndex.get(key) !== index) continue
  const value = canonical.get(key) ?? match[2].trim()
  output.push(`${key}=${value}`)
  seen.add(key)
}

for (const [key, value] of canonical) {
  if (!seen.has(key)) output.push(`${key}=${value}`)
}

await writeFile(path, `${output.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 })
console.log('Normalized local environment keys without displaying values.')
