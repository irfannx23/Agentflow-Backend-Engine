import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ACQUISITION_CHANNELS,
  ACQUISITION_SOURCE_CATALOG,
  mapAttributedCustomerAcquisitionEnvelope,
  mapCreatorAcquisitionEnvelope,
  mapInboundAcquisitionEnvelope,
  mapOutboundAcquisitionEnvelope,
  mapPartnerAcquisitionEnvelope,
  mapLeadAcquisitionEnvelope,
  mapPlgAcquisitionEnvelope,
  mapReferralAcquisitionEnvelope,
  normalizeAcquisitionEnvelope,
  resolveAcquisitionChannelFromSourceType,
} from '../acquisition-foundation.ts'

test('canonical channels are allowlisted', () => {
  assert.deepEqual(ACQUISITION_CHANNELS, ['inbound', 'plg', 'outbound', 'partner', 'creator', 'referral'])
  assert.deepEqual(ACQUISITION_SOURCE_CATALOG.inbound, ['website', 'pricing_form', 'demo_request'])
})

test('normalization trims, lowercases tokens, and nulls empty strings', () => {
  const envelope = normalizeAcquisitionEnvelope({
    channel: '  Inbound ',
    source: '  Pricing Form ',
    source_id: '  source_123  ',
    medium: '  Web Form ',
    campaign: '  Product Launch ',
    referrer: '  https://example.com/path?x=1  ',
    utm_source: '  YouTube ',
    utm_medium: '  Creator  ',
    utm_campaign: '  Q3 Launch ',
    utm_content: '  Hero CTA ',
    utm_term: '  RevOps AI ',
    partner_id: '  ',
    creator_id: null,
    referral_id: '',
  })

  assert.equal(envelope.channel, 'inbound')
  assert.equal(envelope.source, 'pricing_form')
  assert.equal(envelope.source_id, 'source_123')
  assert.equal(envelope.medium, 'web_form')
  assert.equal(envelope.campaign, 'product_launch')
  assert.equal(envelope.referrer, 'https://example.com/path?x=1')
  assert.equal(envelope.utm_source, 'youtube')
  assert.equal(envelope.utm_medium, 'creator')
  assert.equal(envelope.utm_campaign, 'q3_launch')
  assert.equal(envelope.utm_content, 'hero_cta')
  assert.equal(envelope.utm_term, 'revops_ai')
  assert.equal(envelope.partner_id, null)
  assert.equal(envelope.creator_id, null)
  assert.equal(envelope.referral_id, null)
})

test('invalid channel is rejected', () => {
  assert.throws(() => normalizeAcquisitionEnvelope({ channel: 'paid_social' }), /invalid_acquisition_channel/)
})

test('source_type bridge maps outbound scraped leads to outbound channel', () => {
  assert.equal(resolveAcquisitionChannelFromSourceType('outbound_scraped'), 'outbound')

  const envelope = mapLeadAcquisitionEnvelope({
    source_type: 'outbound_scraped',
    domain: 'example.com',
    raw_payload: {
      source: 'scraper',
    },
  })

  assert.equal(envelope.channel, 'outbound')
  assert.equal(envelope.source, 'scraper')
  assert.equal(envelope.source_id, 'example.com')
})

test('source_type bridge defaults non-outbound leads to inbound channel', () => {
  assert.equal(resolveAcquisitionChannelFromSourceType('inbound'), 'inbound')

  const envelope = mapLeadAcquisitionEnvelope({
    source_type: 'inbound',
    event_id: 'evt_bridge_1',
    raw_payload: {
      source: 'website',
    },
  })

  assert.equal(envelope.channel, 'inbound')
  assert.equal(envelope.source, 'website')
  assert.equal(envelope.source_id, 'evt_bridge_1')
})

test('oversized tokens are rejected', () => {
  assert.throws(
    () =>
      normalizeAcquisitionEnvelope({
        channel: 'inbound',
        source: 'a'.repeat(200),
      }),
    /invalid_acquisition_field_length/,
  )
})

test('inbound mapping uses existing payload metadata', () => {
  const envelope = mapInboundAcquisitionEnvelope({
    event_id: 'evt_001',
    raw_payload: {
      source: 'website',
      form: 'pricing_form',
      utm_campaign: 'Launch Q3',
      referrer: 'https://example.com',
    },
  })

  assert.equal(envelope.channel, 'inbound')
  assert.equal(envelope.source, 'website')
  assert.equal(envelope.source_id, 'evt_001')
  assert.equal(envelope.medium, 'pricing_form')
  assert.equal(envelope.campaign, 'launch_q3')
  assert.equal(envelope.referrer, 'https://example.com')
})

test('outbound mapping preserves scraper origin and source ids', () => {
  const envelope = mapOutboundAcquisitionEnvelope({
    email: 'sarah.ops@example.com',
    domain: 'example.com',
    source_url: 'https://company.example.com/team',
    raw_payload: {
      source: 'scraper',
      medium: 'signal_outbound',
      campaign: 'Q3 Signal',
    },
  })

  assert.equal(envelope.channel, 'outbound')
  assert.equal(envelope.source, 'scraper')
  assert.equal(envelope.source_id, 'example.com')
  assert.equal(envelope.medium, 'signal_outbound')
  assert.equal(envelope.campaign, 'q3_signal')
  assert.equal(envelope.referrer, 'https://company.example.com/team')
})

test('plg mapping preserves the Firebase identity boundary', () => {
  const envelope = mapPlgAcquisitionEnvelope({
    firebase_uid: 'firebase-uid-123',
    event_name: 'signup',
    event_source: 'web_app',
    event_properties: {
      source: 'organic_signup',
      utm_source: 'newsletter',
      utm_campaign: 'launch_week',
      referrer: 'https://newsletter.example.com',
    },
  })

  assert.equal(envelope.channel, 'plg')
  assert.equal(envelope.source, 'web_app')
  assert.equal(envelope.source_id, 'firebase-uid-123')
  assert.equal(envelope.medium, 'signup')
  assert.equal(envelope.utm_source, 'newsletter')
  assert.equal(envelope.utm_campaign, 'launch_week')
  assert.equal(envelope.referrer, 'https://newsletter.example.com')
})

test('partner mapping preserves partner metadata', () => {
  const envelope = mapPartnerAcquisitionEnvelope({
    partner_id: 'partner_42',
    raw_payload: {
      source: 'agency',
      campaign: 'partner_launch',
    },
  })

  assert.equal(envelope.channel, 'partner')
  assert.equal(envelope.source, 'agency')
  assert.equal(envelope.partner_id, 'partner_42')
  assert.equal(envelope.source_id, 'partner_42')
  assert.equal(envelope.campaign, 'partner_launch')
})

test('creator mapping preserves creator metadata', () => {
  const envelope = mapCreatorAcquisitionEnvelope({
    creator_id: 'creator_123',
    raw_payload: {
      source: 'youtube',
      medium: 'influencer',
    },
  })

  assert.equal(envelope.channel, 'creator')
  assert.equal(envelope.source, 'youtube')
  assert.equal(envelope.creator_id, 'creator_123')
  assert.equal(envelope.source_id, 'creator_123')
  assert.equal(envelope.medium, 'influencer')
})

test('referral mapping preserves referral metadata', () => {
  const envelope = mapReferralAcquisitionEnvelope({
    referral_id: 'ref_abc',
    raw_payload: {
      source: 'invite',
      medium: 'referral',
    },
  })

  assert.equal(envelope.channel, 'referral')
  assert.equal(envelope.source, 'invite')
  assert.equal(envelope.referral_id, 'ref_abc')
  assert.equal(envelope.source_id, 'ref_abc')
  assert.equal(envelope.medium, 'referral')
})

test('attributed customer mapping prioritizes referral, creator, then partner identifiers', () => {
  const referral = mapAttributedCustomerAcquisitionEnvelope({
    firebase_uid: 'firebase_1',
    event_name: 'signup',
    event_source: 'web_app',
    event_properties: {
      source: 'newsletter',
      referral_id: 'referral_1',
      creator_id: 'creator_1',
      partner_id: 'partner_1',
    },
  })

  const creator = mapAttributedCustomerAcquisitionEnvelope({
    firebase_uid: 'firebase_2',
    event_name: 'signup',
    event_source: 'web_app',
    event_properties: {
      source: 'linkedin',
      creator_id: 'creator_1',
      partner_id: 'partner_1',
    },
  })

  const partner = mapAttributedCustomerAcquisitionEnvelope({
    firebase_uid: 'firebase_3',
    event_name: 'signup',
    event_source: 'web_app',
    event_properties: {
      source: 'agency',
      partner_id: 'partner_1',
    },
  })

  assert.equal(referral.channel, 'referral')
  assert.equal(referral.referral_id, 'referral_1')
  assert.equal(creator.channel, 'creator')
  assert.equal(creator.creator_id, 'creator_1')
  assert.equal(partner.channel, 'partner')
  assert.equal(partner.partner_id, 'partner_1')
})
