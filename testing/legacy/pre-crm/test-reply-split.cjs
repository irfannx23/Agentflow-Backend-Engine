// Throwaway test harness for Automation/n8n/Code_Nodes/n8n-reply-split.js
const fs = require('fs');
const path = require('path');

const snippetPath = path.join(__dirname, '..', '..', '..', 'core', 'pre-crm', 'n8n-code-nodes', 'n8n-reply-split.js');
let src = fs.readFileSync(snippetPath, 'utf8');
src = src.replace('export default function splitRepliedRows()', 'function splitRepliedRows()');
src += '\nmodule.exports = { splitRepliedRows };';
const mod = { exports: {} };
new Function('module', 'exports', 'require', src)(mod, mod.exports, require);
const splitRepliedRows = mod.exports.splitRepliedRows;

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ` | got: ${JSON.stringify(got)} expected: ${JSON.stringify(expected)}`}`);
}

// One replied row -> one item, fields preserved
global.$json = { ok: true, rows: [{ id: 4, email: 'a@example.com', company_name: 'Acme', icp_score: 88 }] };
let out = splitRepliedRows();
check('one row -> one item', out.length, 1);
check('email preserved', out[0].json.email, 'a@example.com');
check('company preserved', out[0].json.company_name, 'Acme');
check('id preserved', out[0].json.id, 4);

// Two rows -> two items in order
global.$json = { ok: true, rows: [{ id: 1 }, { id: 2 }] };
out = splitRepliedRows();
check('two rows -> two items', out.length, 2);
check('order preserved', out[1].json.id, 2);

// Empty rows -> [] (branch ends silently — no deal attempted)
global.$json = { ok: true, rows: [] };
out = splitRepliedRows();
check('empty rows -> no items', out.length, 0);

// RPC returned no rows key at all -> []
global.$json = { ok: true };
out = splitRepliedRows();
check('missing rows key -> no items', out.length, 0);

// Undefined $json (never happens on the cron path, but be safe) -> []
global.$json = undefined;
out = splitRepliedRows();
check('undefined input -> no items', out.length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
