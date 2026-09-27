/**
 * Scraper CLI (M1). Crawls a list of company domains/bases and writes the
 * extracted contacts to JSON/CSV for the outbound ingest stage.
 *
 * Usage:
 *   node dist/scraper/index.js --domains acme.com,beta.io [--output out.json]
 *   node dist/scraper/index.js --file targets.txt --output out.json
 *   node dist/scraper/index.js --domains localhost:8080 --delay 200 --max-pages 10
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { crawlCompany } from './crawl.js';
import { renderPage, closeRenderer } from './render.js';

function argVal(flag: string, def?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main(): Promise<void> {
  const domainsArg = argVal('--domains');
  const fileArg = argVal('--file');
  const output = argVal('--output');
  const delay = Number(argVal('--delay', '2000'));
  const maxPages = Number(argVal('--max-pages', '10'));
  const useRender = process.argv.includes('--render');

  let domains: string[] = [];
  if (domainsArg) domains = domainsArg.split(',').map((s) => s.trim()).filter(Boolean);
  if (fileArg) {
    domains = domains.concat(
      readFileSync(fileArg, 'utf8')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  domains = [...new Set(domains)];
  if (domains.length === 0) {
    console.error('Usage: --domains a.com,b.com | --file list.txt  [--output out.json] [--delay ms] [--max-pages n]');
    process.exit(2);
  }

  const all: unknown[] = [];
  for (const d of domains) {
    const r = await crawlCompany(d, {
      delayMs: delay,
      maxPagesPerDomain: maxPages,
      renderPage: useRender ? renderPage : undefined,
    });
    console.log(
      `[${r.domain}] ${r.pagesFetched} pages, ${r.contacts.length} contacts, ` +
        `${r.skippedRobots.length} robots-skipped, ${r.errors.length} errors`,
    );
    for (const c of r.contacts) console.log(`  ${c.email}\t${c.name || '-'}\t${c.role || '-'}`);
    all.push(...r.contacts.map((c) => ({ ...c })));
  }

  if (output) {
    writeFileSync(output, JSON.stringify(all, null, 2));
    console.log(`wrote ${all.length} contacts to ${output}`);
  }

  if (useRender) await closeRenderer();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
