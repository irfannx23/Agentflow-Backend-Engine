/**
 * Pure extraction + normalization for the scraper (M1).
 *
 * No I/O in this file — everything here is unit-testable. The two kinds of
 * extraction are:
 *   1. raw-text email scanning (extractEmails)
 *   2. DOM-aware extraction from a Cheerio parse (extractFromHtml), which
 *      prefers mailto: links and looks for role keywords near each email.
 *
 * Heuristics are intentionally conservative: we only keep contacts with a
 * valid-looking email, we skip anything that looks like an asset, and we let
 * the engine's sanitize stage do the strict filtering later.
 */
import type { CheerioAPI } from 'cheerio';
import type { ScrapedContact } from './types.js';

/** Loose email pattern — enough to catch mailto links and page text. */
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}/g;

/** Role keywords looked for within ~60 chars of an email / in a link's context.
 * Ordered most-specific-first so a role like "VP of RevOps" returns "RevOps",
 * not the broader "Vp". */
const ROLE_KEYWORDS = [
  'account executive', 'co-founder', 'cofounder', 'vice president',
  'revenue operations', 'revops', 'head of', 'ceo', 'cto', 'cfo', 'coo',
  'cmo', 'founder', 'director', 'vp', 'sales', 'marketing', 'operations',
  'manager', 'president', 'executive', 'chief', 'lead',
];

/** Unique, lowercased emails found in a block of text. */
export function extractEmails(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // EMAIL_RE is a shared global regex — reset lastIndex so matchAll always
  // scans from the start. (normalizeContact's .test() leaves lastIndex set,
  // which otherwise makes matchAll begin mid-string and emit substrings like
  // "aya@acmejs.example" out of "maya@acmejs.example".)
  EMAIL_RE.lastIndex = 0;
  for (const m of text.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase();
    if (!seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

/** Domain (no www.) from an email address, or null. */
export function domainFromEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const d = email.slice(at + 1);
  return d && d.includes('.') ? d.replace(/^www\./, '') : null;
}

/**
 * Normalize a raw extracted record into a ScrapedContact, or null if it is
 * unusable (no/invalid email, or the "email" is actually an asset filename).
 */
export function normalizeContact(raw: {
  email?: string;
  name?: string;
  role?: string;
  company?: string;
  domain?: string;
  source_url?: string;
}): ScrapedContact | null {
  if (!raw.email) return null;
  let email = raw.email.trim().toLowerCase().replace(/^mailto:/i, '');
  // Skip asset-looking "emails" like foo@2x.png
  if (/\.(png|jpe?g|gif|svg|webp|css|js)(@|$)/i.test(email)) return null;
  EMAIL_RE.lastIndex = 0;
  if (!EMAIL_RE.test(email)) return null;

  const domain = raw.domain || domainFromEmail(email);
  if (!domain) return null;

  const company = (raw.company || domain).trim();
  return {
    email,
    name: raw.name && raw.name.trim() ? raw.name.trim() : null,
    role: raw.role && raw.role.trim() ? raw.role.trim() : null,
    company,
    domain,
    source_url: raw.source_url || '',
  };
}

/** First role keyword found in a block of text (title-cased), or null.
 * Matches on whole-word boundaries so short keywords like "cto" don't match
 * inside longer words (e.g. "direcTOR"). */
function findRole(text: string): string | null {
  const t = (text || '').toLowerCase();
  for (const kw of ROLE_KEYWORDS) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${esc}\\b`).test(t)) {
      return kw
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }
  return null;
}

/**
 * Extract contacts from a parsed page. Prefers mailto: links (name usually
 * in the link text), then falls back to bare emails in the body text with a
 * role keyword nearby.
 */
export function extractFromHtml($: CheerioAPI, baseUrl: string, company: string): ScrapedContact[] {
  const out: ScrapedContact[] = [];
  const domain = (() => {
    try {
      return new URL(baseUrl).hostname.replace(/^www\./, '');
    } catch {
      return baseUrl.replace(/^www\./, '');
    }
  })();
  const seen = new Set<string>();
  const push = (c: ScrapedContact | null) => {
    if (c && !seen.has(c.email)) {
      seen.add(c.email);
      out.push(c);
    }
  };

  // 1. mailto: links
  $('a[href^="mailto:"]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const email = (href.replace(/^mailto:/i, '').split('?')[0] ?? '').trim();
    const linkText = $(el).text().trim();
    const containerEl = $(el).closest('li,p,td,div');
    const containerText = containerEl.text();
    // Name usually lives in a sibling <strong> (the link text is often the
    // email itself) — fall back to the link text only if it isn't an email.
    let name = containerEl.find('strong').first().text().trim() || linkText;
    if (name && /@/.test(name)) name = '';
    push(
      normalizeContact({
        email,
        name: name || undefined,
        role: findRole(containerText) || findRole(linkText) || undefined,
        company,
        domain,
        source_url: baseUrl,
      }),
    );
  });

  // 2. bare emails, scanned per container element so text doesn't bleed
  //    across <li>/<p> boundaries (avoids concatenating adjacent emails into
  //    junk like "maya@acmejs.exampleleo").
  $('p,li,td,th,h1,h2,h3,h4,h5,h6,dt,dd,span,strong,address').each((_i, el) => {
    const elText = $(el).text();
    for (const email of extractEmails(elText)) {
      if (seen.has(email)) continue;
      push(
        normalizeContact({
          email,
          role: findRole(elText) || undefined,
          company,
          domain,
          source_url: baseUrl,
        }),
      );
    }
  });

  return out;
}
