import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const worker = fileURLToPath(new URL('./typecheck-worker.mjs', import.meta.url));

function checkedFile(path, maximum) {
  if (!isAbsolute(path) || realpathSync(path) !== path) throw new Error('Canonical regular cache file required');
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.uid !== process.getuid() || metadata.size > maximum) {
    throw new Error('Owned bounded regular cache file required');
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size) {
      throw new Error('Cache file changed while opening');
    }
    const hash = createHash('sha256');
    const chunks = [];
    const buffer = Buffer.alloc(Math.min(maximum + 1, 1024 * 1024));
    let total = 0;
    for (let count; (count = readSync(descriptor, buffer, 0, buffer.length, null)) !== 0;) {
      total += count;
      if (total > maximum) throw new Error('Cache file exceeds its bound');
      hash.update(buffer.subarray(0, count));
      if (maximum <= 131072) chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const final = fstatSync(descriptor);
    if (total !== metadata.size || final.size !== metadata.size || final.mtimeMs !== opened.mtimeMs
        || final.ctimeMs !== opened.ctimeMs) throw new Error('Cache file changed while reading');
    return { sha256: hash.digest('hex'), text: Buffer.concat(chunks).toString('utf8') };
  } finally {
    closeSync(descriptor);
  }
}

function verifiedTypecheckCache() {
  const path = process.env.GNOSI_TYPECHECK_CACHE;
  const expected = process.env.GNOSI_TYPECHECK_CACHE_SHA256;
  if (path === undefined && expected === undefined) return undefined;
  if (process.argv.length !== 2) throw new Error('Cached verification does not accept compiler arguments');
  if (!path || !/^[a-f0-9]{64}$/.test(expected ?? '')) throw new Error('Complete typecheck cache path/hash pair required');
  const parent = dirname(path);
  const directory = statSync(parent);
  if (!isAbsolute(path) || realpathSync(parent) !== parent || !directory.isDirectory()
      || directory.uid !== process.getuid() || (directory.mode & 0o777) !== 0o700) {
    throw new Error('Private canonical owned typecheck cache directory required');
  }
  const manifestFile = checkedFile(path, 65536);
  if (manifestFile.sha256 !== expected) throw new Error('Typecheck cache manifest hash mismatch');
  const manifest = JSON.parse(manifestFile.text);
  const helper = join(parent, 'verify-typecheck-cache.py');
  const python = resolve(cwd, '../.venv/bin/python');
  if (manifest.schema !== 1 || manifest.status !== 'VERIFIED_WHOLE_FRONTEND_TYPES_CACHE'
      || manifest.project_root !== resolve(cwd) || manifest.helper?.path !== helper
      || !/^[a-f0-9]{64}$/.test(manifest.helper?.sha256 ?? '')
      || manifest.python?.path !== python || manifest.python?.realpath !== realpathSync(python)
      || !/^[a-f0-9]{64}$/.test(manifest.python?.sha256 ?? '')) {
    throw new Error('Exact project, fixed helper and locked Python bindings required');
  }
  if (checkedFile(helper, 131072).sha256 !== manifest.helper.sha256
      || checkedFile(manifest.python.realpath, 67108864).sha256 !== manifest.python.sha256) {
    throw new Error('Typecheck verifier or Python hash mismatch');
  }
  const child = spawnSync(python, ['-B', helper, '--manifest', path, '--manifest-sha256', expected], {
    cwd, stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.signal) return 128 + (osConstants.signals[child.signal] ?? 1);
  if (!Number.isInteger(child.status) || child.status < 0 || child.status > 255) {
    throw new Error('Typecheck cache verifier did not return an exit status');
  }
  if (child.status === 0) console.log('VERIFIED_CACHED_WHOLE_FRONTEND_TYPES');
  return child.status;
}

function typecheck() {
  if (process.argv.length !== 2) throw new Error('This command checks the complete frontend tsconfig.json; use tsc directly for other compiler arguments');
  const temporary = mkdtempSync(join(tmpdir(), 'gnosi-typecheck-'));
  const diagnostics = new Set();
  try {
    const requestPath = join(temporary, 'request.json');
    const resultPath = join(temporary, 'result.json');
    function run(request) {
      writeFileSync(requestPath, JSON.stringify(request));
      rmSync(resultPath, { force: true });
      const child = spawnSync(process.execPath, [worker, requestPath, resultPath], { cwd, stdio: 'inherit' });
      if (child.error || child.signal || child.status !== 0) {
        throw new Error(`TypeScript worker failed: ${child.error?.message ?? child.signal ?? child.status}`);
      }
      const result = JSON.parse(readFileSync(resultPath, 'utf8'));
      if (!Array.isArray(result.diagnostics) || result.diagnostics.some(item => typeof item !== 'string')) {
        throw new Error('TypeScript worker did not return diagnostics');
      }
      if (request.phase !== 'discover' && (result.fingerprint !== request.fingerprint
          || JSON.stringify(result.checked) !== JSON.stringify(request.files))) {
        throw new Error('TypeScript inputs changed or a worker returned incomplete coverage');
      }
      for (const diagnostic of result.diagnostics) diagnostics.add(diagnostic);
      return result;
    }

    const project = run({ phase: 'discover' });
    if (!project.checkTypes) return 1;
    if (!/^[a-f0-9]{64}$/.test(project.fingerprint) || !Array.isArray(project.batches)
        || project.batches.length === 0 || project.batches.some(batch => !Array.isArray(batch)
          || batch.length === 0 || batch.some(file => typeof file !== 'string'))) {
      throw new Error('TypeScript discovery did not return a complete project manifest');
    }
    const files = project.batches.flat();
    if (new Set(files).size !== files.length) throw new Error('Duplicate TypeScript coverage');
    let semanticErrors = false;
    // Each worker loads the SAME complete program. Only diagnostic requests are
    // partitioned; globals, imports and cross-file relationships remain intact.
    for (const phase of ['semantic', ...(project.declarations ? ['declaration'] : [])]) {
      if (phase === 'declaration' && semanticErrors) break;
      for (const [index, batch] of project.batches.entries()) {
        console.log(`TypeScript ${phase} batch ${index + 1}/${project.batches.length} (${batch.length} files)`);
        const result = run({ phase, files: batch, fingerprint: project.fingerprint });
        if (phase === 'semantic' && result.diagnostics.length) semanticErrors = true;
      }
    }
    return diagnostics.size ? 1 : 0;
  } finally {
    for (const diagnostic of [...diagnostics].sort()) process.stdout.write(diagnostic);
    rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  const cached = verifiedTypecheckCache();
  process.exitCode = cached === undefined ? typecheck() : cached;
} catch (error) {
  console.error(`TypeScript verification incomplete: ${error.message}`);
  process.exitCode = 1;
}
