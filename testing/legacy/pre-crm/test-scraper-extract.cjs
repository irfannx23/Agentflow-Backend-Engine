// Throwaway test harness for Acquisition/Signal_Outbound/Scraper/extract.ts (compiled to dist).
// Tests the pure extraction + normalization logic, including a Cheerio parse
// of the fixture team page (Acquisition/Signal_Outbound/Fixtures/site/team.html).
const path = require('path');
const fs = require('fs');
const cheerio = require('cheerio');

const { extractEmails, domainFromEmail, normalizeContact, extractFromHtml } = require(
  path.join(__dirname, '..', '..', '..', 'dist', 'core', 'gtm', 'acquisition', 'signal-outbound', 'scraper', 'extract.js'),
);

let pass = 0, fail = 0;
function check(name, got, expected) {
  const ok = got === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ` | got: ${JSON.stringify(got)} expected: ${JSON.stringify(expected)}`}`);
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function has(arr, v) { return Array.isArray(arr) && arr.some((x) => (x.email || x) === v); }

// ---------- extractEmails ----------
check('emails unique+lowercased', eq(extractEmails('jane@ACME.com and jane@acme.com and bob@acme.com'), ['jane@acme.com', 'bob@acme.com']), true);
check('no emails -> []', eq(extractEmails('hello world'), []), true);

// ---------- domainFromEmail ----------
check('domain from email', domainFromEmail('jane@acme.com'), 'acme.com');
check('www stripped', domainFromEmail('jane@www.acme.com'), 'acme.com');
check('no dot -> null', domainFromEmail('x@bad'), null);

// ---------- normalizeContact ----------
let c = normalizeContact({ email: '  Jane@Acme.com ', name: 'Jane', company: 'Acme', domain: 'acme.com' });
check('normalize lowercases + trims email', c && c.email, 'jane@acme.com');
check('normalize keeps company', c && c.company, 'Acme');
check('normalize derives domain', normalizeContact({ email: 'x@acme.com' }).domain, 'acme.com');
check('mailto stripped', normalizeContact({ email: 'mailto:j@acme.com' }).email, 'j@acme.com');
check('missing email -> null', normalizeContact({}), null);
check('asset email -> null', normalizeContact({ email: 'contact@2x.png' }), null);
check('invalid email -> null', normalizeContact({ email: 'not-an-email' }), null);

// ---------- extractFromHtml (fixture team page) ----------
const html = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'core', 'gtm', 'acquisition', 'signal-outbound', 'fixtures', 'site', 'team.html'), 'utf8');
const $ = cheerio.load(html);
const contacts = extractFromHtml($, 'https://www.acmeindustries.com/', 'Acme Industries');

check('found mailto contact jane', has(contacts, 'jane@acmeindustries.com'), true);
check('found mailto contact raj', has(contacts, 'raj@acmeindustries.com'), true);
check('found mailto contact priya', has(contacts, 'priya@acmeindustries.com'), true);
check('found mailto contact tom', has(contacts, 'tom@acmeindustries.com'), true);
check('found bare email w/ role', has(contacts, 'ops.lead@acmeindustries.com'), true);
check('asset 2x.png email ignored', has(contacts, 'contact@2x.png'), false);

const jane = contacts.find((x) => x.email === 'jane@acmeindustries.com');
check('jane name extracted', jane && jane.name, 'Jane Smith');
check('jane role detected', jane && jane.role && jane.role.toLowerCase().includes('executive'), true);
check('jane company', jane && jane.company, 'Acme Industries');
check('jane domain (www stripped)', jane && jane.domain, 'acmeindustries.com');

const priya = contacts.find((x) => x.email === 'priya@acmeindustries.com');
check('priya role (revops)', priya && priya.role && priya.role.toLowerCase().includes('revops'), true);

const tom = contacts.find((x) => x.email === 'tom@acmeindustries.com');
check('tom role (director, not cto substring)', tom && tom.role, 'Director');

const ops = contacts.find((x) => x.email === 'ops.lead@acmeindustries.com');
check('bare email role near sales-ops', ops && ops.role && ops.role.toLowerCase().includes('sales'), true);

check('no duplicates', new Set(contacts.map((x) => x.email)).size === contacts.length, true);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
