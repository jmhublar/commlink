import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({ entryPoints: ['src/callback.ts'], bundle: true, format: 'esm', write: false });
const { callbackPost } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const config = { CALLBACK_TRANSPORT_URL: 'https://gateway.example/v1/deliver',
  CALLBACK_ACCESS_CLIENT_ID: 'synthetic-id', CALLBACK_ACCESS_CLIENT_SECRET: 'synthetic-secret' };
const payload = ['https://connectors.api.openai.com/synthetic-capability', { 'webhook-signature': 'synthetic-signature' }, 'exact π bytes'];

test('Worker callback transport fails closed with no direct-fetch fallback', async t => {
  let calls = [], response;
  t.mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); return response(); });
  await t.test('missing credentials and invalid gateway config cause no network request', async () => {
    for (const key of Object.keys(config)) await assert.rejects(callbackPost({ ...config, [key]: '' }, ...payload));
    for (const url of ['http://gateway.example/v1/deliver', 'https://user@gateway.example/v1/deliver',
      'https://gateway.example/v1/deliver?secret=x', 'https://gateway.example/other',
      'https://127.0.0.1/v1/deliver', 'https://[::1]/v1/deliver'])
      await assert.rejects(callbackPost({ ...config, CALLBACK_TRANSPORT_URL: url }, ...payload));
    assert.equal(calls.length, 0);
  });
  await t.test('credentials authenticate only the gateway and signed payload bytes are preserved', async () => {
    response = () => Response.json({ status: 200, body: '{"challenge":"synthetic"}' });
    assert.equal(await (await callbackPost(config, ...payload)).text(), '{"challenge":"synthetic"}');
    const [url, request] = calls.at(-1);
    assert.equal(url, config.CALLBACK_TRANSPORT_URL);
    assert.equal(request.redirect, 'manual');
    assert.equal(request.headers['CF-Access-Client-Secret'], config.CALLBACK_ACCESS_CLIENT_SECRET);
    assert.deepEqual(JSON.parse(request.body), { url: payload[0], headers: payload[1], body: payload[2] });
    assert.ok(!request.body.includes(config.CALLBACK_ACCESS_CLIENT_SECRET));
  });
  await t.test('gateway errors, redirects and malformed envelopes never fall back', async () => {
    for (const candidate of [() => new Response(null, { status: 302, headers: { Location: 'https://other.example' } }),
      () => new Response('gateway-secret', { status: 503 }), () => new Response('not json'),
      () => Response.json({ status: 302, body: '' }), () => Response.json({ status: 200, body: '', extra: true }),
      () => Response.json({ status: 200, body: null }), () => Response.json({ status: 200, body: 'π'.repeat(2049) }),
      () => new Response('x'.repeat(32769))]) {
      response = candidate; const before = calls.length;
      await assert.rejects(callbackPost(config, ...payload));
      assert.equal(calls.length, before + 1);
      assert.equal(calls.at(-1)[0], config.CALLBACK_TRANSPORT_URL);
    }
  });
  await t.test('callback status is preserved for mailbox retry decisions', async () => {
    for (const status of [204, 410, 503]) {
      response = () => Response.json({ status, body: '' });
      assert.equal((await callbackPost(config, ...payload)).status, status);
    }
  });
});

test('private VPC transport uses only its fixed service binding', async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async()=>assert.fail('global fetch must never be used by VPC mode'));
  let response=()=>Response.json({status:200,body:'synthetic'});
  const binding={fetch:async(...args)=>{calls.push(args);return response();}};
  const env={CALLBACK_TRANSPORT_MODE:'vpc',CALLBACK_GATEWAY:binding};
  await t.test('signed payload uses the fixed internal origin and no Access credentials',async()=>{
    assert.equal(await (await callbackPost(env,...payload)).text(),'synthetic');
    const [url,request]=calls.at(-1);
    assert.equal(url,'http://commlink-callback.commlink.svc.cluster.local:8080/v1/deliver');
    assert.equal(request.redirect,'manual');
    assert.deepEqual(request.headers,{'content-type':'application/json'});
    assert.deepEqual(JSON.parse(request.body),{url:payload[0],headers:payload[1],body:payload[2]});
  });
  await t.test('missing binding, unknown mode and mixed public/private settings fail before egress',async()=>{
    const before=calls.length;
    for(const bad of [{CALLBACK_TRANSPORT_MODE:'vpc'}, {...env,CALLBACK_TRANSPORT_MODE:'other'},
      {...env,CALLBACK_ACCESS_CLIENT_SECRET:'forbidden'}, {...env,CALLBACK_ACCESS_CLIENT_ID:'forbidden'},
      {...env,CALLBACK_TRANSPORT_URL:'https://public.example/v1/deliver'},
      {...config,CALLBACK_GATEWAY:binding}])await assert.rejects(callbackPost(bad,...payload));
    assert.equal(calls.length,before);
  });
  await t.test('binding errors and redirects never retry using global fetch or public credentials',async()=>{
    for(const reply of [()=>{throw new Error('synthetic tunnel unavailable');},
      ()=>new Response(null,{status:302,headers:{Location:'https://public.example'}}),
      ()=>Response.json({status:302,body:''}), ()=>Response.json({status:200,body:'x'.repeat(4097)})]){
      response=reply;const before=calls.length;
      await assert.rejects(callbackPost(env,...payload));assert.equal(calls.length,before+1);
    }
  });
});
