import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createCallbackTransport, TransportError } from './transport.mjs';

const MAX_WIRE_BYTES = 1024 * 1024;
const reply = (res, status, value) => {
  if (!res.destroyed && !res.writableEnded) res.writeHead(status, {
    'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close',
  }).end(JSON.stringify(value));
};

export function createGateway(config, { keys, transport = createCallbackTransport() } = {}) {
  const mode = config.authMode ?? 'access';
  if (!['access', 'vpc-network'].includes(mode)) throw new Error('invalid_gateway_config');
  let issuer;
  if (mode === 'access') {
    try { issuer = new URL(config.issuer); } catch { throw new Error('invalid_gateway_config'); }
    if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.port ||
        issuer.pathname !== '/' || issuer.search || issuer.hash ||
        !issuer.hostname.endsWith('.cloudflareaccess.com') || !config.audience || !config.serviceId)
      throw new Error('invalid_gateway_config');
    keys ??= createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer), { timeoutDuration: 3000 });
  } else if (config.issuer || config.audience || config.serviceId) {
    throw new Error('invalid_gateway_config');
  }
  let active = 0, windowStart = Date.now(), admitted = 0;
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10000,
    keepAliveTimeout: 1, connectionsCheckingInterval: 1000 }, async (req, res) => {
    if (req.url === '/healthz' && req.method === 'GET') return reply(res, 200, { ok: true });
    if (req.url !== '/v1/deliver' || req.method !== 'POST') return reply(res, 404, { error: 'not_found' });
    // Defense against an accidental hostname route, not caller authentication.
    // VPC mode must be deployed only behind the reviewed private NetworkPolicy.
    if (mode === 'vpc-network' && req.headers.host !== 'commlink-callback.commlink.svc.cluster.local:8080')
      return reply(res, 403, { error: 'private_host_required' });
    if (req.headers.origin !== undefined || req.headers['content-type'] !== 'application/json')
      return reply(res, 400, { error: 'invalid_request' });
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); admitted = 0; }
    if (active >= 4 || admitted >= 60) return reply(res, 429, { error: 'rate_limited' });
    active++; admitted++;
    const timer = setTimeout(() => { reply(res, 408, { error: 'request_timeout' }); req.destroy(); }, 10000);
    try {
      // Only a signed assertion minted for this app and its one service identity
      // is accepted. Cookies and client-supplied identity headers are ignored.
      if (mode === 'access') try {
        const raw = req.headers['cf-access-jwt-assertion'];
        if (typeof raw !== 'string') throw new Error('missing');
        const { payload } = await jwtVerify(raw, keys, { issuer: issuer.origin, audience: config.audience,
          algorithms: ['RS256'], requiredClaims: ['exp', 'iat'] });
        if (payload.common_name !== config.serviceId || payload.type !== 'app' || payload.sub !== '')
          throw new Error('wrong_service');
      } catch { return reply(res, 401, { error: 'unauthorized' }); }
      if (res.writableEnded || req.destroyed) return;
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_WIRE_BYTES) { reply(res, 413, { error: 'request_too_large' }); req.destroy(); return; }
        chunks.push(chunk);
      }
      if (res.writableEnded || req.destroyed && !req.complete) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(res, 400, { error: 'invalid_json' }); }
      const result = await transport.post(body);
      reply(res, 200, result);
    } catch (error) {
      const validation = error instanceof TransportError && /^(invalid_|non_public_)/.test(error.code);
      const timeout = error instanceof TransportError && error.code === 'timeout';
      reply(res, validation ? 400 : timeout ? 504 : 502, { error: validation ? 'callback_rejected' : timeout ? 'callback_timeout' : 'callback_failed' });
    } finally { clearTimeout(timer); active--; }
  });
  server.maxConnections = 32;
  server.maxRequestsPerSocket = 1;
  server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  return server;
}

export function main() {
  process.title = 'commlink-HUB300';
  const config = { authMode: process.env.COMMLINK_GATEWAY_AUTH_MODE, issuer: process.env.COMMLINK_GATEWAY_ISSUER, audience: process.env.COMMLINK_GATEWAY_AUDIENCE,
    serviceId: process.env.COMMLINK_GATEWAY_SERVICE_ID };
  const host = process.env.COMMLINK_GATEWAY_HOST ?? '127.0.0.1';
  const port = Number(process.env.COMMLINK_GATEWAY_PORT ?? '8080');
  if (!['127.0.0.1', '0.0.0.0'].includes(host) || port !== 8080) throw new Error('invalid_gateway_listener');
  const server = createGateway(config);
  server.listen(port, host, () => console.log(JSON.stringify({ event: 'gateway_ready', issue: 'HUB-300', port })));
  server.on('error', () => { console.error('gateway_listener_failed'); process.exitCode = 1; });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.close(); server.closeIdleConnections();
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 6000).unref();
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch { console.error('gateway_startup_failed'); process.exitCode = 1; }
}
