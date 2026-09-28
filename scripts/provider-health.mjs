/* global fetch, AbortSignal */
import console from 'node:console'
import process from 'node:process'

const environment = process.env

async function check(name, url, init = {}) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) })
    console.log(`${name}|${response.ok ? 'PASS' : 'FAIL'}|HTTP_${response.status}`)
  } catch (error) {
    console.log(`${name}|FAIL|${error instanceof Error && error.name === 'TimeoutError' ? 'TIMEOUT' : 'CONNECTIVITY'}`)
  }
}

const emailableBase = (environment.EMAIL_VERIFY_BASE_URL || '').replace(/\/$/, '')
const geminiBase = (environment.GEMINI_ENDPOINT || '').replace(/\/$/, '')
const hubspotBase = (environment.HUBSPOT_BASE_URL || '').replace(/\/$/, '')
const brevoBase = (environment.BREVO_BASE_URL || '').replace(/\/$/, '')
const supabaseBase = (environment.SUPABASE_URL || '').replace(/\/$/, '')

await check('APOLLO', 'https://api.apollo.io/api/v1/auth/health', {
  headers: { 'x-api-key': environment.ENRICH_API_KEY || '' },
})
await check('EMAILABLE', `${emailableBase}/v1/account?api_key=${encodeURIComponent(environment.EMAIL_VERIFY_API_KEY || '')}`)
await check('GEMINI_MODEL', `${geminiBase}/${encodeURIComponent(environment.GEMINI_MODEL || '')}`, {
  headers: { 'x-goog-api-key': environment.GEMINI_API_KEY || '' },
})
await check('HUBSPOT', `${hubspotBase}/account-info/v3/details`, {
  headers: { Authorization: `Bearer ${environment.HUBSPOT_ACCESS_TOKEN || ''}` },
})
await check('BREVO', `${brevoBase}/v3/account`, {
  headers: { 'api-key': environment.BREVO_API_KEY || '' },
})
await check('SUPABASE', `${supabaseBase}/rest/v1/`, {
  headers: {
    apikey: environment.SUPABASE_SERVICE_ROLE_KEY || '',
    Authorization: `Bearer ${environment.SUPABASE_SERVICE_ROLE_KEY || ''}`,
  },
})
await check('MX', 'http://127.0.0.1:9001/health')
await check('LITELLM', 'http://127.0.0.1:4000/health/liveliness')
await check('BACKEND', 'http://127.0.0.1:4310/health')
await check('N8N', 'http://127.0.0.1:5678/healthz')
console.log('SLACK|UNVERIFIED|NO_NON_SENDING_HEALTH_ENDPOINT')
