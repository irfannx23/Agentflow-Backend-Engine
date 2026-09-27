export const ACQUISITION_CHANNELS = ['inbound', 'plg', 'outbound', 'partner', 'creator', 'referral'] as const

export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number]

export const ACQUISITION_SOURCE_CATALOG = {
  inbound: ['website', 'pricing_form', 'demo_request'],
  plg: ['organic_signup', 'paid_signup', 'direct_signup'],
  outbound: ['scraper', 'manual_prospecting', 'signal_outbound'],
  partner: ['agency', 'consultant'],
  creator: ['youtube', 'linkedin', 'newsletter', 'podcast'],
  referral: ['customer_referral', 'partner_referral', 'invite'],
} as const satisfies Record<AcquisitionChannel, readonly string[]>

export type AcquisitionEnvelope = {
  channel: AcquisitionChannel
  source: string | null
  source_id: string | null
  medium: string | null
  campaign: string | null
  referrer: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  partner_id: string | null
  creator_id: string | null
  referral_id: string | null
}

export type AcquisitionEnvelopeInput = Partial<AcquisitionEnvelope> & {
  channel?: unknown
}

type PlainRecord = Record<string, unknown>

const TOKEN_MAX_LENGTH = 120
const IDENTIFIER_MAX_LENGTH = 160
const REFERRER_MAX_LENGTH = 512

function isPlainObject(value: unknown): value is PlainRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function trimToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = collapseWhitespace(value.replace(/[\u0000-\u001F\u007F]/g, ' '))
  return cleaned.length > 0 ? cleaned : null
}

function normalizeToken(value: unknown, maxLength = TOKEN_MAX_LENGTH): string | null {
  const cleaned = trimToNull(value)
  if (!cleaned) return null
  const normalized = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!normalized) return null
  if (normalized.length > maxLength) throw new Error('invalid_acquisition_field_length')
  return normalized
}

function normalizeIdentifier(value: unknown, maxLength = IDENTIFIER_MAX_LENGTH): string | null {
  const cleaned = trimToNull(value)
  if (!cleaned) return null
  if (cleaned.length > maxLength) throw new Error('invalid_acquisition_field_length')
  return cleaned
}

function normalizeReferrer(value: unknown): string | null {
  const cleaned = trimToNull(value)
  if (!cleaned) return null
  if (cleaned.length > REFERRER_MAX_LENGTH) throw new Error('invalid_acquisition_field_length')
  return cleaned
}

function normalizeChannel(value: unknown): AcquisitionChannel {
  const channel = normalizeToken(value, 24)
  if (!channel || !ACQUISITION_CHANNELS.includes(channel as AcquisitionChannel)) {
    throw new Error('invalid_acquisition_channel')
  }
  return channel as AcquisitionChannel
}

export function resolveAcquisitionChannelFromSourceType(sourceType: unknown): AcquisitionChannel | null {
  const normalized = normalizeToken(sourceType, 32)
  if (!normalized) return null
  if (normalized === 'outbound_scraped') return 'outbound'
  if (normalized === 'inbound') return 'inbound'
  return null
}

function pickValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && collapseWhitespace(value).length > 0) {
      return value
    }
  }
  return null
}

function getRawPayload(input: PlainRecord): PlainRecord {
  return isPlainObject(input.raw_payload) ? input.raw_payload : {}
}

function resolveEnvelope(input: AcquisitionEnvelopeInput, defaults: Partial<AcquisitionEnvelope> = {}): AcquisitionEnvelope {
  if (!isPlainObject(input)) {
    throw new Error('invalid_acquisition_envelope')
  }

  const merged = { ...defaults, ...input } as PlainRecord
  const channel = normalizeChannel(merged.channel)

  return {
    channel,
    source: normalizeToken(merged.source),
    source_id: normalizeIdentifier(merged.source_id),
    medium: normalizeToken(merged.medium),
    campaign: normalizeToken(merged.campaign),
    referrer: normalizeReferrer(merged.referrer),
    utm_source: normalizeToken(merged.utm_source),
    utm_medium: normalizeToken(merged.utm_medium),
    utm_campaign: normalizeToken(merged.utm_campaign),
    utm_content: normalizeToken(merged.utm_content),
    utm_term: normalizeToken(merged.utm_term),
    partner_id: normalizeIdentifier(merged.partner_id),
    creator_id: normalizeIdentifier(merged.creator_id),
    referral_id: normalizeIdentifier(merged.referral_id),
  }
}

function baseFromRawPayload(rawPayload: PlainRecord) {
  return {
    source: pickValue(rawPayload.source, rawPayload.form, rawPayload.origin),
    source_id: pickValue(rawPayload.source_id, rawPayload.form_id, rawPayload.campaign_id),
    medium: pickValue(rawPayload.medium, rawPayload.channel, rawPayload.source_medium),
    campaign: pickValue(rawPayload.campaign, rawPayload.utm_campaign),
    referrer: pickValue(rawPayload.referrer, rawPayload.referer, rawPayload.referrer_url),
    utm_source: pickValue(rawPayload.utm_source),
    utm_medium: pickValue(rawPayload.utm_medium),
    utm_campaign: pickValue(rawPayload.utm_campaign),
    utm_content: pickValue(rawPayload.utm_content),
    utm_term: pickValue(rawPayload.utm_term),
    partner_id: pickValue(rawPayload.partner_id),
    creator_id: pickValue(rawPayload.creator_id),
    referral_id: pickValue(rawPayload.referral_id),
  }
}

export function normalizeAcquisitionEnvelope(input: unknown, defaults: Partial<AcquisitionEnvelope> = {}) {
  return resolveEnvelope(input as AcquisitionEnvelopeInput, defaults)
}

export function mapInboundAcquisitionEnvelope(input: {
  event_id?: string | null
  source_type?: string | null
  source?: string | null
  source_id?: string | null
  raw_payload?: PlainRecord | null
}) {
  const rawPayload = isPlainObject(input.raw_payload) ? input.raw_payload : {}
  return resolveEnvelope(
    {
      channel: 'inbound',
      ...baseFromRawPayload(rawPayload),
      source: pickValue(input.source, rawPayload.source, rawPayload.form, 'website'),
      source_id: pickValue(input.source_id, rawPayload.source_id, rawPayload.form_id, input.event_id),
      medium: pickValue(rawPayload.medium, rawPayload.form, rawPayload.channel, 'web_form'),
      campaign: pickValue(rawPayload.campaign, rawPayload.utm_campaign),
      referrer: pickValue(rawPayload.referrer, rawPayload.referer, rawPayload.referrer_url),
    },
  )
}

export function mapLeadAcquisitionEnvelope(input: {
  event_id?: string | null
  source_type?: string | null
  source?: string | null
  source_id?: string | null
  raw_payload?: PlainRecord | null
  email?: string | null
  domain?: string | null
  source_url?: string | null
}) {
  const channel = resolveAcquisitionChannelFromSourceType(input.source_type) ?? 'inbound'
  return channel === 'outbound'
    ? mapOutboundAcquisitionEnvelope(input)
    : mapInboundAcquisitionEnvelope(input)
}

export const mapAcquisitionEnvelopeFromLead = mapLeadAcquisitionEnvelope

export function mapOutboundAcquisitionEnvelope(input: {
  email?: string | null
  domain?: string | null
  source_url?: string | null
  source?: string | null
  source_id?: string | null
  medium?: string | null
  campaign?: string | null
  raw_payload?: PlainRecord | null
}) {
  const rawPayload = isPlainObject(input.raw_payload) ? input.raw_payload : {}
  return resolveEnvelope(
    {
      channel: 'outbound',
      ...baseFromRawPayload(rawPayload),
      source: pickValue(input.source, rawPayload.source, 'scraper'),
      source_id: pickValue(input.source_id, input.domain, rawPayload.source_id, input.source_url, rawPayload.url, input.email),
      medium: pickValue(input.medium, rawPayload.medium, 'signal_outbound'),
      campaign: pickValue(input.campaign, rawPayload.campaign, rawPayload.utm_campaign),
      referrer: pickValue(input.source_url, rawPayload.referrer, rawPayload.url),
    },
  )
}

export function mapPlgAcquisitionEnvelope(input: {
  firebase_uid?: string | null
  profile_id?: string | null
  event_name?: string | null
  event_source?: string | null
  source?: string | null
  source_id?: string | null
  medium?: string | null
  campaign?: string | null
  referrer?: string | null
  event_properties?: PlainRecord | null
}) {
  const properties = isPlainObject(input.event_properties) ? input.event_properties : {}
  return resolveEnvelope(
    {
      channel: 'plg',
      ...baseFromRawPayload(properties),
      source: pickValue(input.source, input.event_source, properties.source, 'web_app'),
      source_id: pickValue(input.source_id, input.firebase_uid, input.profile_id, properties.source_id),
      medium: pickValue(input.medium, properties.medium, input.event_name, 'product_event'),
      campaign: pickValue(input.campaign, properties.campaign, properties.utm_campaign),
      referrer: pickValue(input.referrer, properties.referrer, properties.page_referrer, properties.document_referrer),
      utm_source: pickValue(properties.utm_source),
      utm_medium: pickValue(properties.utm_medium),
      utm_campaign: pickValue(properties.utm_campaign),
      utm_content: pickValue(properties.utm_content),
      utm_term: pickValue(properties.utm_term),
      partner_id: pickValue(properties.partner_id),
      creator_id: pickValue(properties.creator_id),
      referral_id: pickValue(properties.referral_id),
    },
  )
}

export function mapAttributedCustomerAcquisitionEnvelope(input: {
  firebase_uid?: string | null
  profile_id?: string | null
  event_name?: string | null
  event_source?: string | null
  source?: string | null
  source_id?: string | null
  medium?: string | null
  campaign?: string | null
  referrer?: string | null
  event_properties?: PlainRecord | null
}) {
  const properties = isPlainObject(input.event_properties) ? input.event_properties : {}
  const partnerId = pickValue(properties.partner_id)
  const creatorId = pickValue(properties.creator_id)
  const referralId = pickValue(properties.referral_id)

  if (referralId) {
    return mapReferralAcquisitionEnvelope({
      referral_id: referralId,
      source: pickValue(input.source, properties.source, properties.utm_source, 'customer_referral'),
      source_id: pickValue(input.source_id, properties.source_id, referralId),
      medium: pickValue(input.medium, properties.medium, 'referral'),
      campaign: pickValue(input.campaign, properties.campaign, properties.utm_campaign),
      referrer: pickValue(input.referrer, properties.referrer, properties.page_referrer, properties.document_referrer),
      raw_payload: properties,
    })
  }

  if (creatorId) {
    return mapCreatorAcquisitionEnvelope({
      creator_id: creatorId,
      source: pickValue(input.source, properties.source, properties.utm_source, 'youtube'),
      source_id: pickValue(input.source_id, properties.source_id, creatorId),
      medium: pickValue(input.medium, properties.medium, 'creator'),
      campaign: pickValue(input.campaign, properties.campaign, properties.utm_campaign),
      referrer: pickValue(input.referrer, properties.referrer, properties.page_referrer, properties.document_referrer),
      raw_payload: properties,
    })
  }

  if (partnerId) {
    return mapPartnerAcquisitionEnvelope({
      partner_id: partnerId,
      source: pickValue(input.source, properties.source, 'agency'),
      source_id: pickValue(input.source_id, properties.source_id, partnerId),
      medium: pickValue(input.medium, properties.medium, 'partner'),
      campaign: pickValue(input.campaign, properties.campaign, properties.utm_campaign),
      referrer: pickValue(input.referrer, properties.referrer, properties.page_referrer, properties.document_referrer),
      raw_payload: properties,
    })
  }

  return mapPlgAcquisitionEnvelope(input)
}

export function mapPartnerAcquisitionEnvelope(input: {
  partner_id?: string | null
  source?: string | null
  source_id?: string | null
  medium?: string | null
  campaign?: string | null
  referrer?: string | null
  raw_payload?: PlainRecord | null
}) {
  const rawPayload = isPlainObject(input.raw_payload) ? input.raw_payload : {}
  return resolveEnvelope(
    {
      channel: 'partner',
      ...baseFromRawPayload(rawPayload),
      source: pickValue(input.source, rawPayload.source, 'agency'),
      source_id: pickValue(input.source_id, input.partner_id, rawPayload.source_id),
      medium: pickValue(input.medium, rawPayload.medium, 'partner'),
      campaign: pickValue(input.campaign, rawPayload.campaign, rawPayload.utm_campaign),
      referrer: pickValue(input.referrer, rawPayload.referrer),
      partner_id: pickValue(input.partner_id, rawPayload.partner_id, input.source_id),
    },
  )
}

export function mapCreatorAcquisitionEnvelope(input: {
  creator_id?: string | null
  source?: string | null
  source_id?: string | null
  medium?: string | null
  campaign?: string | null
  referrer?: string | null
  raw_payload?: PlainRecord | null
}) {
  const rawPayload = isPlainObject(input.raw_payload) ? input.raw_payload : {}
  return resolveEnvelope(
    {
      channel: 'creator',
      ...baseFromRawPayload(rawPayload),
      source: pickValue(input.source, rawPayload.source, 'youtube'),
      source_id: pickValue(input.source_id, input.creator_id, rawPayload.source_id),
      medium: pickValue(input.medium, rawPayload.medium, 'influencer'),
      campaign: pickValue(input.campaign, rawPayload.campaign, rawPayload.utm_campaign),
      referrer: pickValue(input.referrer, rawPayload.referrer),
      creator_id: pickValue(input.creator_id, rawPayload.creator_id, input.source_id),
    },
  )
}

export function mapReferralAcquisitionEnvelope(input: {
  referral_id?: string | null
  source?: string | null
  source_id?: string | null
  medium?: string | null
  campaign?: string | null
  referrer?: string | null
  raw_payload?: PlainRecord | null
}) {
  const rawPayload = isPlainObject(input.raw_payload) ? input.raw_payload : {}
  return resolveEnvelope(
    {
      channel: 'referral',
      ...baseFromRawPayload(rawPayload),
      source: pickValue(input.source, rawPayload.source, 'customer_referral'),
      source_id: pickValue(input.source_id, input.referral_id, rawPayload.source_id),
      medium: pickValue(input.medium, rawPayload.medium, 'referral'),
      campaign: pickValue(input.campaign, rawPayload.campaign, rawPayload.utm_campaign),
      referrer: pickValue(input.referrer, rawPayload.referrer),
      referral_id: pickValue(input.referral_id, rawPayload.referral_id, input.source_id),
    },
  )
}
