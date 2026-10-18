import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const eslint = fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url));
const batchSize = 128;

export function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.some(file => typeof file !== 'string' || file.length === 0) || new Set(files).size !== files.length) {
    throw new Error('ESLint discovery did not return a nonempty, unique file list');
  }
}

function loadTools() {
  const require = createRequire(import.meta.url);
  // Resolve the public parser through the same dependency context as the config.
  // typescript-eslint.parser is a wrapper without the public clearCaches API.
  const parserRequire = createRequire(require.resolve('typescript-eslint'));
  const parser = parserRequire('@typescript-eslint/parser');
  const cli = require(fileURLToPath(new URL('../node_modules/eslint/lib/cli.js', import.meta.url)));
  if (typeof cli.execute !== 'function' || typeof parser.clearCaches !== 'function') {
    throw new Error('Installed ESLint CLI/parser lifecycle API is incompatible');
  }
  return { execute: cli.execute.bind(cli), clearCaches: parser.clearCaches };
}

export async function runLintWorker(files, {
  startOffset = 0,
  load = loadTools,
  gc = globalThis.gc,
  yieldTurn = setImmediate,
  log = console.log,
  hasFatalError = () => false,
} = {}) {
  validateFiles(files);
  if (!Number.isInteger(startOffset) || startOffset < 0 || startOffset >= files.length || startOffset % 128 !== 0) {
    throw new Error('ESLint worker requires a valid batch-aligned start offset');
  }
  if (typeof gc !== 'function') throw new Error('ESLint worker requires --expose-gc');
  const originalArgv = process.argv;
  const cache = process.env.GNOSI_ESLINT_CACHE;
  let clearCaches;
  try {
    // The parser infers single-run behavior from argv[1] while loading. Preserve
    // the real CLI path before loading either parser or CLI, and for every call.
    process.argv = [process.execPath, eslint];
    const tools = load();
    const execute = tools.execute;
    clearCaches = tools.clearCaches;
    if (typeof execute !== 'function' || typeof clearCaches !== 'function') {
      throw new Error('ESLint worker requires CLI execution and parser cache clearing');
    }
    const endOffset = Math.min(startOffset + 256, files.length);
    for (let offset = startOffset; offset < endOffset; offset += batchSize) {
      if (hasFatalError()) return 2;
      const args = [process.execPath, eslint, '--max-warnings=0', '--concurrency=off'];
      if (cache) args.push('--cache', '--cache-strategy', 'content', '--cache-location', cache);
      args.push('--', ...files.slice(offset, offset + batchSize));
      process.argv = args;
      const batch = Math.floor(offset / batchSize) + 1;
      const total = Math.ceil(files.length / batchSize);
      const started = process.hrtime.bigint();
      log(`ESLint batch ${batch}/${total} (${Math.min(batchSize, files.length - offset)} files)`);
      const status = await execute(process.argv, undefined);
      if (hasFatalError()) return 2;
      if (!Number.isInteger(status) || status < 0 || status > 255) throw new Error('ESLint CLI returned an invalid exit status');
      if (status !== 0) return status;
      // Collect completed CLI frames/results while retaining the parser's
      // normal project service across these serial calls on frozen inputs.
      await yieldTurn();
      if (hasFatalError()) return 2;
      await gc();
      const { rss, heapUsed } = process.memoryUsage();
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      log(`ESLint batch ${batch}/${total} completed; elapsedMs=${elapsedMs.toFixed(2)} rss=${rss} bytes heapUsed=${heapUsed} bytes`);
    }
    return 0;
  } finally {
    try {
      if (typeof clearCaches === 'function') await clearCaches();
    } finally {
      process.argv = originalArgv;
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let hadFatalError = false;
  // Match the installed bin's fatal status, including detached failures that
  // arrive after execute resolves. Keep handlers installed until process exit.
  const onFatalError = error => {
    hadFatalError = true;
    process.exitCode = 2;
    console.error(error);
  };
  process.on('uncaughtException', onFatalError);
  process.on('unhandledRejection', onFatalError);
  try {
    if (!process.argv[2]) throw new Error('A temporary discovery manifest path is required');
    const files = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const offset = process.argv[3];
    if (offset === undefined || !/^(0|[1-9]\d*)$/.test(offset)) throw new Error('A worker start offset is required');
    const status = await runLintWorker(files, { startOffset: Number(offset), hasFatalError: () => hadFatalError });
    process.exitCode = hadFatalError ? 2 : status;
  } catch (error) {
    console.error(error);
    process.exitCode = 2;
  }
}
