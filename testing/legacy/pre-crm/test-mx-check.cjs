// Throwaway test harness for Automation/Local_Services/MX_Service/mx-check.ts (compiled to dist).
const path = require('path');
const { checkMx, clearMxCache, setMxResolver } = require(path.join(__dirname, '..', '..', '..', 'dist', 'integrations', 'mx-service', 'mx-check.js'));

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ` | got: ${JSON.stringify(got)} expected: ${JSON.stringify(expected)}`}`);
}

(async () => {
  clearMxCache();
  setMxResolver(async (domain) => {
    if (domain === 'example.com') {
      return [{ exchange: 'mx.example.com', priority: 10 }];
    }
    const error = new Error('ENOTFOUND');
    error.code = 'ENOTFOUND';
    throw error;
  });

  // Real DNS, tiny: example.com has a valid MX record.
  const ok = await checkMx('example.com');
  check('example.com hasMx true', ok.hasMx, true);
  check('example.com records non-empty', Array.isArray(ok.records) && ok.records.length > 0, true);
  check('example.com no error', ok.error, null);

  // A non-existent TLD domain has no MX -> treated as not deliverable.
  const bad = await checkMx('definitely-not-a-real-tld-xyz.invalid');
  check('.invalid hasMx false', bad.hasMx, false);

  // Cache hit returns fast and marks cached:true.
  const t0 = Date.now();
  const cached = await checkMx('example.com');
  const ms = Date.now() - t0;
  check('cached flag', cached.cached, true);
  check('cache hit < 5ms', ms < 5, true);

  // www prefix is normalized away -> same cache entry.
  const www = await checkMx('www.example.com');
  check('www normalized to example.com', www.domain, 'example.com');
  check('www cache hit', www.cached, true);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
