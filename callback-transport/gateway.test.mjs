import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from './dist/gateway.mjs';
import { generateKeyPair, SignJWT } from '../cloudflare/node_modules/jose/dist/webapi/index.js';

const config = { issuer: 'https://test.cloudflareaccess.com', audience: 'test-gateway-aud', serviceId: 'synthetic.access' };
test('origin JWT boundary and bounded gateway protocol', async t => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const signed = (overrides = {}) => new SignJWT({ type: 'app', sub: '', common_name: config.serviceId, ...overrides })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(config.issuer).setAudience(config.audience)
    .setIssuedAt().setExpirationTime('5m');
  const token = await signed().sign(privateKey);
  const delivered = []; let block;
  const server = createGateway(config, { keys: publicKey, transport: { post: async payload => {
    delivered.push(payload); if (block) await block; return { status: 200, body: '{"challenge":"synthetic"}' };
  } } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (jwt = token, body = '{}', extra = {}) => fetch(url + '/v1/deliver', { method: 'POST',
    headers: { 'content-type': 'application/json', ...(jwt ? { 'cf-access-jwt-assertion': jwt } : {}), ...extra }, body });
  await t.test('health is data-free and does not invoke transport', async () => {
    assert.deepEqual(await (await fetch(url + '/healthz')).json(), { ok: true });
    assert.equal(delivered.length, 0);
  });
  await t.test('missing, forged, expired, wrong-app, wrong-issuer and wrong-service tokens fail closed', async () => {
    for (const jwt of [null, 'forged', await signed().setExpirationTime(1).sign(privateKey),
      await signed().setAudience('other-app').sign(privateKey), await signed().setIssuer('https://other.cloudflareaccess.com').sign(privateKey),
      await signed({ common_name: 'other.access' }).sign(privateKey),
      await signed({ type: 'org' }).sign(privateKey), await signed({ sub: 'human-principal' }).sign(privateKey)]) {
      const response = await post(jwt);
      assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: 'unauthorized' });
    }
    assert.equal((await post(null, '{}', { cookie: `CF_Authorization=${token}`, 'x-authenticated-email': 'owner@example.test' })).status, 401);
    assert.equal(delivered.length, 0);
  });
  await t.test('exact authenticated request passes only its body to the transport', async () => {
    const payload = { url: 'https://connectors.api.openai.com/synthetic', headers: { 'webhook-signature': 'synthetic' }, body: 'exact π bytes' };
    const response = await post(token, JSON.stringify(payload));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 200, body: '{"challenge":"synthetic"}' });
    assert.deepEqual(delivered.at(-1), payload);
    assert.ok(!JSON.stringify(delivered).includes(token));
  });
  await t.test('unknown paths, browser origins, malformed JSON and oversized bodies are rejected', async () => {
    assert.equal((await fetch(url + '/unknown')).status, 404);
    assert.equal((await post(token, '{}', { origin: 'https://evil.example' })).status, 400);
    assert.equal((await post(token, '{')).status, 400);
    const before = delivered.length;
    assert.equal((await post(token, 'x'.repeat(1024 * 1024 + 1))).status, 413);
    assert.equal(delivered.length, before);
  });
  await t.test('only four requests may occupy the gateway concurrently', async () => {
    let release; block = new Promise(r => { release = r; });
    const before = delivered.length;
    const held = Array.from({ length: 4 }, () => post());
    const deadline = Date.now() + 3000;
    while (delivered.length < before + 4 && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    assert.equal(delivered.length, before + 4);
    assert.equal((await post()).status, 429);
    release(); block = undefined;
    for (const response of await Promise.all(held)) assert.equal(response.status, 200);
  });
});
