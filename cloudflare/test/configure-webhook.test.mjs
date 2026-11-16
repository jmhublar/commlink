import test from 'node:test';
import assert from 'node:assert/strict';
import { configureWebhook, safeError } from '../scripts/configure-webhook.mjs';

const target = {account_id: 'a'.repeat(32), worker_name: 'commlink-prototype'};
const env = {
  CLOUDFLARE_ACCOUNT_ID: target.account_id, CLOUDFLARE_WORKER_NAME: target.worker_name,
  CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-token',
  GROK_WEBHOOK_URL: 'https://routine.example.test/private-path?key=synthetic-secret',
  GROK_SENDER_KEY: 'synthetic-sender-key',
};
const initial = [
  {name: 'MAILBOX', type: 'durable_object_namespace', namespace_id: 'existing-namespace'},
  {name: 'ACCESS_ISSUER', type: 'plain_text', text: 'https://existing.cloudflareaccess.com'},
  {name: 'OTHER_SECRET', type: 'secret_text'},
  {name: 'GROK_AUTH_HEADER', type: 'plain_text', text: 'X-Existing-Key'},
  {name: 'GROK_AUTH_SCHEME', type: 'plain_text', text: 'raw'},
];

function api(options = {}) {
  let bindings = structuredClone(initial), reads = 0;
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({url, init});
    assert.ok(url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${target.account_id}/workers/scripts/${target.worker_name}/`));
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
    let result;
    if (url.endsWith('/deployments')) result = {deployments: [{versions: [{version_id: 'live', percentage: options.gradual ? 50 : 100}]}]};
    else if (url.includes('/versions?')) result = {items: [{id: options.staged ? 'staged' : 'live'}]};
    else if (init.method === 'PATCH') {
      const metadata = JSON.parse(await init.body.get('settings').text());
      assert.deepEqual(Object.keys(metadata), ['bindings']);
      assert.ok(!JSON.stringify(metadata).includes(env.CLOUDFLARE_API_TOKEN));
      if (options.throwOnWrite) throw new Error(env.GROK_SENDER_KEY);
      if (options.rejectWrite) return Response.json({success: false, errors: [{message: env.GROK_WEBHOOK_URL}]}, {status: 403});
      bindings = metadata.bindings.map(b => b.type === 'inherit' ? bindings.find(old => old.name === b.name) :
        b.type === 'secret_text' ? {name: b.name, type: b.type} : b);
      result = {};
    } else {
      reads++;
      result = {bindings: options.badVerification && reads > 1 ? [] : bindings};
    }
    return Response.json({success: true, result});
  };
  return {fetcher, calls, bindings: () => bindings};
}

test('settings update preserves unrelated bindings and omitted auth settings, without sending a wake', async () => {
  const fake = api();
  const output = await configureWebhook(env, target, fake.fetcher);
  assert.match(output, /configured/);
  assert.equal(fake.calls.filter(c => c.init.method === 'PATCH').length, 1);
  for (const binding of initial) assert.deepEqual(fake.bindings().find(b => b.name === binding.name), binding);
  const form = fake.calls.find(c => c.init.method === 'PATCH').init.body;
  const metadata = JSON.parse(await form.get('settings').text());
  for (const name of ['GROK_WEBHOOK_URL', 'GROK_SENDER_KEY']) {
    assert.deepEqual(metadata.bindings.find(b => b.name === name), {name, type: 'secret_text', text: env[name]});
    assert.ok(!output.includes(env[name]));
  }
});

test('confirmed auth variables replace existing values together', async () => {
  const fake = api();
  await configureWebhook({...env, GROK_AUTH_HEADER: 'Authorization', GROK_AUTH_SCHEME: 'Bearer'}, target, fake.fetcher);
  assert.deepEqual(fake.bindings().find(b => b.name === 'GROK_AUTH_HEADER'), {name: 'GROK_AUTH_HEADER', type: 'plain_text', text: 'Authorization'});
  assert.equal(fake.bindings().find(b => b.name === 'GROK_AUTH_SCHEME').text, 'Bearer');
});

test('missing, partial, mismatched or malformed configuration fails before any network request', async () => {
  for (const patch of [
    {GROK_SENDER_KEY: ''}, {CLOUDFLARE_API_TOKEN: ''}, {CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32)},
    {CLOUDFLARE_WORKER_NAME: 'production'}, {GROK_AUTH_HEADER: 'Authorization'},
    {GROK_ENABLED: 'true'}, {GROK_WEBHOOK_ORIGIN: 'https://other.example.test'},
    {GROK_AUTH_HEADER: 'Bad Header', GROK_AUTH_SCHEME: 'raw'}, {GROK_SENDER_KEY: 'key\nnext'},
    ...['http://routine.example.test', 'https://127.0.0.1', 'https://[::1]', 'https://user:password@example.test',
      'https://routine.example.test/#secret', 'https://routine.example.test:8443', 'bad-url'].map(GROK_WEBHOOK_URL => ({GROK_WEBHOOK_URL})),
  ]) {
    let calls = 0;
    await assert.rejects(configureWebhook({...env, ...patch}, target, () => { calls++; }));
    assert.equal(calls, 0);
  }
});

test('staged or gradual deployments stop before a settings write', async () => {
  for (const options of [{staged: true}, {gradual: true}]) {
    const fake = api(options);
    await assert.rejects(configureWebhook(env, target, fake.fetcher), /fully deployed latest/);
    assert.equal(fake.calls.filter(c => c.init.method === 'PATCH').length, 0);
  }
});

test('API errors, network errors and post-write verification failures do not expose secrets', async () => {
  for (const options of [{rejectWrite: true}, {throwOnWrite: true}, {badVerification: true}]) {
    const fake = api(options);
    await assert.rejects(configureWebhook(env, target, fake.fetcher), error => {
      const output = safeError(error);
      assert.match(output, /inspect/i);
      for (const name of ['GROK_WEBHOOK_URL', 'GROK_SENDER_KEY', 'CLOUDFLARE_API_TOKEN']) assert.ok(!output.includes(env[name]));
      return true;
    });
  }
  assert.ok(!safeError(new Error(env.GROK_SENDER_KEY)).includes(env.GROK_SENDER_KEY));
});
