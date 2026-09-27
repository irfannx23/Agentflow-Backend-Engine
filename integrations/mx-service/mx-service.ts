/**
 * MX sidecar service (M4).
 *
 * n8n's Code-node sandbox cannot use Node's `dns` module, so this tiny local
 * HTTP service does the MX lookup and the workflow calls it via an HTTP
 * Request node (host.docker.internal). Keeps the outbound gate logic in the
 * engine while moving the DNS call to a place it can actually run.
 *
 * Endpoints:
 *   GET /health             -> { ok: true }
 *   GET /mx?domain=acme.com -> { domain, hasMx, records, error, cached }
 *
 * Port from MX_SERVICE_PORT (default 9001). Start: `npm run mx:start`.
 */
import { createServer } from 'node:http';
import { checkMx } from './mx-check.js';

const PORT = Number(process.env.MX_SERVICE_PORT || '9001');

const server = createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://localhost:${PORT}`);
  res.setHeader('content-type', 'application/json');

  if (u.pathname === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (u.pathname === '/mx') {
    const domain = (u.searchParams.get('domain') || '').toLowerCase().trim();
    if (!domain) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'domain query param required' }));
      return;
    }
    const result = await checkMx(domain);
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`MX service listening on :${PORT}`);
});
