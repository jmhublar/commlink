import { createCallbackTransport } from './transport.mjs';

// Intentionally accepts no URL, headers, credentials, body or environment config.
if (process.argv.length !== 2) throw new Error('This probe accepts no arguments');
try { console.log(JSON.stringify(await createCallbackTransport().probe())); }
catch (error) { console.error(JSON.stringify({ error: error.code ?? 'probe_failed' })); process.exitCode = 1; }
