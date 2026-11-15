import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const mode = process.argv[2] === 'build' ? 'build' : 'dev';
const distDir = mode === 'build' ? '.next' : '.next-dev';

fs.rmSync(path.resolve(process.cwd(), distDir), { recursive: true, force: true });

const nextBin = require.resolve('next/dist/bin/next');
const nextArgs = mode === 'build' ? ['build'] : ['dev', '-p', '3000'];

const result = spawnSync(process.execPath, [nextBin, ...nextArgs], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(mode === 'build' ? { BROWSERSLIST_IGNORE_OLD_DATA: 'true' } : {}),
  },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 0);
