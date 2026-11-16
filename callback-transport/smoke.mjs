// Bounded container smoke test. Synthetic config only, network disabled by Docker.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const watchdog = setTimeout(() => process.exit(1), 8000);
const child = spawn(process.execPath, ['/app/gateway.mjs'], { env: { ...process.env,
  COMMLINK_GATEWAY_ISSUER: 'https://test.cloudflareaccess.com', COMMLINK_GATEWAY_AUDIENCE: 'synthetic',
  COMMLINK_GATEWAY_SERVICE_ID: 'synthetic.access' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', chunk => { logs += chunk; });
child.stderr.on('data', chunk => { logs += chunk; });
const closed = new Promise(resolve => child.on('close', code => resolve(code)));
try {
  assert.equal(process.getuid(), 1000);
  let health;
  for (let i = 0; i < 40; i++) {
    try { health = await fetch('http://127.0.0.1:8080/healthz'); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(health?.status, 200);
  assert.equal((await readFile(`/proc/${child.pid}/comm`, 'utf8')).trim(), 'commlink-HUB300');
  assert.deepEqual(await health.json(), { ok: true });
  const rejected = await fetch('http://127.0.0.1:8080/v1/deliver', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(rejected.status, 401);
  child.kill('SIGTERM'); assert.equal(await closed, 0);
  assert.deepEqual(JSON.parse(logs), { event: 'gateway_ready', issue: 'HUB-300', port: 8080 });
  console.log('image smoke passed: nonroot, named executable, health, auth rejection, graceful shutdown');
} finally { child.kill('SIGKILL'); clearTimeout(watchdog); }
