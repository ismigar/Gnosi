// @vitest-environment node
import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNativePreview, stageNativeBuild } from '../scripts/native-preview';

// All file operations stay real and local to fixtures. Only process launch and
// injected copy failures are doubled; no Vite process or socket is created.
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(() => { throw new Error('Unexpected real process launch'); }),
}));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, cpSync: vi.fn(actual.cpSync) };
});
const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');
const shutdownSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
let root: string;
let frontendRoot: string;
let buildDirectory: string;
let temporaryRoot: string;
let signals: EventEmitter;

function snapshotFrom(args: readonly string[]): string {
  const snapshot = args[args.indexOf('--outDir') + 1];
  if (!snapshot) throw new Error('Expected a snapshot argument');
  expect(snapshot.startsWith(join(temporaryRoot, 'gnosi-native-build-'))).toBe(true);
  return snapshot;
}

function fakeChild() {
  // Constructing this emitter does not call ChildProcess.spawn.
  const child = new ChildProcess();
  const kill = vi.spyOn(child, 'kill').mockReturnValue(true);
  const launch = vi.fn((_args: string[], _cwd: string) => child);
  return { child, kill, launch };
}

function expectOnlyUnrelatedTemporaryFile() {
  expect(readdirSync(temporaryRoot)).toEqual(['unrelated.txt']);
  expect(readFileSync(join(temporaryRoot, 'unrelated.txt'), 'utf8')).toBe('keep');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gnosi-native-preview-test-'));
  frontendRoot = join(root, 'frontend with spaces');
  buildDirectory = join(frontendRoot, 'dist');
  temporaryRoot = join(root, 'snapshots');
  mkdirSync(join(buildDirectory, 'assets'), { recursive: true });
  mkdirSync(temporaryRoot);
  writeFileSync(join(buildDirectory, 'index.html'), '<script src="/assets/app.js"></script>');
  writeFileSync(join(buildDirectory, 'assets/app.js'), 'original asset');
  writeFileSync(join(temporaryRoot, 'unrelated.txt'), 'keep');
  signals = new EventEmitter();
  vi.mocked(cpSync).mockImplementation(actualFs.cpSync);
  vi.mocked(spawn).mockImplementation(() => { throw new Error('Unexpected real process launch'); });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('native build snapshot', () => {
  it('copies the content of linked assets independently of the original target', () => {
    const target = join(root, 'linked-asset.js');
    writeFileSync(target, 'linked asset');
    symlinkSync(target, join(buildDirectory, 'assets/linked.js'));
    const snapshot = stageNativeBuild(buildDirectory, temporaryRoot);
    writeFileSync(target, 'changed linked asset');
    rmSync(target);
    expect(readFileSync(join(snapshot, 'assets/linked.js'), 'utf8')).toBe('linked asset');
  });

  it('keeps assets independent of later writes and replacement of the source build', () => {
    const snapshot = stageNativeBuild(buildDirectory, temporaryRoot);
    const originalHtml = readFileSync(join(snapshot, 'index.html'), 'utf8');
    expect(readFileSync(join(snapshot, 'assets/app.js'), 'utf8')).toBe('original asset');
    writeFileSync(join(buildDirectory, 'index.html'), 'replacement html');
    writeFileSync(join(buildDirectory, 'assets/app.js'), 'replacement asset');
    expect(readFileSync(join(snapshot, 'index.html'), 'utf8')).toBe(originalHtml);
    expect(readFileSync(join(snapshot, 'assets/app.js'), 'utf8')).toBe('original asset');
    writeFileSync(join(snapshot, 'assets/app.js'), 'snapshot-only edit');
    expect(readFileSync(join(buildDirectory, 'assets/app.js'), 'utf8')).toBe('replacement asset');
    rmSync(buildDirectory, { recursive: true });
    expect(readFileSync(join(snapshot, 'index.html'), 'utf8')).toBe(originalHtml);
    expect(readFileSync(join(snapshot, 'assets/app.js'), 'utf8')).toBe('snapshot-only edit');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects a missing build before creating a snapshot', () => {
    rmSync(join(buildDirectory, 'index.html'));
    expect(() => stageNativeBuild(buildDirectory, temporaryRoot)).toThrow('Build the frontend before starting native preview');
    expectOnlyUnrelatedTemporaryFile();
    expect(cpSync).not.toHaveBeenCalled();
  });

  it('removes its partially copied snapshot and preserves the original error and source', () => {
    const failure = new Error('Synthetic copy failure');
    vi.mocked(cpSync).mockImplementationOnce((_source, destination) => {
      writeFileSync(join(String(destination), 'partial.js'), 'partial');
      throw failure;
    });
    expect(() => stageNativeBuild(buildDirectory, temporaryRoot)).toThrow(failure);
    expectOnlyUnrelatedTemporaryFile();
    expect(readFileSync(join(buildDirectory, 'assets/app.js'), 'utf8')).toBe('original asset');
  });

  it.each(['source', 'snapshot'])('rejects an index changed in the %s during copying and cleans its snapshot', changed => {
    vi.mocked(cpSync).mockImplementationOnce((source, destination, options) => {
      actualFs.cpSync(source, destination, options);
      writeFileSync(join(String(changed === 'source' ? source : destination), 'index.html'), 'changed during copy');
    });
    expect(() => stageNativeBuild(buildDirectory, temporaryRoot)).toThrow('frontend build changed during startup');
    expectOnlyUnrelatedTemporaryFile();
    expect(existsSync(buildDirectory)).toBe(true);
  });
});

describe('native preview lifecycle', () => {
  it('launches the installed Vite through Node with its snapshot and exact argument boundaries', async () => {
    const { child } = fakeChild();
    vi.mocked(spawn).mockReturnValue(child);
    const args = ['--host', '127.0.0.1', '--port=6200', '--base', '/fixture with spaces/'];
    const result = runNativePreview({ frontendRoot, temporaryRoot, signals, args });
    expect(spawn).toHaveBeenCalledTimes(1);
    const argv: unknown = vi.mocked(spawn).mock.calls[0]?.[1];
    if (!Array.isArray(argv)) throw new Error('Expected Node arguments');
    const snapshot = snapshotFrom(argv.map((arg: unknown) => {
      if (typeof arg !== 'string') throw new Error('Expected string argument');
      return arg;
    }));
    expect(spawn).toHaveBeenCalledWith(process.execPath, [
      join(frontendRoot, 'node_modules/vite/bin/vite.js'),
      'preview', '--outDir', snapshot, '--strictPort', ...args,
    ], { cwd: frontendRoot, stdio: 'inherit' });
    expect(existsSync(join(snapshot, 'assets/app.js'))).toBe(true);
    child.emit('exit', 0, null);
    await expect(result).resolves.toBe(0);
    expectOnlyUnrelatedTemporaryFile();
    expect(existsSync(join(buildDirectory, 'index.html'))).toBe(true);
  });

  it.each([
    { args: ['--outDir', '/unowned'] },
    { args: ['--outDir=/unowned'] },
    { args: ['--outDir'] },
  ])('rejects an overridden output directory before reading or launching ($args)', async ({ args }) => {
    const { launch } = fakeChild();
    rmSync(join(buildDirectory, 'index.html'));
    await expect(runNativePreview({ frontendRoot, temporaryRoot, signals, launch, args }))
      .rejects.toThrow('always serves its own snapshot');
    expect(launch).not.toHaveBeenCalled();
    expect(cpSync).not.toHaveBeenCalled();
    expectOnlyUnrelatedTemporaryFile();
  });

  it.each([
    { code: 0, signal: null, expected: 0 },
    { code: 37, signal: null, expected: 37 },
    { code: null, signal: 'SIGTERM', expected: 1 },
    { code: null, signal: null, expected: 0 },
  ])('preserves exit status and cleans up ($code/$signal)', async ({ code, signal, expected }) => {
    const { child, launch } = fakeChild();
    const result = runNativePreview({ frontendRoot, temporaryRoot, signals, launch, args: [] });
    child.emit('exit', code, signal);
    await expect(result).resolves.toBe(expected);
    expectOnlyUnrelatedTemporaryFile();
    for (const shutdown of shutdownSignals) expect(signals.listenerCount(shutdown)).toBe(0);
  });

  it('forwards shutdown, retains the snapshot until exit, and removes only its own signal listeners', async () => {
    const { child, kill, launch } = fakeChild();
    const unrelated = vi.fn();
    for (const signal of shutdownSignals) signals.on(signal, unrelated);
    const result = runNativePreview({ frontendRoot, temporaryRoot, signals, launch, args: [] });
    const snapshot = snapshotFrom(launch.mock.calls[0]?.[0] ?? []);
    for (const signal of shutdownSignals) {
      expect(signals.listenerCount(signal)).toBe(2);
      signals.emit(signal);
    }
    expect(kill.mock.calls).toEqual(shutdownSignals.map(signal => [signal]));
    expect(existsSync(snapshot)).toBe(true);
    child.emit('exit', null, 'SIGTERM');
    await expect(result).resolves.toBe(1);
    for (const signal of shutdownSignals) {
      expect(signals.listeners(signal)).toEqual([unrelated]);
      signals.emit(signal);
    }
    expect(kill).toHaveBeenCalledTimes(3);
    expect(unrelated).toHaveBeenCalledTimes(6);
    expectOnlyUnrelatedTemporaryFile();
  });

  it.each(['launch', 'child'])('propagates a %s error and cleans up without deleting the source build', async boundary => {
    const { child, launch } = fakeChild();
    const failure = new Error('Synthetic preview startup failure');
    if (boundary === 'launch') launch.mockImplementationOnce(() => { throw failure; });
    const result = runNativePreview({ frontendRoot, temporaryRoot, signals, launch, args: [] });
    if (boundary === 'child') child.emit('error', failure);
    await expect(result).rejects.toBe(failure);
    expectOnlyUnrelatedTemporaryFile();
    expect(readFileSync(join(buildDirectory, 'assets/app.js'), 'utf8')).toBe('original asset');
    for (const signal of shutdownSignals) expect(signals.listenerCount(signal)).toBe(0);
  });

  it('owns each snapshot independently while two previews overlap', async () => {
    const first = fakeChild();
    const second = fakeChild();
    const firstResult = runNativePreview({ frontendRoot, temporaryRoot, signals, launch: first.launch, args: [] });
    const secondResult = runNativePreview({ frontendRoot, temporaryRoot, signals, launch: second.launch, args: [] });
    const firstSnapshot = snapshotFrom(first.launch.mock.calls[0]?.[0] ?? []);
    const secondSnapshot = snapshotFrom(second.launch.mock.calls[0]?.[0] ?? []);
    expect(firstSnapshot).not.toBe(secondSnapshot);
    first.child.emit('exit', 0, null);
    await firstResult;
    expect(existsSync(firstSnapshot)).toBe(false);
    expect(existsSync(secondSnapshot)).toBe(true);
    signals.emit('SIGTERM');
    expect(first.kill).not.toHaveBeenCalled();
    expect(second.kill).toHaveBeenCalledWith('SIGTERM');
    second.child.emit('exit', 0, null);
    await secondResult;
    expectOnlyUnrelatedTemporaryFile();
  });
});
