import { build } from 'esbuild';
import { resolve } from 'node:path';
await build({ entryPoints: ['../callback-transport/gateway.mjs'], bundle: true, format: 'esm', platform: 'node',
  target: 'node22', nodePaths: [resolve('node_modules')], outfile: '../callback-transport/dist/gateway.mjs' });
