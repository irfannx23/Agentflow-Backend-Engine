/**
 * ============================================
 * n8n Code Node — Ingestion Sanitization
 * ============================================
 * Paste this into an n8n "Code" node (JavaScript mode).
 *
 * Purpose (Step 2: Ingestion Logic):
 *   1. Validate email domain format.
 *   2. Filter out temporary / disposable email providers
 *      (e.g. @tempmail.com, @mailinator.com, etc.).
 *   3. Strip malformed text string inputs from the incoming
 *      lead payload.
 *
 * Business rules (see .clinerules):
 *   * Sanitization: strip malformed text & personal domains
 *     (e.g. @gmail.com, @yahoo.com) before scoring.
 *   * Data privacy: use synthetic test payloads in dev.
 *
 * Input:  $input.first().json  (the inbound lead object)
 * Output: { json: { ...sanitizedLead, sanitized: true } }
 *         or { json: { ...lead, sanitized: false, reason } }
 *         when the lead is rejected.
 * ============================================
 */

// Disposable / temporary email domains to block outright.
const TEMP_EMAIL_DOMAINS = new Set([
  'tempmail.com',
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'yopmail.com',
  'throwawaymail.com',
  'sharklasers.com',
  'maildrop.cc',
  'getnada.com',
  'temp-mail.org',
  'dispostable.com',
  'mailnesia.com',
  'trashmail.com',
  'spamgourmet.com',
  'mintemail.com',
  'mailcatch.com',
  'mytemp.email',
  'tempinbox.com',
  'fakeinbox.com',
  'emailondeck.com',
]);

// Personal / consumer domains to strip before scoring.
const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'gmx.com',
  'mail.com',
  'live.com',
  'msn.com',
]);

// Student / academic domains to strip before scoring (anti-ICP Stage 5).
const STUDENT_DOMAINS = new Set([
  'student.edu',
  'university.edu',
  'college.edu',
  'academia.edu',
  'students.edu',
  'alumni.edu',
  'edu',
  'ac.uk',
  'ac.in',
  'edu.au',
  'edu.cn',
  'edu.sg',
  'uni.edu',
]);

// Competitor / out-of-ICP company domains to block (anti-ICP Stage 5).
// NOTE: keep this list current as the competitive set changes.
const COMPETITOR_DOMAINS = new Set([
  'hubspot.com',
  'salesforce.com',
  'pipedrive.com',
  'zoho.com',
  'freshworks.com',
  'intercom.com',
  'drift.com',
  'clearbit.com',
  'clay.com',
  'apollo.io',
]);

// Unsupported jurisdictions (anti-ICP Stage 5).
// Country codes (ISO 3166-1 alpha-2) whose leads are auto-disqualified.
const BLOCKED_JURISDICTIONS = new Set([
  'KP', // North Korea
  'IR', // Iran
  'CU', // Cuba
  'SY', // Syria
  'BY', // Belarus
  'RU', // Russia
  'VE', // Venezuela
  'MM', // Myanmar
  'SD', // Sudan
  'ZW', // Zimbabwe
]);

// Common country names / aliases -> ISO code, so a payload carrying a country
// NAME (e.g. "Russia", "Russian Federation") is blocked just like a code.
// Keys are normalized: lowercase, letters/spaces only. Keep in sync with
// n8n-jurisdiction-check.js (Stage 5 backstop node).
const COUNTRY_NAME_TO_CODE = {
  'russia': 'RU',
  'russian federation': 'RU',
  'rf': 'RU',
  'belarus': 'BY',
  'belorussia': 'BY',
  'iran': 'IR',
  'islamic republic of iran': 'IR',
  'persia': 'IR',
  'north korea': 'KP',
  'democratic peoples republic of korea': 'KP',
  'dprk': 'KP',
  'cuba': 'CU',
  'syria': 'SY',
  'syrian arab republic': 'SY',
  'venezuela': 'VE',
  'bolivarian republic of venezuela': 'VE',
  'myanmar': 'MM',
  'burma': 'MM',
  'myanmar burma': 'MM',
  'sudan': 'SD',
  'zimbabwe': 'ZW',
};

/** Normalize a country name for lookup: lowercase, strip punctuation. */
function normalizeCountryName(name) {
  if (typeof name !== 'string') return '';
  return name.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a country signal (ISO code and/or name) against the blocklist.
 * Returns { blocked, code } — code is the ISO alpha-2 code when blocked.
 */
function resolveBlockedCountry(countryCode, countryName) {
  if (typeof countryCode === 'string') {
    const code = countryCode.trim().toUpperCase();
    if (BLOCKED_JURISDICTIONS.has(code)) {
      return { blocked: true, code };
    }
  }
  const normalized = normalizeCountryName(countryName);
  if (normalized && COUNTRY_NAME_TO_CODE[normalized]) {
    const code = COUNTRY_NAME_TO_CODE[normalized];
    if (BLOCKED_JURISDICTIONS.has(code)) {
      return { blocked: true, code };
    }
  }
  return { blocked: false, code: null };
}

// Basic RFC-ish email format check.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Normalize a string: trim, collapse internal whitespace,
 * and strip control characters / malformed tokens.
 */
function normalizeText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ') // control chars
    .replace(/\s+/g, ' ')                    // collapse whitespace
    .trim();
}

/**
 * Validate and sanitize an email address.
 * Returns { ok, email, domain, reason }.
 */
function sanitizeEmail(email) {
  if (typeof email !== 'string') {
    return { ok: false, email: null, domain: null, reason: 'email_missing' };
  }

  const cleaned = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(cleaned)) {
    return { ok: false, email: null, domain: null, reason: 'email_invalid_format' };
  }

  const domain = cleaned.split('@')[1].toLowerCase();

  if (TEMP_EMAIL_DOMAINS.has(domain)) {
    return { ok: false, email: cleaned, domain, reason: 'temporary_email_provider' };
  }

  if (PERSONAL_DOMAINS.has(domain)) {
    return { ok: false, email: cleaned, domain, reason: 'personal_domain' };
  }

  // Anti-ICP Stage 5 hard exclusions.
  if (STUDENT_DOMAINS.has(domain) || domain.endsWith('.edu')) {
    return { ok: false, email: cleaned, domain, reason: 'student_domain' };
  }

  if (COMPETITOR_DOMAINS.has(domain)) {
    return { ok: false, email: cleaned, domain, reason: 'competitor_domain' };
  }

  return { ok: true, email: cleaned, domain, reason: null };
}

/**
 * Recursively strip malformed text from string fields in the
 * payload, preserving structure of nested objects/arrays.
 */
function stripMalformedText(value) {
  if (typeof value === 'string') {
    return normalizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map(stripMalformedText);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = stripMalformedText(value[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stableHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function resolveIngestionEventId(raw, lead) {
  const headers = raw && typeof raw.headers === 'object' ? raw.headers : {};
  const existing = firstNonEmptyString(
    lead.event_id,
    lead.eventId,
    lead.ingestion_event_id,
    lead.hookdeck_event_id,
    raw.event_id,
    raw.eventId,
    raw.id,
    raw.hookdeck_event_id,
    headers['x-hookdeck-eventid'],
    headers['x-hookdeck-event-id'],
    headers['x-event-id']
  );
  if (existing) return existing;

  const seed = stableStringify({
    source_type: lead.source_type || raw.source_type || 'inbound',
    submitted_at: lead.submitted_at || lead.timestamp || lead.created_at || raw.timestamp || null,
    payload: lead,
  });
  return `cp_ingest_${stableHash(seed)}`;
}

/**
 * Main entry point for the n8n Code node.
 */
export default function sanitizeLead() {
  // Hookdeck / n8n may wrap the payload in an envelope (headers/params/query/body);
  // unwrap if present so we always operate on the lead object itself.
  const raw = $input.first().json;
  const lead = raw.body && typeof raw.body === 'object' ? raw.body : raw;

  // 0. Strip malformed text FIRST — before any gate. Rejected leads (bad email,
  //    blocked jurisdiction) also flow to Log Spam, and control characters
  //    (\u0000 etc.) crash Postgres with 22P05 if they reach the spam_log RPC.
  const strippedLead = stripMalformedText(lead);
  const eventId = resolveIngestionEventId(raw, strippedLead);

  // 1. Sanitize the email next — gate everything else on it.
  const emailCheck = sanitizeEmail(strippedLead.email);

  if (!emailCheck.ok) {
    return {
      json: {
        ...strippedLead,
        sanitized: false,
        reason: emailCheck.reason,
        email: emailCheck.email || null,
        event_id: eventId,
      },
    };
  }

  // Anti-ICP Stage 5: hard-exclude blocked jurisdictions when the payload
  // carries a country signal (ISO code or name) — reject at the door so we
  // never spend verification/enrichment credits on them.
  const jurisdiction = resolveBlockedCountry(strippedLead.country_code, strippedLead.country);
  if (jurisdiction.blocked) {
    return {
      json: {
        ...strippedLead,
        sanitized: false,
        reason: 'blocked_jurisdiction',
        email: emailCheck.email || null,
        event_id: eventId,
        country_code: jurisdiction.code,
      },
    };
  }

  // 2. Pass branch: lead is already stripped (step 0). Re-apply the validated
  //    email (normalized + lowercased).
  const sanitizedLead = { ...strippedLead, event_id: eventId };
  sanitizedLead.email = emailCheck.email;

  return {
    json: {
      ...sanitizedLead,
      sanitized: true,
      email_domain: emailCheck.domain,
    },
  };
}
