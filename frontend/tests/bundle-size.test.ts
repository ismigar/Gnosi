// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectBundle } from '../scripts/check-bundle-size';

const roots: string[] = [];

function fixture(sizes: Readonly<Record<string, number>>, base = './'): string {
  const root = mkdtempSync(join(tmpdir(), 'gnosi-bundle-budget-'));
  roots.push(root);
  const assets = join(root, 'assets');
  mkdirSync(assets);
  for (const [name, size] of Object.entries(sizes)) writeFileSync(join(assets, name), Buffer.alloc(size));
  writeFileSync(join(root, 'index.html'), [
    `<script type="module" src="${base}assets/index-A.js"></script>`,
    `<link rel="modulepreload" href="${base}assets/startup-shared-A.js">`,
  ].join('\n'));
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('production bundle budgets', () => {
  const limits = { startupEntryBytes: 100, startupStaticBytes: 150,
    largestChunkBytes: 200, settingsRouteBytes: 60, knowledgeRouteEntryBytes: 80 };
  const valid = { 'index-A.js': 100, 'startup-shared-A.js': 50,
    'GlobalSettingsModal-A.js': 60, 'VaultDashboard-A.js': 80, 'Other-A.js': 200 };

  it.each(['./', '/', '/gnosi/'])('accepts reviewed limits with deployment base %s', base => {
    expect(inspectBundle(fixture(valid, base), limits)).toEqual(limits);
  });

  it('reports the exact growing metric without raising the threshold', () => {
    expect(() => inspectBundle(fixture({ ...valid, 'index-A.js': 101 }), limits))
      .toThrow('startupEntryBytes: 101 > 100');
  });

  it('counts static preload dependencies in the startup budget', () => {
    expect(() => inspectBundle(fixture({ ...valid, 'startup-shared-A.js': 51 }), limits))
      .toThrow('startupStaticBytes: 151 > 150');
  });

  it('keeps the lightweight Knowledge shell separate from deferred editors and dialogs', () => {
    expect(() => inspectBundle(fixture({ ...valid, 'VaultDashboard-A.js': 81 }), limits))
      .toThrow('knowledgeRouteEntryBytes: 81 > 80');
  });
});
