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
  const limits = { startupEntryBytes: 100, startupRequestBytes: 150, startupStaticBytes: 160,
    largestChunkBytes: 200, settingsRouteBytes: 60, settingsStaticChunks: 1, knowledgeRouteEntryBytes: 80,
    mailStaticBytes: 250, calendarStaticBytes: 280 };
  const valid = { 'index-A.js': 100, 'startup-shared-A.js': 50, 'bootstrap-A.js': 10,
    'GlobalSettingsModal-A.js': 60, 'VaultDashboard-A.js': 80, 'Other-A.js': 200,
    'MailPage-A.js': 90, 'CalendarPage-A.js': 120 };

  it.each(['./', '/', '/gnosi/'])('accepts reviewed limits with deployment base %s', base => {
    expect(inspectBundle(fixture(valid, base), limits)).toEqual(limits);
  });

  it('reports the exact growing metric without raising the threshold', () => {
    expect(() => inspectBundle(fixture({ ...valid, 'index-A.js': 101 }), limits))
      .toThrow('startupEntryBytes: 101 > 100');
  });

  it('counts static preload dependencies in the startup budget', () => {
    expect(() => inspectBundle(fixture({ ...valid, 'startup-shared-A.js': 51 }), limits))
      .toThrow('startupStaticBytes: 161 > 160');
  });

  it('keeps required bootstrap code in the budget even though it loads concurrently', () => {
    expect(() => inspectBundle(fixture({ ...valid, 'bootstrap-A.js': 11 }), limits))
      .toThrow('startupStaticBytes: 161 > 160');
  });

  it('counts transitive bootstrap dependencies once without counting optional screens', () => {
    const root = fixture(valid);
    const source = 'import "./startup-shared-A.js"; export * from "./Other-A.js"; import("./CalendarPage-A.js");';
    writeFileSync(join(root, 'assets/bootstrap-A.js'), source);
    const expected = 100 + 50 + source.length + 200;
    const fullLimits = { ...limits, startupStaticBytes: expected,
      mailStaticBytes: expected + 90, calendarStaticBytes: expected + 120 };
    expect(inspectBundle(root, fullLimits).startupStaticBytes).toBe(expected);
    expect(() => inspectBundle(root, { ...fullLimits, startupStaticBytes: expected - 1 }))
      .toThrow(`startupStaticBytes: ${String(expected)} > ${String(expected - 1)}`);
  });

  it('keeps the lightweight Knowledge shell separate from deferred editors and dialogs', () => {
    expect(() => inspectBundle(fixture({ ...valid, 'VaultDashboard-A.js': 81 }), limits))
      .toThrow('knowledgeRouteEntryBytes: 81 > 80');
  });

  it('counts transitive static settings imports once and leaves deferred imports lazy', () => {
    const root = fixture(valid);
    writeFileSync(join(root, 'assets/GlobalSettingsModal-A.js'), 'import "./Other-A.js"; import("./index-A.js");');
    writeFileSync(join(root, 'assets/Other-A.js'), 'export * from "./startup-shared-A.js"; import "./GlobalSettingsModal-A.js";');
    expect(() => inspectBundle(root, { ...limits, settingsStaticChunks: 2 }))
      .toThrow('settingsStaticChunks: 3 > 2');
    expect(inspectBundle(root, { ...limits, settingsStaticChunks: 3 }).settingsStaticChunks).toBe(3);
  });

  it.each(['MailPage', 'CalendarPage'])('rejects a heavy editor made eager through the %s dependency graph', entry => {
    const root = fixture(valid);
    const entrySource = 'import "./startup-shared-A.js"; import("./Other-A.js");';
    writeFileSync(join(root, `assets/${entry}-A.js`), entrySource);
    writeFileSync(join(root, 'assets/startup-shared-A.js'), `export * from "./${entry}-A.js";`);
    const metric = entry === 'MailPage' ? 'mailStaticBytes' : 'calendarStaticBytes';
    const routeLimits = { ...limits, startupStaticBytes: 600, startupRequestBytes: 600,
      mailStaticBytes: 600, calendarStaticBytes: 600 };
    const reviewed = inspectBundle(root, routeLimits)[metric];
    const sharedSource = `export * from "./${entry}-A.js"; import "./Other-A.js";`;
    writeFileSync(join(root, 'assets/startup-shared-A.js'), sharedSource);
    expect(() => inspectBundle(root, { ...routeLimits, [metric]: reviewed }))
      .toThrow(`${metric}: ${String(110 + entrySource.length + sharedSource.length + 200)} > ${String(reviewed)}`);
    expect(reviewed).toBe(110 + entrySource.length + `export * from "./${entry}-A.js";`.length);
  });
});
