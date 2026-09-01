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
  writeFileSync(join(root, 'index.html'), `<script type="module" src="${base}assets/index-A.js"></script>`);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('production bundle budgets', () => {
  const limits = { startupEntryBytes: 100, largestChunkBytes: 200, editorVendorBytes: 80,
    tldrawVendorBytes: 70, settingsRouteBytes: 60 };
  const valid = { 'index-A.js': 100, 'editor-vendor-A.js': 80, 'tldraw-vendor-A.js': 70,
    'GlobalSettingsModal-A.js': 60, 'VaultDashboard-A.js': 200 };

  it.each(['./', '/', '/gnosi/'])('accepts reviewed limits with deployment base %s', base => {
    expect(inspectBundle(fixture(valid, base), limits)).toEqual(limits);
  });

  it('reports the exact growing metric without raising the threshold', () => {
    expect(() => inspectBundle(fixture({ ...valid, 'index-A.js': 101 }), limits))
      .toThrow('startupEntryBytes: 101 > 100');
  });

  it('fails closed if a reviewed lazy chunk disappears or is duplicated', () => {
    const { 'editor-vendor-A.js': _missing, ...withoutEditor } = valid;
    expect(() => inspectBundle(fixture(withoutEditor), limits)).toThrow('Expected exactly one editor-vendor- chunk');
    expect(() => inspectBundle(fixture({ ...valid, 'tldraw-vendor-B.js': 10 }), limits))
      .toThrow('Expected exactly one tldraw-vendor- chunk, found 2');
  });
});
