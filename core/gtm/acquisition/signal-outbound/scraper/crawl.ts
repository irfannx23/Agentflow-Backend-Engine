/**
 * Polite crawler (M1). Fetches a company's public contact/team/about pages,
 * extracts contacts, and respects robots.txt + a per-domain rate limit.
 *
 * All I/O is here (fetch, robots parsing). Extraction stays pure in extract.ts.
 */
import { load } from 'cheerio';
import type { ScrapedContact } from './types.js';
import { extractFromHtml } from './extract.js';

const DEFAULT_USER_AGENT = 'PreCRM-Demo-Bot/1.0 (+revops portfolio demo)';

/** Candidate paths crawled for every company (both styles are common). */
const CANDIDATE_PATHS = [
  '',
  '/contact', '/contact.html', '/contact-us', '/contact-us.html',
  '/team', '/team.html', '/about', '/about.html', '/about-us', '/about-us.html',
];

export interface CrawlOptions {
  userAgent?: string;
  delayMs?: number;
  maxPagesPerDomain?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /** M2 hook: render a JS-only page to HTML before extraction. */
  renderPage?: (url: string) => Promise<string>;
}

/** Turn a user-supplied target into a full base URL (handles localhost/port). */
export function normalizeBase(input: string): string {
  let s = input.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?$/.test(s) || /^127\./.test(s) || /:\d+$/.test(s)) {
    return `http://${s}`;
  }
  return `https://${s}`;
}

/** Host (with port) without scheme/www. */
export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^www\./, '');
  }
}

export async function fetchWithRetry(
  url: string,
  opts: Required<Pick<CrawlOptions, 'userAgent' | 'timeoutMs' | 'maxRetries' | 'delayMs'>>,
): Promise<{ status: number; html: string; finalUrl: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': opts.userAgent, accept: 'text/html,application/xhtml+xml' },
        redirect: 'follow',
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const status = res.status;
      const html = await res.text();
      if (status >= 500 && attempt < opts.maxRetries) {
        await sleep(opts.delayMs * (attempt + 1));
        continue;
      }
      return { status, html, finalUrl: res.url || url };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < opts.maxRetries) await sleep(opts.delayMs * (attempt + 1));
    }
  }
  return { status: 0, html: '', finalUrl: url };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Parse robots.txt for `User-agent: *`. Returns a function that says whether
 * a given path is allowed (simple prefix matching, default allow).
 */
export function parseRobots(raw: string): (path: string) => boolean {
  const disallow: string[] = [];
  let currentAgentMatches = false;
  for (const line of raw.split(/\r?\n/)) {
    const [key, ...rest] = line.split(':');
    const val = rest.join(':').trim();
    const k = (key || '').trim().toLowerCase();
    if (k === 'user-agent') currentAgentMatches = /^\*$/.test(val) || /precrm/i.test(val);
    else if (k === 'disallow' && currentAgentMatches) disallow.push(val || '/');
  }
  return (path: string) => {
    const p = path.split('?')[0] ?? path;
    return !disallow.some((d) => d !== '/' && p.startsWith(d));
  };
}

export interface CompanyCrawlResult {
  domain: string;
  base: string;
  contacts: ScrapedContact[];
  pagesFetched: number;
  skippedRobots: string[];
  errors: { url: string; status: number }[];
}

/** Crawl one company's site and extract contacts (robots + rate-limit aware). */
export async function crawlCompany(input: string, opts: CrawlOptions = {}): Promise<CompanyCrawlResult> {
  const ua = opts.userAgent || DEFAULT_USER_AGENT;
  const delayMs = opts.delayMs ?? 2000;
  const maxPages = opts.maxPagesPerDomain ?? 10;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const maxRetries = opts.maxRetries ?? 2;
  const fetchOpts = { userAgent: ua, delayMs, timeoutMs, maxRetries };
  const base = normalizeBase(input);
  const domain = hostFromUrl(base);

  const result: CompanyCrawlResult = { domain, base, contacts: [], pagesFetched: 0, skippedRobots: [], errors: [] };

  // robots.txt once per domain
  let allowPath: (p: string) => boolean = () => true;
  try {
    const r = await fetchWithRetry(`${base}/robots.txt`, fetchOpts);
    if (r.status === 200 && r.html) allowPath = parseRobots(r.html);
  } catch {
    /* no robots.txt -> default allow */
  }

  const seenEmails = new Set<string>();
  const pushContacts = (html: string, sourceUrl: string, useCompany: string) => {
    const $ = load(html);
    for (const c of extractFromHtml($, sourceUrl, useCompany)) {
      if (!seenEmails.has(c.email)) {
        seenEmails.add(c.email);
        result.contacts.push(c);
      }
    }
  };
  // A page is a render candidate if it's suspiciously short, or if it has
  // <script> but no static mailto link (i.e. contacts are built in JS).
  const needsRender = (html: string) =>
    !!opts.renderPage && (html.length < 200 || (/<script/i.test(html) && !/href="mailto:/i.test(html)));
  const maybeRender = async (html: string, sourceUrl: string) =>
    needsRender(html) ? opts.renderPage!(sourceUrl) : html;

  // Homepage: used for the company name AND its contacts (fetched once).
  let company = domain;
  const home = await fetchWithRetry(base, fetchOpts);
  result.pagesFetched += 1;
  if (home.status === 200 && home.html) {
    const title = load(home.html)('title').first().text().trim();
    if (title) company = title;
    const homeHtml = await maybeRender(home.html, home.finalUrl || base);
    pushContacts(homeHtml, home.finalUrl || base, company);
  } else if (home.status !== 0) {
    result.errors.push({ url: base, status: home.status });
  }

  let fetched = 1; // homepage already counted
  for (const path of CANDIDATE_PATHS) {
    if (!path) continue; // homepage handled above
    if (fetched >= maxPages) break;
    const url = `${base}${path}`;
    if (!allowPath(path)) {
      result.skippedRobots.push(url);
      continue;
    }
    const res = await fetchWithRetry(url, fetchOpts);
    result.pagesFetched += 1;
    fetched += 1;
    if (res.status !== 200) {
      result.errors.push({ url, status: res.status });
    } else if (res.html) {
      const html = await maybeRender(res.html, res.finalUrl || url);
      pushContacts(html, res.finalUrl || url, company);
    }
    if (fetched < maxPages && path !== CANDIDATE_PATHS[CANDIDATE_PATHS.length - 1]) {
      await sleep(delayMs);
    }
  }
  return result;
}
