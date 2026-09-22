import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Local pre-PR validation and CI share the same complete, zero-warning lint gate.
const args = [
  fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url)),
  '.',
  '--max-warnings=0',
];
const cache = process.env.GNOSI_ESLINT_CACHE;
if (cache) {
  args.push('--cache', '--cache-strategy', 'content', '--cache-location', cache);
}
const result = spawnSync(process.execPath, args, {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  stdio: 'inherit',
});
if (result.error) {
  console.error(result.error.message);
}
process.exit(result.status ?? 1);
