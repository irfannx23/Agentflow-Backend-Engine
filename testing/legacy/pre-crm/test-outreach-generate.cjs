// Throwaway test harness for Acquisition/Signal_Outbound/Outreach/ai-outreach-generate.ts (compiled to dist).
const path = require('path');
const { buildOutreachPrompt, parseOutreach, extractJson } = require(
  path.join(__dirname, '..', '..', '..', 'dist', 'core', 'gtm', 'acquisition', 'signal-outbound', 'outreach', 'ai-outreach-generate.js'),
);

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ` | got: ${JSON.stringify(got)} expected: ${JSON.stringify(expected)}`}`);
}

// ---------- buildOutreachPrompt ----------
const prompt = buildOutreachPrompt({
  email: 'sarah@example.com',
  name: 'Sarah',
  role: 'Head of Sales',
  company: 'Acme SaaS',
  firmographics: { industry: 'SaaS', employees: 150, country: 'United States' },
  icp_score: 85,
});
check('prompt is a string', typeof prompt, 'string');
check('mentions company', prompt.includes('Acme SaaS'), true);
check('mentions recipient name', prompt.includes('Sarah'), true);
check('mentions role', prompt.includes('Head of Sales'), true);
check('mentions score', prompt.includes('85'), true);
check('asks strict JSON', prompt.toLowerCase().includes('strict json'), true);
check('asks for subject+body', prompt.includes('subject') && prompt.includes('body'), true);
check('max 90 words', /Max 90 words|90 words/i.test(prompt), true);

// Missing optional fields shouldn't crash
const minimal = buildOutreachPrompt({ email: 'a@b.com', company: 'Co' });
check('minimal prompt still builds', typeof minimal, 'string');

// ---------- parseOutreach ----------
const good = parseOutreach({ candidates: [{ content: { parts: [{ text: '{"subject":"Hi","body":"Hello there"}' }] } }] });
check('parses valid json subject', good.subject, 'Hi');
check('parses valid json body', good.body, 'Hello there');

const wrapped = parseOutreach({ candidates: [{ content: { parts: [{ text: '```json\n{"subject":"S1","body":"B1"}\n```' }] } }] });
check('parses markdown-wrapped json', wrapped.subject, 'S1');

const bad = parseOutreach({ candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] });
check('garbage -> fallback subject', bad.subject, 'A thought for your team');
check('garbage -> fallback body non-empty', bad.body.length > 0, true);

const empty = parseOutreach({});
check('empty response -> fallback', extractJson('') === null, true);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
