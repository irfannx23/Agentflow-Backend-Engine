/**
 * MX / domain-health check (M4). Confirms a company domain has a live mail
 * exchange before the outbound gate lets an AI outreach email be sent.
 *
 * Conservative by design: a domain with NO resolvable MX record is treated as
 * NOT deliverable (no mail server = emails would bounce), per ERRORS.md.
 *
 * Results are cached per domain (TTL 1h) so the engine doesn't re-query DNS
 * for every lead from the same company.
 */
import { promises as dns } from 'node:dns';

const TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { hasMx: boolean; at: number }>();
let resolveMxImpl: typeof dns.resolveMx = dns.resolveMx;

export interface MxResult {
  domain: string;
  hasMx: boolean;
  records: string[];
  error: string | null;
  cached: boolean;
}

export async function checkMx(domain: string): Promise<MxResult> {
  const d = (domain || '').toLowerCase().trim().replace(/^www\./, '');
  const hit = cache.get(d);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { domain: d, hasMx: hit.hasMx, records: [], error: null, cached: true };
  }
  try {
    const records = await resolveMxImpl(d);
    const hasMx = records.length > 0;
    cache.set(d, { hasMx, at: Date.now() });
    return {
      domain: d,
      hasMx,
      records: records.map((r) => `${r.priority} ${r.exchange}`),
      error: null,
      cached: false,
    };
  } catch (e: any) {
    // ENODATA / ENOTFOUND / EAI_AGAIN -> no usable MX -> treat as not deliverable
    cache.set(d, { hasMx: false, at: Date.now() });
    return { domain: d, hasMx: false, records: [], error: e.code ?? String(e), cached: false };
  }
}

/** Clear the cache (useful for tests). */
export function clearMxCache(): void {
  cache.clear();
}

/** Override the MX resolver in tests. */
export function setMxResolver(
  resolver: typeof dns.resolveMx,
): void {
  resolveMxImpl = resolver;
}
