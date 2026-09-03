import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const metricNames = ['startupEntryBytes', 'startupStaticBytes', 'largestChunkBytes', 'settingsRouteBytes'] as const;
export type BundleMetrics = Record<typeof metricNames[number], number>;

export const BUNDLE_LIMITS: Readonly<BundleMetrics> = Object.freeze({
  startupEntryBytes: 450_000,
  startupStaticBytes: 600_000,
  largestChunkBytes: 2_100_000,
  settingsRouteBytes: 600_000,
});

interface Chunk { readonly name: string; readonly bytes: number }

function bytes(filePath: string): number {
  return fs.statSync(filePath).size;
}

function checkedMaximum(chunks: readonly Chunk[], prefix: string): Chunk {
  const matches = chunks.filter(chunk => chunk.name.startsWith(prefix));
  const match = matches[0];
  if (matches.length !== 1 || !match) {
    throw new Error(`Expected exactly one ${prefix} chunk, found ${String(matches.length)}.`);
  }
  return match;
}

function assetName(source: string): string | null {
  const pathname = new URL(source, 'https://build.invalid/').pathname;
  return /\/assets\/([a-zA-Z0-9_.-]+[.]js)$/u.exec(pathname)?.[1] ?? null;
}

export function inspectBundle(dist: string, limits: Readonly<BundleMetrics> = BUNDLE_LIMITS): BundleMetrics {
  const htmlPath = path.join(dist, 'index.html');
  if (!fs.existsSync(htmlPath)) throw new Error(`Missing production entry: ${htmlPath}`);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const moduleSource = /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/u.exec(html)?.[1];
  if (!moduleSource) throw new Error('Production index does not declare its module entry.');
  const entry = assetName(moduleSource);
  if (!entry) throw new Error('Production module entry is outside the built assets directory.');
  const assets = path.join(dist, 'assets');
  const chunks = fs.readdirSync(assets)
    .filter(name => name.endsWith('.js'))
    .map(name => ({ name, bytes: bytes(path.join(assets, name)) }));
  if (chunks.length === 0) throw new Error('Production build contains no JavaScript chunks.');
  const metrics: BundleMetrics = {
    startupEntryBytes: bytes(path.join(assets, entry)),
    startupStaticBytes: [...new Set([
      entry,
      ...[...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/gu)]
        .map((match) => assetName(match[1] ?? ''))
        .filter((name): name is string => Boolean(name)),
    ])].reduce((total, name) => total + bytes(path.join(assets, name)), 0),
    largestChunkBytes: Math.max(...chunks.map(chunk => chunk.bytes)),
    settingsRouteBytes: checkedMaximum(chunks, 'GlobalSettingsModal-').bytes,
  };
  const violations = metricNames
    .filter(name => metrics[name] > limits[name])
    .map(name => `${name}: ${String(metrics[name])} > ${String(limits[name])}`);
  if (violations.length > 0) throw new Error(`Bundle size budget exceeded:\n${violations.join('\n')}`);
  return metrics;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.stdout.write(`${JSON.stringify(inspectBundle(path.join(frontend, 'dist')), null, 2)}\n`);
}
