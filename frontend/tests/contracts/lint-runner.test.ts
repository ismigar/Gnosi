// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

const frontend = fileURLToPath(new URL('../../', import.meta.url));
let fixture: string;

function write(name: string, content: string) {
  const target = join(fixture, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function node(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, args, {
    cwd: fixture,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, GNOSI_ESLINT_CACHE: '', ...env },
  });
}

function run(env: NodeJS.ProcessEnv = {}) {
  return node(['scripts/lint.mjs'], env);
}

function eslintPaths(output: string): string[] {
  const results: unknown = JSON.parse(output);
  if (!Array.isArray(results)) throw new Error('Expected ESLint result array');
  return results.map((result: unknown) => {
    if (typeof result !== 'object' || result === null || !('filePath' in result)
      || typeof result.filePath !== 'string') throw new Error('Expected ESLint file path');
    return result.filePath;
  }).sort();
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'gnosi-lint-'));
  mkdirSync(join(fixture, 'scripts'));
  for (const script of ['lint.mjs', 'lint-files.mjs', 'lint-worker.mjs']) {
    cpSync(join(frontend, 'scripts', script), join(fixture, 'scripts', script));
  }
  symlinkSync(join(frontend, 'node_modules'), join(fixture, 'node_modules'), 'dir');
  write('package.json', '{"type":"module"}');
  write('eslint.config.mjs', `export default [
    { ignores: ['scripts/**', 'eslint.config.mjs', 'ignored/**'] },
    { files: ['**/*.{js,jsx,ts,tsx,custom}'], rules: { 'no-debugger': 'error', 'no-console': 'warn' } },
  ];`);
});

afterEach(() => { rmSync(fixture, { recursive: true, force: true }); });

it('discovers the same paths as real ESLint, including extra extensions, dotfiles and literal glob characters', () => {
  for (const name of ['a.js', 'b.mjs', 'c.cjs', 'view.jsx', 'src/a.ts', 'src/b.tsx', 'extra.custom', '.hidden.js', 'space [1].js']) {
    write(name, 'void 0;');
  }
  write('ignored/bad.js', 'this is invalid');
  write('unmatched.txt', 'debugger;');
  // A nested flat config must be honored by discovery and the real lint pass.
  write('nested/eslint.config.mjs', "export default [{ ignores: ['eslint.config.mjs'] }, { files: ['*.special'] }];");
  write('nested/source.special', 'export {};');
  const original = node(['node_modules/eslint/bin/eslint.js', '.', '--format=json']);
  expect(original.status, original.stdout + original.stderr).toBe(0);
  const manifest = join(fixture, 'ignored/discovery.json');
  const discovered = node(['scripts/lint-files.mjs', manifest]);
  expect(discovered.status, discovered.stderr).toBe(0);
  expect(JSON.parse(readFileSync(manifest, 'utf8')) as unknown).toEqual(eslintPaths(original.stdout));
  expect(run().status).toBe(0);
});

// Multiple real CLI passes can exceed Vitest's 5s default on the shared CI host.
it.each(['.eslintcache', 'custom.cache'])('reuses %s across serial batches and repeated runs', cache => {
  write('eslint.config.mjs', `import { appendFileSync } from 'node:fs';
    export default [
      { ignores: ['scripts/**', 'eslint.config.mjs'] },
      { plugins: { fixture: { rules: { count: {
        create: () => ({ Program: () => appendFileSync('rule-count.txt', process.pid + ',') })
      } } } }, rules: { 'fixture/count': 'error' } },
    ];`);
  for (let index = 0; index < 385; index += 1) write(`source/${String(index)}.js`, 'export {};');
  const environment = { GNOSI_ESLINT_CACHE: cache };
  const result = run(environment);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('ESLint batch 1/25 (16 files)');
  expect(result.stdout).toContain('ESLint batch 24/25 (16 files)');
  expect(result.stdout).toContain('ESLint batch 25/25 (1 files)');
  const first = readFileSync(join(fixture, 'rule-count.txt'), 'utf8');
  const processIds = first.split(',').filter(Boolean);
  expect(processIds).toHaveLength(385);
  expect(new Set(processIds).size).toBe(3);
  const counts = [...new Set(processIds)].map(id => processIds.filter(value => value === id).length);
  expect(counts.sort((left, right) => left - right)).toEqual([1, 192, 192]);
  expect(run(environment).status).toBe(0);
  expect(readFileSync(join(fixture, 'rule-count.txt'), 'utf8')).toBe(first);
}, 30_000);

it('allows config diagnostics on stdout without corrupting file discovery', () => {
  write('source.js', 'export {};');
  write('eslint.config.mjs', `console.log('fixture config loaded');
    export default [{ ignores: ['scripts/**', 'eslint.config.mjs'] }];`);
  const original = node(['node_modules/eslint/bin/eslint.js', '.', '--max-warnings=0']);
  expect(original.status).toBe(0);
  const result = run();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('fixture config loaded');
  expect(result.stdout).toContain('ESLint batch 1/1');
});

it.each([
  ['error', 'debugger;', 'no-debugger'],
  ['warning', 'console.log(1);', 'no-console'],
  ['syntax error', 'export const = ;', 'Parsing error'],
])('fails on a %s after an earlier batch succeeds', (_kind, source, message) => {
  for (let index = 0; index < 385; index += 1) write(`source/${String(index).padStart(3, '0')}.js`, 'export {};');
  write('source/999.js', source);
  const result = run();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('ESLint batch 25/25');
  expect(result.stdout).toContain(message);
});

it('executes type-aware rules with the project service across batches', () => {
  write('eslint.config.mjs', `import ts from 'typescript-eslint';
    export default ts.config({ ignores: ['scripts/**', 'eslint.config.mjs'] },
      { files: ['**/*.ts'], extends: [ts.configs.strictTypeChecked],
        languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } });`);
  write('tsconfig.json', '{"compilerOptions":{"target":"ES2022","strict":true},"include":["*.ts"]}');
  for (let index = 0; index < 256; index += 1) write(`safe${String(index).padStart(3, '0')}.ts`, 'export {};');
  write('typed.ts', 'Promise.resolve(1);');
  const result = run();
  expect(result.status, result.stderr).toBe(1);
  expect(result.stdout).toContain('ESLint batch 17/17 (1 files)');
  expect(result.stdout).toContain('@typescript-eslint/no-floating-promises');
  write('typed.ts', 'void Promise.resolve(1);');
  const fixed = run();
  expect(fixed.status, fixed.stderr).toBe(0);
  expect(fixed.stdout).toContain('ESLint batch 17/17 (1 files)');
}, 30_000);

it('invalidates content cache entries across batches and never caches discovery as success', () => {
  for (let index = 0; index < 385; index += 1) write(`source/${String(index).padStart(3, '0')}.js`, 'export {};');
  const environment = { GNOSI_ESLINT_CACHE: join(fixture, 'lint.cache') };
  expect(run(environment).status).toBe(0);
  expect(readFileSync(environment.GNOSI_ESLINT_CACHE, 'utf8')).toContain('000.js');
  expect(run(environment).status).toBe(0);
  write('source/000.js', 'debugger;');
  const result = run(environment);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('no-debugger');
}, 30_000);

it('fails on config errors and empty discovery instead of silently accepting', () => {
  write('eslint.config.mjs', 'throw new Error("fixture config failure");');
  expect(run().status).not.toBe(0);
  write('eslint.config.mjs', "export default [{ ignores: ['**'] }];");
  expect(run().status).not.toBe(0);
});

it('preserves the installed CLI fatal exit status and stops later batches', () => {
  write('eslint.config.mjs', `export default [
    { ignores: ['scripts/**', 'eslint.config.mjs'] },
    { plugins: { fixture: { rules: { fail: {
      create: () => ({ Program: () => { throw new Error('fixture rule failure'); } })
    } } } }, rules: { 'fixture/fail': 'error' } },
  ];`);
  for (let index = 0; index < 385; index += 1) write(`source/${String(index)}.js`, 'export {};');
  const original = node(['node_modules/eslint/bin/eslint.js', '.', '--max-warnings=0']);
  expect(original.status, original.stderr).toBe(2);
  const result = run();
  expect(result.status, result.stderr).toBe(original.status);
  expect(result.stderr).toContain('fixture rule failure');
  expect(result.stdout).not.toContain('ESLint batch 2/25');
  expect(result.stdout).not.toContain('ESLint batch 25/25');
});

it.each([
  ['unhandled rejection', "Promise.reject(new Error('fixture detached failure'));"],
  ['uncaught exception', "throw new Error('fixture detached failure');"],
])('preserves fatal status for a detached %s and stops later batches', (_kind, failure) => {
  write('eslint.config.mjs', `let scheduled = false;
    export default [
      { ignores: ['scripts/**', 'eslint.config.mjs'] },
      { plugins: { fixture: { rules: { fail: {
        create: () => ({ Program: () => {
          if (scheduled) return;
          scheduled = true;
          setImmediate(() => { ${failure} });
        } })
      } } } }, rules: { 'fixture/fail': 'error' } },
    ];`);
  for (let index = 0; index < 385; index += 1) write(`source/${String(index)}.js`, 'export {};');
  const original = node(['node_modules/eslint/bin/eslint.js', '.', '--max-warnings=0']);
  expect(original.status, original.stderr).toBe(2);
  const result = run();
  expect(result.status, result.stderr).toBe(original.status);
  expect(result.stderr).toContain('fixture detached failure');
  expect(result.stdout).not.toContain('ESLint batch 2/25');
  expect(result.stdout).not.toContain('ESLint batch 25/25');
});

it('propagates a lint child signal and does not start later batches', () => {
  write('eslint.config.mjs', `export default [
    { ignores: ['scripts/**', 'eslint.config.mjs'] },
    { plugins: { fixture: { rules: { terminate: {
      create: () => ({ Program: () => process.kill(process.pid, 'SIGTERM') })
    } } } }, rules: { 'fixture/terminate': 'error' } },
  ];`);
  for (let index = 0; index < 385; index += 1) write(`source/${String(index)}.js`, 'export {};');
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('SIGTERM');
  expect(result.stdout).not.toContain('ESLint batch 2/25');
  expect(result.stdout).not.toContain('ESLint batch 25/25');
});
