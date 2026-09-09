import {spawn, type ChildProcess} from 'node:child_process';
import {constants, cpSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const frontendDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

function copyBuild(source: string, destination: string, ancestors = new Set<string>()): void {
  const resolved = realpathSync(source);
  if (ancestors.has(resolved)) throw new Error('The frontend build contains a circular asset link.');
  const visited = new Set([...ancestors, resolved]);
  cpSync(resolved, destination, {
    recursive: true, mode: constants.COPYFILE_FICLONE,
    filter: (path, target) => {
      if (!lstatSync(path).isSymbolicLink()) return true;
      // Resolve the source explicitly: macOS copyfile can preserve a link even
      // when cpSync's dereference option selected the target's file metadata.
      copyBuild(realpathSync(path), target, visited);
      return false;
    },
  });
}

/** Keep a running app independent of later builds replacing dist. */
export function stageNativeBuild(buildDirectory: string, temporaryRoot = tmpdir()): string {
  let original: Buffer;
  try {
    original = readFileSync(join(buildDirectory, 'index.html'));
  } catch {
    throw new Error('Build the frontend before starting native preview (pnpm --dir frontend run build).');
  }
  const snapshot = mkdtempSync(join(temporaryRoot, 'gnosi-native-build-'));
  try {
    copyBuild(buildDirectory, snapshot);
    if (!original.equals(readFileSync(join(buildDirectory, 'index.html')))
        || !original.equals(readFileSync(join(snapshot, 'index.html')))) {
      throw new Error('The frontend build changed during startup; finish the build and restart.');
    }
    return snapshot;
  } catch (error) {
    rmSync(snapshot, {recursive: true, force: true});
    throw error;
  }
}

interface SignalTarget {
  on(event: string, callback: () => void): unknown;
  removeListener(event: string, callback: () => void): unknown;
}

interface PreviewOptions {
  frontendRoot?: string;
  temporaryRoot?: string;
  args?: string[];
  launch?: (args: string[], cwd: string) => ChildProcess;
  signals?: SignalTarget;
}

/** Forward shutdown and remove only the immutable snapshot owned by this run. */
export async function runNativePreview(options: PreviewOptions = {}): Promise<number> {
  const args = options.args ?? process.argv.slice(2);
  if (args.some(arg => arg === '--outDir' || arg.startsWith('--outDir='))) {
    throw new Error('Native preview always serves its own snapshot of frontend/dist.');
  }
  const root = options.frontendRoot ?? frontendDirectory;
  const snapshot = stageNativeBuild(join(root, 'dist'), options.temporaryRoot);
  const signals = options.signals ?? process;
  const handlers = new Map<NodeJS.Signals, () => void>();
  const launch = options.launch ?? ((argv: string[], cwd: string) =>
    spawn(process.execPath, argv, {cwd, stdio: 'inherit'}));
  try {
    const child = launch([
      join(root, 'node_modules/vite/bin/vite.js'),
      'preview', '--outDir', snapshot, '--strictPort', ...args,
    ], root);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      const forward = () => { child.kill(signal); };
      handlers.set(signal, forward);
      signals.on(signal, forward);
    }
    return await new Promise<number>((fulfilled, rejected) => {
      child.once('error', rejected);
      child.once('exit', (code, signal) => { fulfilled(code ?? (signal ? 1 : 0)); });
    });
  } finally {
    for (const [signal, callback] of handlers) signals.removeListener(signal, callback);
    rmSync(snapshot, {recursive: true, force: true});
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runNativePreview().then(code => { process.exitCode = code; }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Native frontend startup failed.');
    process.exitCode = 1;
  });
}
