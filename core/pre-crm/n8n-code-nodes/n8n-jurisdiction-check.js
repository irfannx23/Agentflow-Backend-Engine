/**
 * ============================================
 * n8n Code Node — Stage 5: Blocked-Jurisdiction Check
 * ============================================
 * Paste this into an n8n "Code" node (JavaScript mode).
 *
 * Purpose:
 *   Enforce the anti-ICP hard-exclusion list for unsupported jurisdictions.
 *   Runs AFTER Stage 4 enrichment (which may reveal the country via the
 *   org's firmographics — Apollo returns country as a NAME, e.g. "Russia"),
 *   and BEFORE Stage 6 scoring. A blocked lead is never scored/CRM'd.
 *
 * Business rules (see .clinerules):
 *   * Blocked jurisdictions: KP, IR, CU, SY, BY, RU, VE, MM, SD, ZW.
 *   * Accepts ISO 3166-1 alpha-2 country_code OR a common country name
 *     (Apollo's name form) — both are normalized to the ISO code.
 *   * This node is the post-enrichment backstop; the sanitizer (Stage 1)
 *     already rejects payload-provided country signals at the door.
 *
 * Reads:
 *   $('Parse Enrichment')           -> { lead_id, firmographics }
 *   $('Dedup: Get or Create Lead')  -> { lead_id }
 *
 * Outputs (to "Jurisdiction OK?" IF node):
 *   [{ lead_id, jurisdiction_blocked, country_code }]
 * ============================================
 */

// Unsupported jurisdictions (ISO 3166-1 alpha-2) whose leads are auto-disqualified.
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

// Common country names / aliases -> ISO code, for the name-form country
// field that enrichment providers (Apollo) return. Keys are normalized:
// lowercase, letters/spaces only.
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

export default function jurisdictionCheck() {
  const enriched = $('Parse Enrichment').first().json;
  const firmographics = (enriched && enriched.firmographics) || {};
  const leadId = $('Dedup: Get or Create Lead').first().json.lead_id;

  const res = resolveBlockedCountry(firmographics.country_code, firmographics.country);

  return [{
    lead_id: leadId,
    jurisdiction_blocked: res.blocked,
    country_code: res.code || firmographics.country_code || null,
  }];
}
