const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

function runSplit(input) {
  const source = readFileSync(
    path.join(__dirname, '..', '..', '..', 'core', 'pre-crm', 'n8n-code-nodes', 'n8n-revops-signal-split.js'),
    'utf8',
  )
  const fn = new Function('$input', `${source}\n`)
  return fn({
    first() {
      return { json: input }
    },
  })
}

const pending = {
  signal_key: 'account:demo:PQL_REACHED:v1',
  account_id: 'test-account-id',
  signal_type: 'PQL_REACHED',
  status: 'pending',
}

assert.deepEqual(runSplit([pending]), [{ json: { ...pending, actionable: true } }])
assert.deepEqual(runSplit(pending), [{ json: { ...pending, actionable: true } }])
assert.deepEqual(runSplit([{ ...pending, status: 'completed' }]), [{ json: { actionable: false, status: 'no_actionable_signals', signal_count: 0 } }])
assert.deepEqual(runSplit([{ ...pending, signal_type: 'HIGH_CHURN_RISK' }]), [{ json: { actionable: false, status: 'no_actionable_signals', signal_count: 0 } }])

console.log('revops signal split PASS')
