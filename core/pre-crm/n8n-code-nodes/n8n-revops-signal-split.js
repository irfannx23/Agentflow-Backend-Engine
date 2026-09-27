/**
 * Split generated RevOps signals.
 * Handles PostgREST's normal array response and emits one item per pending signal.
 * If nothing is actionable, emit one explicit no-op item so manual/scheduled runs
 * finish clearly instead of looking like a broken empty branch.
 */

const rawItems = typeof $input.all === 'function'
  ? $input.all().map((item) => item.json)
  : [$input.first()?.json];
const payload = rawItems.flatMap((raw) => Array.isArray(raw) ? raw : [raw]);
const currentProductSignalTypes = new Set([
  'PQL_REACHED',
  'UPGRADE_INTENT',
  'SIGNIFICANT_USAGE_GROWTH',
  'SUBSCRIPTION_ACTIVATED',
  'ALLOWANCE_PRESSURE',
  'BUDGET_PRESSURE',
]);
const signals = payload.filter((row) =>
  row &&
  row.signal_key &&
  row.status === 'pending' &&
  row.account_id &&
  currentProductSignalTypes.has(row.signal_type)
);

if (!signals.length) {
  return [{ json: { actionable: false, status: 'no_actionable_signals', signal_count: 0 } }];
}

return signals.map((signal) => ({ json: { ...signal, actionable: true } }));
