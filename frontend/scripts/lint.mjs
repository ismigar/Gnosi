import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const eslint = fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url));
const batchSize = 128;

function exitStatus(result) {
  if (result.error) console.error(result.error.message);
  if (result.signal) console.error(`ESLint process terminated by ${result.signal}`);
  return result.status ?? 1;
}

function lint() {
  const temporary = mkdtempSync(join(tmpdir(), 'gnosi-eslint-'));
  try {
    // Keep the manifest separate from stdout: project configs may print logs.
    // Discovery's process releases config/plugin state before actual linting.
    const manifest = join(temporary, 'files.json');
    const discovery = spawnSync(process.execPath, [
      fileURLToPath(new URL('./lint-files.mjs', import.meta.url)), manifest,
    ], { cwd, stdio: 'inherit' });
    if (discovery.status !== 0) return exitStatus(discovery);
    const files = JSON.parse(readFileSync(manifest, 'utf8'));
    if (!Array.isArray(files) || files.length === 0 || files.some(file => typeof file !== 'string')) {
      throw new Error('ESLint discovery did not return a nonempty file list');
    }

    // Local pre-PR and CI use the same complete, zero-warning gate. Fresh serial
    // processes bound retained TypeScript/AST state without changing lint rules.
    for (let offset = 0; offset < files.length; offset += batchSize) {
      const args = [eslint, '--max-warnings=0', '--concurrency=off'];
      const cache = process.env.GNOSI_ESLINT_CACHE;
      if (cache) args.push('--cache', '--cache-strategy', 'content', '--cache-location', cache);
      args.push('--', ...files.slice(offset, offset + batchSize));
      console.log(`ESLint batch ${Math.floor(offset / batchSize) + 1}/${Math.ceil(files.length / batchSize)} (${Math.min(batchSize, files.length - offset)} files)`);
      const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
      if (result.status !== 0) return exitStatus(result);
    }
    return 0;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

process.exitCode = lint();
