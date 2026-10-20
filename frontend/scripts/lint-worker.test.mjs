import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runLintWorker, validateFiles } from './lint-worker.mjs';

const eslint = fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url));
const files = Array.from({ length: 2388 }, (_, index) => `/fixture/source-${index}.tsx`);

async function withEnvironment(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('import is inert and malformed discovery fails before loading or GC', async () => {
  // Isolate the import from node:test's own asynchronous listener installation.
  const imported = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    const argv = process.argv;
    const exitCode = process.exitCode;
    const exceptions = process.listenerCount('uncaughtException');
    const rejections = process.listenerCount('unhandledRejection');
    await import(${JSON.stringify(new URL('./lint-worker.mjs', import.meta.url).href)});
    assert.strictEqual(process.argv, argv);
    assert.equal(process.exitCode, exitCode);
    assert.equal(process.listenerCount('uncaughtException'), exceptions);
    assert.equal(process.listenerCount('unhandledRejection'), rejections);
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(imported.error, undefined);
  assert.equal(imported.signal, null);
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, '');
  const originalArgv = process.argv;
  for (const value of [undefined, null, {}, [], [''], [123], ['file', 'file']]) {
    assert.throws(() => validateFiles(value), /file list/);
    await assert.rejects(runLintWorker(value, {
      load: () => assert.fail('must not load CLI for malformed discovery'),
      gc: () => assert.fail('must not collect before validating discovery'),
    }), /file list/);
  }
  await assert.rejects(runLintWorker(['file'], {
    load: () => assert.fail('must not load CLI without explicit GC'), gc: null,
  }), /--expose-gc/);
  for (const startOffset of [-1, 1, 128, 256, 128.5, 2388, Infinity, '0']) {
    await assert.rejects(runLintWorker(files, {
      startOffset,
      load: () => assert.fail('must not load CLI for malformed worker offsets'),
      gc: () => {},
    }), /start offset/);
  }
  assert.strictEqual(process.argv, originalArgv);
});

test('sticky fatal events after execution or yielding stop the next batch and clean up', async () => {
  for (const fatalAt of ['execute', 'yield']) {
    const originalArgv = process.argv;
    let fatal = false;
    let calls = 0;
    let clears = 0;
    const result = await runLintWorker(files, {
      hasFatalError: () => fatal,
      load: () => ({
        execute: () => { calls += 1; fatal = fatalAt === 'execute'; return 0; },
        clearCaches: () => { clears += 1; },
      }),
      yieldTurn: () => { fatal = true; },
      gc: () => assert.fail('fatal events must stop before further collection or batches'),
      log: () => {},
    });
    assert.equal(result, 2);
    assert.equal(calls, 1);
    assert.equal(clears, 1);
    assert.strictEqual(process.argv, originalArgv);
  }
});

test('cold workers preserve exact CLI coverage, environment and bounded parser lifetimes', async () => {
  for (const singleRun of [undefined, 'true', 'false']) {
    for (const cache of [undefined, '', '/fixture/cache with spaces']) {
      await withEnvironment({
        GNOSI_ESLINT_CACHE: cache,
        TSESTREE_SINGLE_RUN: singleRun,
        NODE_OPTIONS: '--max-old-space-size=1536',
        CI: undefined,
      }, async () => {
        const originalArgv = process.argv;
        const expectedEnv = { ...process.env };
        const seen = [];
        const events = [];
        let active = false;
        let parserState = null;
        let retainedState;
        let workerCalls = 0;
        let loads = 0;
        const options = {
          load: () => {
            loads += 1;
            workerCalls = 0;
            retainedState = {};
            assert.equal(process.argv[1], eslint);
            assert.deepEqual({ ...process.env }, expectedEnv);
            return {
              execute: async (args, text) => {
                assert.equal(active, false);
                if (workerCalls === 0) assert.equal(parserState, null);
                else assert.equal(parserState, retainedState);
                workerCalls += 1;
                assert.ok(workerCalls <= 24);
                active = true;
                parserState = retainedState;
                assert.strictEqual(args, process.argv);
                assert.equal(text, undefined);
                assert.deepEqual({ ...process.env }, expectedEnv);
                seen.push([...args]);
                events.push('execute');
                await Promise.resolve();
                active = false;
                return 0;
              },
              clearCaches: () => {
                assert.equal(active, false);
                assert.notEqual(parserState, null);
                parserState = null;
                events.push('clear');
              },
            };
          },
          yieldTurn: async () => {
            assert.equal(parserState, retainedState);
            events.push('yield');
            await Promise.resolve();
          },
          gc: () => {
            assert.equal(parserState, retainedState);
            assert.equal(events.at(-1), 'yield');
            events.push('gc');
          },
          log: () => {},
        };
        for (let startOffset = 0; startOffset < files.length; startOffset += 384) {
          assert.equal(await runLintWorker(files, { ...options, startOffset }), 0);
          assert.equal(parserState, null);
          assert.strictEqual(process.argv, originalArgv);
        }
        assert.equal(loads, 7);
        assert.equal(seen.length, 150);
        const consumed = [];
        for (let index = 0; index < seen.length; index += 1) {
          const prefix = [process.execPath, eslint, '--max-warnings=0', '--concurrency=off'];
          if (cache) prefix.push('--cache', '--cache-strategy', 'content', '--cache-location', cache);
          prefix.push('--');
          const expectedFiles = files.slice(index * 16, (index + 1) * 16);
          assert.deepEqual(seen[index], [...prefix, ...expectedFiles]);
          consumed.push(...seen[index].slice(prefix.length));
        }
        assert.deepEqual(consumed, files);
        const expectedEvents = [];
        for (let offset = 0; offset < files.length; offset += 384) {
          const batches = Math.min(24, Math.ceil((files.length - offset) / 16));
          expectedEvents.push(...Array.from({ length: batches }, () => ['execute', 'yield', 'gc']).flat(), 'clear');
        }
        assert.deepEqual(events, expectedEvents);
        assert.equal(parserState, null);
        assert.strictEqual(process.argv, originalArgv);
        assert.deepEqual({ ...process.env }, expectedEnv);
      });
    }
  }
});

test('CLI errors and warning exits preserve status and stop before another batch', async () => {
  for (const status of [1, 2, 137]) {
    const originalArgv = process.argv;
    let calls = 0;
    let clears = 0;
    const result = await runLintWorker(files, {
      load: () => ({
        execute: () => { calls += 1; return status; },
        clearCaches: () => { clears += 1; },
      }),
      gc: () => assert.fail('failed CLI batch must stop immediately'),
      log: () => {},
    });
    assert.equal(result, status);
    assert.equal(calls, 1);
    assert.equal(clears, 1);
    assert.strictEqual(process.argv, originalArgv);
  }
});

test('throws and incompatible lifecycle APIs fail closed and restore argv', async () => {
  for (const failure of ['load', 'execute', 'clear', 'yield', 'gc', 'status', 'api']) {
    const originalArgv = process.argv;
    let calls = 0;
    let clears = 0;
    const failAt = stage => { if (failure === stage) throw new Error(`failed ${stage}`); };
    await assert.rejects(runLintWorker(files, {
      load: () => {
        failAt('load');
        return {
          execute: () => {
            calls += 1;
            failAt('execute');
            return failure === 'status' ? undefined : 0;
          },
          clearCaches: failure === 'api' ? undefined : () => { clears += 1; failAt('clear'); },
        };
      },
      yieldTurn: () => failAt('yield'),
      gc: () => failAt('gc'),
      log: () => {},
    }), failure === 'status' ? /invalid exit status/ : failure === 'api' ? /requires CLI execution/ : new RegExp(`failed ${failure}`));
    assert.equal(calls, failure === 'load' || failure === 'api' ? 0 : failure === 'clear' ? 24 : 1);
    assert.equal(clears, failure === 'load' || failure === 'api' ? 0 : 1);
    assert.strictEqual(process.argv, originalArgv);
  }
});
