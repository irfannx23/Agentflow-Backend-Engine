/**
 * Normalize Apollo organization enrichment into AgentFlow's provider-neutral
 * signup qualification contract. Only allowlisted values that are present in
 * Apollo or the real signup context are included; absent values stay absent.
 */

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value) {
  if (!Array.isArray(value)) return undefined;
  const values = [...new Set(value.map(nonEmptyString).filter(Boolean))];
  return values.length ? values : undefined;
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

/** Build a normalized object without copying provider-specific raw fields. */
function normalizeFirmographics(inputJson, baseFirmographics, context = {}) {
  const org = inputJson && inputJson.organization && typeof inputJson.organization === 'object'
    ? inputJson.organization
    : null;
  const base = baseFirmographics && typeof baseFirmographics === 'object' ? baseFirmographics : {};
  const technologies = org
    ? stringArray([
        ...(Array.isArray(org.technology_names) ? org.technology_names : []),
        ...(Array.isArray(org.current_technologies)
          ? org.current_technologies.map((technology) => technology && technology.name)
          : []),
      ])
    : undefined;

  return compact({
    company_name: nonEmptyString(org?.name) || nonEmptyString(context.company_name) || nonEmptyString(base.company_name),
    domain: nonEmptyString(org?.primary_domain) || nonEmptyString(context.domain) || nonEmptyString(base.domain),
    industry: nonEmptyString(org?.industry),
    industries: stringArray(org?.industries),
    employee_count: finiteNumber(org?.estimated_num_employees),
    country: nonEmptyString(org?.country),
    region: nonEmptyString(org?.state),
    city: nonEmptyString(org?.city),
    company_description: nonEmptyString(org?.short_description) || nonEmptyString(org?.seo_description),
    founded_year: finiteNumber(org?.founded_year),
    total_funding: finiteNumber(org?.total_funding),
    latest_funding_stage: nonEmptyString(org?.latest_funding_stage),
    latest_funding_round_date: nonEmptyString(org?.latest_funding_round_date),
    headcount_growth_6m: finiteNumber(org?.organization_headcount_six_month_growth),
    headcount_growth_12m: finiteNumber(org?.organization_headcount_twelve_month_growth),
    headcount_growth_24m: finiteNumber(org?.organization_headcount_twenty_four_month_growth),
    technologies,
    email_verification_status: nonEmptyString(context.email_verification_status),
    email_classification: nonEmptyString(context.email_classification),
    acquisition_source: nonEmptyString(context.acquisition_source),
    auth_provider: nonEmptyString(context.auth_provider),
    signup_event: nonEmptyString(context.signup_event),
    enrichment_provider: org ? 'apollo' : undefined,
  });
}

export default function parseEnrichment() {
  const input = $input.first().json || {};
  const sanitized = $('Sanitize Lead').first().json || {};
  const rawPayload = sanitized.raw_payload && typeof sanitized.raw_payload === 'object'
    ? sanitized.raw_payload
    : {};
  let verification = {};
  let enrichmentRequested = false;
  try {
    if ($('Parse Verification').isExecuted) verification = $('Parse Verification').first().json || {};
  } catch {}
  try {
    enrichmentRequested = Boolean($('Call Enrich API').isExecuted);
  } catch {}

  const organizationMatched = Boolean(input.organization && typeof input.organization === 'object');
  const firmographics = normalizeFirmographics(input, sanitized.firmographics, {
    company_name: sanitized.company_name,
    domain: sanitized.email_domain,
    email_verification_status: verification.verification_status === 'completed'
      ? verification.verdict
      : 'not_run',
    email_classification: sanitized.email_domain ? 'business' : undefined,
    acquisition_source: sanitized.source,
    auth_provider: rawPayload.auth_provider,
    signup_event: rawPayload.source_event,
  });
  const leadId = $('Normalize Lead Context').first().json.lead_id;

  return [{
    lead_id: leadId,
    enrichment_status: organizationMatched ? 'matched' : (enrichmentRequested ? 'not_found' : 'not_requested'),
    firmographics,
  }];
}
