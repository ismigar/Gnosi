// @vitest-environment node
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

const frontend = fileURLToPath(new URL('../../', import.meta.url));
const options = { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
  lib: ['ES2022'], types: [], strict: true, skipLibCheck: true };
let fixture: string;

function write(name: string, content: string) {
  const target = join(fixture, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function config(compilerOptions: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  write('tsconfig.json', JSON.stringify({ compilerOptions: { ...options, ...compilerOptions }, include: ['src/**/*.ts'], ...extra }));
}

function node(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, args, { cwd: fixture, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, ...env } });
}

function run(env: NodeJS.ProcessEnv = {}) {
  return node(['scripts/typecheck.mjs'], env);
}

function diagnosticLines(result: SpawnSyncReturns<string>) {
  return result.stdout.split('\n').filter(line => /error TS\d+:/.test(line)).sort();
}

function compare(passes: boolean) {
  const original = node(['node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false']);
  const result = run();
  if (passes) expect(original.status, original.stdout + original.stderr).toBe(0);
  else expect(original.status, original.stdout + original.stderr).toBeGreaterThan(0);
  expect(result.status, result.stdout + result.stderr).toBe(passes ? 0 : 1);
  expect(diagnosticLines(result)).toEqual(diagnosticLines(original));
  if (!passes) expect(diagnosticLines(result).length).toBeGreaterThan(0);
  return result;
}

function manyFiles() {
  for (let index = 0; index < 257; index += 1) write(`src/${String(index).padStart(3, '0')}.ts`, 'export {};');
}

function hook(body: string) {
  write('hook.mjs', `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
    if (process.argv[1]?.endsWith('typecheck-worker.mjs')) {
      const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
      appendFileSync('workers.log', process.pid + ' ' + request.phase + '\\n');
      ${body}
    }`);
  return { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(join(fixture, 'hook.mjs')).href}` };
}

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'gnosi-typecheck-test-'));
  mkdirSync(join(fixture, 'scripts'));
  for (const script of ['typecheck.mjs', 'typecheck-worker.mjs']) {
    cpSync(join(frontend, 'scripts', script), join(fixture, 'scripts', script));
  }
  // Malformed options may enable ambient type discovery. Keep the project
  // synthetic instead of loading unrelated React declarations from the app.
  mkdirSync(join(fixture, 'node_modules'));
  symlinkSync(join(frontend, 'node_modules/typescript'), join(fixture, 'node_modules/typescript'), 'dir');
  write('package.json', '{"type":"module"}');
  config();
});

afterEach(() => { rmSync(fixture, { recursive: true, force: true }); });

it('preserves extended configs, paths, global augmentation and imported files without emitting code', () => {
  write('base.json', JSON.stringify({ compilerOptions: { ...options, baseUrl: '.', paths: { '@/*': ['outside/*'] }, resolveJsonModule: true } }));
  write('tsconfig.json', JSON.stringify({ extends: './base.json', include: ['src/**/*.ts'] }));
  write('src/globals.d.ts', 'interface Shared { id: string }');
  write('outside/dependency.ts', 'export const id = "valid"; declare global { interface Shared { label: string } }');
  write('outside/data.json', '{"label":"valid"}');
  write('src/main.ts', 'import { id } from "@/dependency"; import data from "@/data.json"; const value: Shared = { id, label: data.label }; export { value };');
  compare(true);
  expect(existsSync(join(fixture, 'src/main.js'))).toBe(false);
});

it('collects all semantic errors across batches, including incompatible global declarations', () => {
  manyFiles();
  write('src/000.ts', 'interface Shared { value: string } const early: number = "bad";');
  write('src/999.ts', 'interface Shared { value: number } const late: string = 42;');
  const result = compare(false);
  expect(diagnosticLines(result)).toHaveLength(3);
  expect(result.stdout).toContain('TypeScript semantic batch 2/2');
});

it('checks transitive imports outside the configured include and exclude patterns', () => {
  config({}, { exclude: ['outside'] });
  write('src/main.ts', 'export { bad } from "../outside/dependency";');
  write('outside/dependency.ts', 'export const bad: number = "wrong";');
  compare(false);
});

it('checks declarations according to skipLibCheck rather than dropping declaration files', () => {
  write('src/globals.d.ts', 'declare const invalid: MissingType;');
  config({ skipLibCheck: false });
  compare(false);
  config({ skipLibCheck: true });
  compare(true);
});

it.each([
  ['config', {}, { extends: './missing.json' }, 'const wrong: number = "bad";'],
  ['options', { module: 'CommonJS' }, {}, 'export {};'],
  ['syntax', {}, {}, 'const = ;'],
  ['globals', { noLib: true, lib: undefined }, {}, 'export {};'],
  ['empty project', {}, { include: ['absent/**/*.ts'] }, 'export {};'],
])('preserves tsc %s diagnostics and stage ordering', (_kind, compilerOptions, extra, source) => {
  config(compilerOptions, extra);
  write('src/main.ts', source);
  write('src/other.ts', 'const other: number = "bad";');
  compare(false);
});

// Allow for three real compiler/runner invocations on the shared CI host.
it('preserves declaration diagnostics with noEmit and never creates declarations or build info', () => {
  config({ declaration: true, incremental: true, tsBuildInfoFile: 'build.tsbuildinfo' });
  write('src/main.ts', 'export const value = new class { private hidden = 1; }();');
  // The original CLI may write build info even under noEmit; the runner must not.
  compare(false);
  rmSync(join(fixture, 'build.tsbuildinfo'), { force: true });
  expect(run().status).toBe(1);
  expect(existsSync(join(fixture, 'build.tsbuildinfo'))).toBe(false);
  expect(existsSync(join(fixture, 'src/main.d.ts'))).toBe(false);
}, 30_000);

it.each([
  ['root array', 'tsconfig.json', '{"compilerOptions":['],
  ['root object', 'tsconfig.json', '{"compilerOptions":{"types":[]},"include":["src/**/*.ts"]'],
  ['extended config', 'base.json', '{"compilerOptions":{"types":[]'],
])('reports malformed %s JSON together with applicable source diagnostics', (_kind, path, text) => {
  config({}, { extends: './base.json' });
  write('base.json', '{}');
  write(path, text);
  write('src/main.ts', 'export const wrong: number = "bad";');
  write('node_modules/@types/fixture/index.d.ts', 'declare const ambient: MissingAmbientType;');
  const result = compare(false);
  expect(result.stdout).toContain('error TS1005:');
  expect(result.stdout).toContain('error TS2322:');
  if (_kind === 'root array') {
    expect(result.stdout).toContain("error TS2304: Cannot find name 'MissingAmbientType'.");
  }
});

it('reports invalid project references', () => {
  config({}, { references: [{ path: './referenced' }] });
  write('referenced/tsconfig.json', '{"compilerOptions":{"types":[]},"files":["library.ts"]}');
  write('referenced/library.ts', 'export const value = 1;');
  write('src/main.ts', 'export {};');
  compare(false);
});

it('uses a fresh process for every batch and checks all files before accepting', () => {
  manyFiles();
  const result = run(hook(''));
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const workers = readFileSync(join(fixture, 'workers.log'), 'utf8').trim().split('\n');
  expect(workers.map(line => line.split(' ')[1])).toEqual(['discover', 'semantic', 'semantic']);
  expect(new Set(workers.map(line => line.split(' ')[0])).size).toBe(3);
});

it.each([
  ['signal', 'process.kill(process.pid, "SIGTERM");'],
  ['nonzero exit', 'process.exit(7);'],
  ['missing result', 'process.exit(0);'],
])('fails closed on a later worker %s', (_kind, action) => {
  manyFiles();
  const result = run(hook(`if (request.phase === 'semantic' && request.files.some(file => file.endsWith('/256.ts'))) { ${action} }`));
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('TypeScript semantic batch 2/2');
  expect(result.stderr).toContain('TypeScript verification incomplete');
});

it.each([
  ['source', 'writeFileSync("src/main.ts", "export const bad: number = \\"bad\\";");'],
  ['extended config', 'writeFileSync("base.json", "{\\"compilerOptions\\":{\\"strict\\":false}}");'],
  ['package manifest', 'writeFileSync("package.json", "{\\"type\\":\\"commonjs\\"}");'],
])('rejects %s changes between workers', (_kind, mutation) => {
  write('base.json', '{"compilerOptions":{"strict":true}}');
  config({ module: 'NodeNext', moduleResolution: 'NodeNext' }, { extends: './base.json' });
  write('src/main.ts', 'await Promise.resolve(); export {};');
  const result = run(hook(`if (request.phase === 'semantic') { ${mutation} }`));
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('inputs changed');
});

it('rejects extra CLI options instead of silently accepting a partial check', () => {
  write('src/main.ts', 'export {};');
  const result = node(['scripts/typecheck.mjs', '--noCheck']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('complete frontend tsconfig.json');
});
