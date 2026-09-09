import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const metricNames = ['startupEntryBytes', 'startupRequestBytes', 'startupStaticBytes', 'largestChunkBytes', 'settingsRouteBytes', 'settingsStaticChunks', 'knowledgeRouteEntryBytes', 'mailStaticBytes', 'calendarStaticBytes'] as const;
export type BundleMetrics = Record<typeof metricNames[number], number>;

export const BUNDLE_LIMITS: Readonly<BundleMetrics> = Object.freeze({
  startupEntryBytes: 450_000,
  // The small entry can begin API reads while the application shell downloads.
  startupRequestBytes: 200_000,
  // Still count the required dynamic bootstrap and all its static dependencies.
  startupStaticBytes: 600_000,
  largestChunkBytes: 2_100_000,
  settingsRouteBytes: 150_000,
  // Reviewed graph: 81 chunks after deferring section editors and removing the
  // 1,786-chunk icon registry. Keep unopened editors out of the initial load.
  settingsStaticChunks: 120,
  knowledgeRouteEntryBytes: 200_000,
  // Include the shared startup graph to catch eagerly imported editors/previews.
  mailStaticBytes: 900_000,
  calendarStaticBytes: 1_200_000,
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

function staticChunks(assets: string, ...entries: string[]): ReadonlySet<string> {
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visited.has(name)) return;
    visited.add(name);
    const source = ts.createSourceFile(name, fs.readFileSync(path.join(assets, name), 'utf8'), ts.ScriptTarget.Latest);
    for (const statement of source.statements) {
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
        || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const dependency = assetName(new URL(statement.moduleSpecifier.text, `https://build.invalid/assets/${name}`).href);
      if (dependency) visit(dependency);
    }
  };
  entries.forEach(visit);
  return visited;
}

function staticBytes(assets: string, ...entries: string[]): number {
  return [...staticChunks(assets, ...entries)].reduce((total, name) => total + bytes(path.join(assets, name)), 0);
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
  const requestChunks = staticChunks(assets, entry,
    ...[...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/gu)]
      .map((match) => assetName(match[1] ?? ''))
      .filter((name): name is string => Boolean(name)),
  );
  const startupChunks = staticChunks(assets,
    ...requestChunks, checkedMaximum(chunks, 'bootstrap-').name,
  );
  const metrics: BundleMetrics = {
    startupEntryBytes: bytes(path.join(assets, entry)),
    startupRequestBytes: [...requestChunks].reduce((total, name) => total + bytes(path.join(assets, name)), 0),
    startupStaticBytes: [...startupChunks].reduce((total, name) => total + bytes(path.join(assets, name)), 0),
    largestChunkBytes: Math.max(...chunks.map(chunk => chunk.bytes)),
    settingsRouteBytes: checkedMaximum(chunks, 'GlobalSettingsModal-').bytes,
    settingsStaticChunks: staticChunks(assets, checkedMaximum(chunks, 'GlobalSettingsModal-').name).size,
    knowledgeRouteEntryBytes: checkedMaximum(chunks, 'VaultDashboard-').bytes,
    mailStaticBytes: staticBytes(assets, ...startupChunks, checkedMaximum(chunks, 'MailPage-').name),
    calendarStaticBytes: staticBytes(assets, ...startupChunks, checkedMaximum(chunks, 'CalendarPage-').name),
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
