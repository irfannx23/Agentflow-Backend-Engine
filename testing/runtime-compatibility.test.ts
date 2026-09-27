import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { ENGINE_ROOT } from '../runtime/paths.js'
import { readSupabaseRuntimeConfig } from '../runtime/supabase-config.js'

test('builder is syntax-valid and references only backend-engine paths', async () => {
  const builder = resolve(ENGINE_ROOT, 'builders/build_lead_qualification_workflow.py')
  const source = await readFile(builder, 'utf8')
  assert.match(source, /AGENTFLOW_BACKEND_ENGINE_ROOT/)
  assert.match(source, /core\/pre-crm\/n8n-code-nodes/)
  assert.equal(source.includes(['Automation', 'Engine'].join(' ')), false)
  assert.doesNotMatch(source, /COSTPILOT_BASE|\/Users\/mac/)

  const result = spawnSync('python3', ['-c', 'import pathlib; p=pathlib.Path(__import__("sys").argv[1]); compile(p.read_text(), str(p), "exec")', builder])
  assert.equal(result.status, 0, result.stderr.toString())
})

test('Supabase configuration reuses environment values without side effects', () => {
  const config = readSupabaseRuntimeConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'placeholder-for-test',
  })
  assert.equal(config.url, 'https://example.supabase.co')
  assert.equal(config.serviceRoleKey, 'placeholder-for-test')
  assert.throws(() => readSupabaseRuntimeConfig({}), /missing_supabase_environment/)
})
