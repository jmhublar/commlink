import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { connect } from 'node:tls';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCallbackTransport, CALLBACK_ORIGIN } from './transport.mjs';
import { isPublicAddress } from './public-address.mjs';

const publicRecord = { address: '104.18.38.184', family: 4 };
const signed = body => ({ url: CALLBACK_ORIGIN + '/synthetic?capability=local-test-only', body,
  headers: { 'content-type': 'application/json', 'webhook-id': 'synthetic-id', 'webhook-timestamp': '1',
    'webhook-signature': 'v1,' + createHmac('sha256', 'synthetic-key').update(`synthetic-id.1.${body}`).digest('base64'),
    'x-mcp-subscription-id': 'synthetic-sub' } });
const rejects = (promise, code) => assert.rejects(promise, e => e.code === code && e.message === code && !e.cause);

test('public destination policy rejects non-public, ambiguous and special-use addresses', () => {
  for (const ip of ['0.1.2.3', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.0.0.9', '192.0.2.1', '192.88.99.2', '192.168.0.1', '198.18.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:104.18.38.184', '64:ff9b::a00:1',
    '100::1', '100:0:0:1::1', '2001::1', '2001:db8::1', '2002:a00:1::1',
    '3fff::1', '5f00::1', 'fc00::1', 'fe80::1', 'ff02::1', 'fe80::1%en0',
    '127.1', '2130706433', '0x7f000001', '1.2.3.999', 'bad', undefined]) {
    assert.equal(isPublicAddress(ip), false, String(ip));
  }
  for (const ip of ['104.18.38.184', '172.64.149.72', '8.8.8.8',
    '2a06:98c1:3103::6812:26b8', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
});

test('request validation fails before DNS and never reflects secrets', async () => {
  let lookups = 0;
  const transport = createCallbackTransport({ resolve: () => { lookups++; throw new Error('must not run'); } });
  for (const url of ['http://connectors.api.openai.com/', 'https://connectors.api.openai.com.evil.example/',
    'https://connectors.api.openai.com:444/', 'https://user:secret@connectors.api.openai.com/',
    'https://connectors.api.openai.com/#secret', 'https://connectors.api.openai.com./',
    'https://104.18.38.184/', 'https://[::1]/', 'https://connectors.api.openai.com\\@evil.example/', 'not a URL']) {
    await rejects(transport.post({ ...signed('{}'), url }), 'invalid_destination');
  }
  await rejects(transport.post({ ...signed('{}'), secret: 'whsec_never-accepted' }), 'invalid_request');
  await rejects(transport.post({ ...signed('{}'), headers: { ...signed('{}').headers, authorization: 'never-forward' } }), 'invalid_headers');
  await rejects(transport.post({ ...signed('{}'), headers: { ...signed('{}').headers, 'webhook-id': 'x\r\nHost: localhost' } }), 'invalid_headers');
  await rejects(transport.post(signed('x'.repeat(128 * 1024 + 1))), 'invalid_body');
  assert.equal(lookups, 0);
});

test('DNS validates every answer and fails closed before opening a socket', async () => {
  let connects = 0;
  for (const records of [[], [publicRecord, { address: '127.0.0.1', family: 4 }],
    [{ address: '::ffff:104.18.38.184', family: 6 }], [{ ...publicRecord, family: 6 }],
    [{ address: '3fff::1', family: 6 }], Array(65).fill(publicRecord), null]) {
    const transport = createCallbackTransport({ resolve: async () => records, connectTLS: () => { connects++; } });
    await rejects(transport.post(signed('{}')), 'non_public_destination');
  }
  assert.equal(connects, 0);
  await rejects(createCallbackTransport({ resolve: async () => { throw new Error('sensitive resolver details'); } }).post(signed('{}')), 'network_error');
});

test('DNS deadline cannot start a late connection', async () => {
  let complete, connects = 0;
  const transport = createCallbackTransport({ deadlineMs: 20,
    resolve: () => new Promise(r => { complete = r; }), connectTLS: () => { connects++; } });
  await rejects(transport.post(signed('{}')), 'timeout');
  complete([publicRecord]);
  await new Promise(r => setImmediate(r));
  assert.equal(connects, 0);
});

test('real TLS and HTTP with a local network shim', { timeout: 20000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'commlink-transport-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  async function certificate(name) {
    const base = join(dir, name);
    await writeFile(base + '.cnf', `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=${name}\n[ext]\nsubjectAltName=DNS:${name}\nbasicConstraints=critical,CA:TRUE\n`);
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-config', base + '.cnf', '-keyout', base + '.key', '-out', base + '.crt'], { stdio: 'ignore' });
    return { key: await readFile(base + '.key'), cert: await readFile(base + '.crt') };
  }
  const credentials = await certificate('connectors.api.openai.com');
  let responder = (_req, res) => res.end('{}');
  const received = [], tlsNames = [];
  const server = createServer(credentials, async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    received.push({ url: req.url, headers: req.headers, body });
    responder(req, res);
  });
  server.on('secureConnection', socket => tlsNames.push(socket.servername));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const optionsSeen = [];
  // Only the tests map the already validated public address to their local TLS
  // fixture. Production has no bypass flag or alternate trust-store option.
  function localTLS(options, overrides = {}) {
    optionsSeen.push(options);
    assert.ok(isPublicAddress(options.host));
    assert.equal(options.port, 443);
    assert.equal(options.servername, 'connectors.api.openai.com');
    assert.equal(options.rejectUnauthorized, true);
    const socket = connect({ ...options, host: '127.0.0.1', family: 4, port: server.address().port, ca: credentials.cert, ...overrides });
    Object.defineProperty(socket, 'remoteAddress', { configurable: true, get: () => options.host });
    Object.defineProperty(socket, 'remotePort', { configurable: true, get: () => 443 });
    return socket;
  }
  const transport = createCallbackTransport({ resolve: async () => [publicRecord], connectTLS: localTLS });

  await t.test('verification and delivery preserve signatures, original Host/SNI and exact body', async () => {
    for (const body of ['{"type":"verification","challenge":"local-nonce"}', '{"eventId":"local-event","data":{"text":"π"}}']) {
      responder = (_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"challenge":"local-nonce"}'); };
      const input = signed(body);
      const result = await transport.post(input);
      assert.equal(result.status, 200);
      assert.equal(received.at(-1).body, body);
      assert.equal(received.at(-1).headers.host, 'connectors.api.openai.com');
      assert.equal(received.at(-1).headers['webhook-signature'], input.headers['webhook-signature']);
      assert.equal(received.at(-1).headers['content-length'], String(Buffer.byteLength(body)));
      assert.equal(tlsNames.at(-1), 'connectors.api.openai.com');
    }
  });

  await t.test('DNS is resolved once per call; rebinding on the next call is rejected', async () => {
    let calls = 0;
    const fresh = createCallbackTransport({ resolve: async (host, opts) => {
      assert.equal(host, 'connectors.api.openai.com'); assert.deepEqual(opts, { all: true, verbatim: true });
      return ++calls === 1 ? [publicRecord] : [{ address: '127.0.0.1', family: 4 }];
    }, connectTLS: localTLS });
    await fresh.post(signed('{}'));
    assert.equal(calls, 1);
    await rejects(fresh.post(signed('{}')), 'non_public_destination');
    assert.equal(calls, 2);
  });

  await t.test('native public IPv6 can be pinned without changing TLS hostname', async () => {
    const v6 = createCallbackTransport({ resolve: async () => [{ address: '2a06:98c1:3103::6812:26b8', family: 6 }], connectTLS: localTLS });
    assert.equal((await v6.post(signed('{}'))).status, 200);
    assert.equal(optionsSeen.at(-1).family, 6);
  });

  await t.test('a connected peer different from the selected IP sends no HTTP', async () => {
    const before = received.length;
    const mismatch = createCallbackTransport({ resolve: async () => [publicRecord], connectTLS: opts => {
      const socket = localTLS(opts);
      Object.defineProperty(socket, 'remoteAddress', { get: () => '127.0.0.1' });
      return socket;
    } });
    await rejects(mismatch.post(signed('{}')), 'tls_error');
    assert.equal(received.length, before);
  });

  await t.test('redirects are rejected without contacting their Location', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const before = received.length;
      responder = (_req, res) => { res.writeHead(status, { location: 'http://127.0.0.1/private?secret=never-follow' }); res.end(); };
      await rejects(transport.post(signed('{}')), 'redirect_rejected');
      assert.equal(received.length, before + 1);
    }
  });

  await t.test('response size and total response time are bounded', async () => {
    responder = (_req, res) => res.end('x'.repeat(4097));
    await rejects(transport.post(signed('{}')), 'response_too_large');
    responder = () => {};
    const slow = createCallbackTransport({ deadlineMs: 150, resolve: async () => [publicRecord], connectTLS: localTLS });
    await rejects(slow.post(signed('{}')), 'timeout');
  });

  await t.test('TLS certificate hostname mismatch and trust failure send no HTTP', async () => {
    const before = received.length;
    const wrong = await certificate('wrong.example');
    server.setSecureContext(wrong);
    const mismatch = createCallbackTransport({ resolve: async () => [publicRecord],
      connectTLS: opts => localTLS(opts, { ca: wrong.cert }) });
    await rejects(mismatch.post(signed('{}')), 'tls_error');
    server.setSecureContext(credentials);
    const untrusted = createCallbackTransport({ resolve: async () => [publicRecord],
      connectTLS: opts => localTLS(opts, { ca: wrong.cert }) });
    await rejects(untrusted.post(signed('{}')), 'tls_error');
    assert.equal(received.length, before);
  });

  await t.test('probe checks pinned TLS without sending any HTTP', async () => {
    const before = received.length;
    const result = await transport.probe();
    assert.equal(result.address, publicRecord.address);
    assert.equal(result.authorized, true);
    assert.equal(result.origin, CALLBACK_ORIGIN);
    assert.equal(received.length, before);
    assert.ok(optionsSeen.length > 0);
  });
});
