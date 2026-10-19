import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));

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

    // Use small serial CLI batches to release transient results sooner, while
    // recycling the parser after 256 files. Cold workers never overlap.
    for (let offset = 0; offset < files.length; offset += 256) {
      const result = spawnSync(process.execPath, [
        '--expose-gc', fileURLToPath(new URL('./lint-worker.mjs', import.meta.url)), manifest, String(offset),
      ], { cwd, stdio: 'inherit' });
      if (result.status !== 0) return exitStatus(result);
    }
    return 0;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

process.exitCode = lint();
