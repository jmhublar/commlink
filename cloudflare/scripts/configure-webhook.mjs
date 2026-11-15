import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// No dependencies, subprocesses, secret files, or requests to the webhook itself.
// All errors reaching the CLI are fixed text: APIs may echo secret request data.
class ConfigurationError extends Error {}
const fail = message => { throw new ConfigurationError(message); };
const tokenPattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function readConfiguration(env, target) {
  for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_WORKER_NAME',
    'CLOUDFLARE_API_TOKEN', 'GROK_WEBHOOK_URL', 'GROK_SENDER_KEY']) {
    if (!env[name] || env[name] !== env[name].trim()) fail(`${name} is missing or has surrounding whitespace.`);
  }
  if (env.CLOUDFLARE_ACCOUNT_ID !== target.account_id || env.CLOUDFLARE_WORKER_NAME !== target.worker_name ||
    !/^[a-f0-9]{32}$/.test(target.account_id) || !/^[a-z0-9-]+$/.test(target.worker_name)) {
    fail('Cloudflare target does not match the recorded prototype.');
  }
  if (!/^[\x21-\x7e]+$/.test(env.CLOUDFLARE_API_TOKEN) || !/^[\x20-\x7e]+$/.test(env.GROK_SENDER_KEY)) {
    fail('Credentials must be single-line printable values.');
  }
  let url;
  try { url = new URL(env.GROK_WEBHOOK_URL); } catch { fail('GROK_WEBHOOK_URL must be an HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port ||
    /[\s\\]/.test(env.GROK_WEBHOOK_URL) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':') ||
    !url.hostname.includes('.') || /\.(localhost|local|internal)$/.test(url.hostname)) {
    fail('GROK_WEBHOOK_URL must use an external HTTPS hostname without userinfo, fragment or custom port.');
  }
  const bindings = ['GROK_WEBHOOK_URL', 'GROK_SENDER_KEY'].map(name => ({name, type: 'secret_text', text: env[name]}));
  const header = env.GROK_AUTH_HEADER || '', scheme = env.GROK_AUTH_SCHEME || '';
  if (Boolean(header) !== Boolean(scheme)) fail('Set GROK_AUTH_HEADER and GROK_AUTH_SCHEME together, or omit both.');
  if (header) {
    if (!tokenPattern.test(header) || !tokenPattern.test(scheme)) fail('Grok auth header and scheme must be HTTP tokens; use raw for no prefix.');
    bindings.push({name: 'GROK_AUTH_HEADER', type: 'plain_text', text: header},
      {name: 'GROK_AUTH_SCHEME', type: 'plain_text', text: scheme});
  }
  return {
    endpoint: `https://api.cloudflare.com/client/v4/accounts/${target.account_id}/workers/scripts/${target.worker_name}`,
    token: env.CLOUDFLARE_API_TOKEN,
    bindings,
  };
}

export function safeError(error) {
  return error instanceof ConfigurationError ? error.message : 'Webhook configuration failed; sensitive error details suppressed.';
}

export async function configureWebhook(env, target, fetcher = fetch) {
  const config = readConfiguration(env, target);
  let writeStarted = false;
  async function request(path, method = 'GET', body) {
    let response, payload;
    try {
      response = await fetcher(config.endpoint + path, {
        method, body, redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: {Authorization: `Bearer ${config.token}`},
      });
      payload = await response.json();
    } catch {
      fail(writeStarted
        ? 'Cloudflare outcome is uncertain; inspect binding names in the dashboard before rerunning.'
        : 'Cloudflare read failed; no settings were written.');
    }
    if (!response.ok || payload?.success !== true) {
      fail(writeStarted
        ? 'Cloudflare did not confirm the update; inspect the dashboard before rerunning.'
        : 'Cloudflare rejected the read; check the API token permissions and target.');
    }
    return payload.result;
  }
  // Settings/inherited bindings use the latest uploaded version. Do not promote
  // staged code or collapse a gradual deployment as a side effect of configuration.
  async function activeVersion() {
    const deployments = await request('/deployments');
    const versions = await request('/versions?per_page=1');
    const active = deployments?.deployments?.[0]?.versions;
    const latest = versions?.items?.[0]?.id;
    if (!latest || !Array.isArray(active) || active.length !== 1 ||
      active[0].percentage !== 100 || active[0].version_id !== latest) {
      fail('Configuration requires one fully deployed latest version; resolve staged or gradual deployments first.');
    }
    return latest;
  }
  const version = await activeVersion();
  const settings = await request('/settings');
  if (!Array.isArray(settings?.bindings) || !settings.bindings.some(b => b.name === 'MAILBOX' && b.type === 'durable_object_namespace') ||
    settings.bindings.some(b => typeof b.name !== 'string') || new Set(settings.bindings.map(b => b.name)).size !== settings.bindings.length) {
    fail('Existing Worker bindings are not the expected prototype; no update was sent.');
  }
  const replacing = new Set(config.bindings.map(b => b.name));
  const retained = settings.bindings.filter(b => !replacing.has(b.name));
  const bindings = [...retained.map(b => ({name: b.name, type: 'inherit'})), ...config.bindings];
  // Inherit existing bindings by name, including unreadable secrets and DOs.
  // PATCH only bindings; never replay stale deployment.json configuration.
  const form = new FormData();
  form.append('settings', new Blob([JSON.stringify({bindings})], {type: 'application/json'}));
  if (await activeVersion() !== version) fail('Worker changed during configuration; no update was sent.');
  writeStarted = true;
  await request('/settings', 'PATCH', form);
  const after = await request('/settings');
  const expected = [...retained, ...config.bindings];
  if (!Array.isArray(after?.bindings) || expected.some(b => !after.bindings.some(a => a.name === b.name && a.type === b.type &&
    (b.type !== 'plain_text' || a.text === b.text)))) {
    fail('Update was accepted but binding verification failed; inspect the dashboard before rerunning.');
  }
  return 'Webhook secret bindings configured and binding names/types verified. No wake was sent; the Grok adapter still requires implementation.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const target = JSON.parse(await readFile(new URL('../deployment.json', import.meta.url), 'utf8'));
    console.log(await configureWebhook(process.env, target));
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  }
}
