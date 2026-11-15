import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { connect, checkServerIdentity } from 'node:tls';
import { Agent, request } from 'node:https';
import { isPublicAddress, sameAddress } from './public-address.mjs';

export const CALLBACK_ORIGIN = 'https://connectors.api.openai.com';
const MAX_BODY = 128 * 1024;
const HEADER_NAMES = ['content-type', 'webhook-id', 'webhook-timestamp', 'webhook-signature', 'x-mcp-subscription-id'];
export class TransportError extends Error {
  constructor(code) { super(code); this.name = 'TransportError'; this.code = code; }
}
const fail = code => { throw new TransportError(code); };

function destination(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) fail('invalid_destination');
  let url;
  try { url = new URL(value); } catch { fail('invalid_destination'); }
  if (url.origin !== CALLBACK_ORIGIN || url.username || url.password || url.hash ||
      url.hostname !== 'connectors.api.openai.com') fail('invalid_destination');
  return url;
}

function payload(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'body,headers,url') fail('invalid_request');
  const url = destination(value.url);
  if (typeof value.body !== 'string' || Buffer.byteLength(value.body) > MAX_BODY) fail('invalid_body');
  const headers = value.headers;
  if (!headers || Object.keys(headers).sort().join(',') !== [...HEADER_NAMES].sort().join(',')) fail('invalid_headers');
  for (const name of HEADER_NAMES) {
    if (typeof headers[name] !== 'string' || !headers[name].length || headers[name].length > 1024 ||
        /[^\x20-\x7e]/.test(headers[name])) fail('invalid_headers');
  }
  if (headers['content-type'] !== 'application/json') fail('invalid_headers');
  // Copy before any await. Only pre-signed headers cross this boundary, never whsec.
  return { url, body: value.body, headers: { ...headers } };
}

// Dependency injection is for isolated tests, not a runtime configuration surface.
// No listener, HTTP proxy, production binding, or credential is installed here.
export function createCallbackTransport({ resolve = lookup, connectTLS = connect, deadlineMs = 5000 } = {}) {
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 5000) fail('invalid_deadline');

  async function bounded(run) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new TransportError('timeout')); }, deadlineMs);
    });
    try { return await Promise.race([run(controller.signal), deadline]); }
    catch (error) {
      // Never propagate native errors: they can contain callback URLs or headers.
      if (controller.signal.aborted) throw new TransportError('timeout');
      throw error instanceof TransportError ? error : new TransportError('network_error');
    } finally { clearTimeout(timer); }
  }

  async function open(url, signal) {
    const records = await resolve(url.hostname, { all: true, verbatim: true });
    signal.throwIfAborted();
    if (!Array.isArray(records) || !records.length || records.length > 64 || records.some(r =>
      !r || isIP(r.address) !== r.family || !isPublicAddress(r.address))) fail('non_public_destination');
    // All answers must pass. One selected address is dialed literally; no second
    // hostname lookup, cached socket, proxy environment, or implicit retry exists.
    const { address, family } = records.find(r => r.family === 4) ?? records[0];
    return new Promise((accept, reject) => {
      const socket = connectTLS({ host: address, family, port: 443, servername: url.hostname,
        rejectUnauthorized: true, minVersion: 'TLSv1.2', ALPNProtocols: ['http/1.1'], signal,
        checkServerIdentity: (_hostname, cert) => checkServerIdentity(url.hostname, cert),
        lookup: (_hostname, _options, cb) => cb(new TransportError('unexpected_dns_lookup')),
      });
      const failed = () => { socket.destroy(); reject(new TransportError('tls_error')); };
      socket.once('error', failed);
      socket.once('close', () => reject(new TransportError('tls_error')));
      socket.once('secureConnect', () => {
        if (signal.aborted || !socket.authorized || socket.remotePort !== 443 ||
            !sameAddress(address, socket.remoteAddress)) return failed();
        accept({ socket, address });
      });
    });
  }

  return {
    // Read-only probe: DNS + authenticated TLS, no HTTP request or callback data.
    probe: () => bounded(async signal => {
      const { socket, address } = await open(new URL(CALLBACK_ORIGIN), signal);
      try { return { origin: CALLBACK_ORIGIN, address, authorized: socket.authorized, protocol: socket.getProtocol() }; }
      finally { socket.destroy(); }
    }),
    post: value => bounded(async signal => {
      const { url, headers, body } = payload(value);
      const { socket } = await open(url, signal);
      // Hand HTTPS an already authenticated, pinned socket. This fresh agent is
      // used once and cannot fall back to another connection or an environment proxy.
      const agent = new Agent({ keepAlive: false, maxCachedSessions: 0, proxyEnv: {} });
      let used = false;
      agent.createConnection = (_options, callback) => {
        if (used || socket.destroyed || signal.aborted) return callback(new TransportError('connection_unavailable'));
        used = true; callback(null, socket);
      };
      try {
        return await new Promise((accept, reject) => {
          const req = request({ hostname: url.hostname, port: 443, method: 'POST',
            path: url.pathname + url.search, agent, signal, maxHeaderSize: 8192,
            headers: { ...headers, host: url.hostname, 'content-length': Buffer.byteLength(body), connection: 'close' },
          }, res => {
            const status = res.statusCode;
            if (status >= 300 && status < 400) { res.destroy(); reject(new TransportError('redirect_rejected')); return; }
            const chunks = []; let size = 0;
            res.on('data', chunk => {
              size += chunk.length;
              if (size > 4096) { res.destroy(); reject(new TransportError('response_too_large')); }
              else chunks.push(chunk);
            });
            res.once('error', () => reject(new TransportError('response_error')));
            res.once('end', () => accept({ status, body: Buffer.concat(chunks).toString('utf8') }));
          });
          req.once('error', () => reject(new TransportError('request_error')));
          req.end(body);
        });
      } finally { agent.destroy(); socket.destroy(); }
    }),
  };
}
