import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VaultViewBody, type VaultViewBodyProps } from './VaultViewBody';

const network = vi.hoisted(() => {
  const guard = vi.fn(() => Promise.reject(new Error('Unexpected live transport in synthetic fixture')));
  vi.stubGlobal('fetch', guard);
  return guard;
});
vi.mock('../../../shared/api/configuration', () => ({
  fetchConfiguration: () => Promise.resolve({ settings: { date_format: 'iso', currency: 'EUR' } }),
}));
vi.mock('../../../shared/api/plugins', () => ({
  fetchPluginState: () => Promise.resolve({ disabled: [], enabled_builtin: [], settings: {} }),
}));
vi.mock('../../../shared/api/vault-summary', () => ({
  fetchVaultSummarySettings: () => Promise.resolve({ settings: { model: 'synthetic' } }),
}));

const schema = { Status: 'select', Status_config: { options: ['Open', 'Review'] }, Score: 'number', Period: 'period' };
const extension: Record<string, unknown> = { handler: () => 'plugin', file: new Blob(['synthetic']) };
extension.self = extension;
const metadata = { Status: 'Open', Score: 3, Period: { start: '2026-08-10', end: '2026-08-12' }, extension };
const notes = [
  { id: 'alpha', title: 'Mercè', metadata },
  { id: 'beta', title: 42, metadata: { Status: 'Review', Score: 8, Period: '2026-08-14', extension } },
  { id: 'empty', metadata: null },
];
const activeView = { id: 'fixture', groupBy: 'Status', galleryPreview: 'none', dateField: 'Period',
  visibleProperties: ['Status', 'Score'], extension };
const i18n = createInstance();
let root: Root;
let container: HTMLDivElement;
let errors: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await i18n.init({ lng: 'en', resources: {}, initImmediate: false, showSupportNotice: false });
  network.mockClear();
  errors = vi.spyOn(console, 'error');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); await Promise.resolve(); });
  container.remove();
  expect(network).not.toHaveBeenCalled();
  expect(errors).not.toHaveBeenCalled();
});

async function renderBody(props: VaultViewBodyProps) {
  await act(async () => {
    root.render(<I18nextProvider i18n={i18n}><VaultViewBody
      notes={notes} allNotes={notes} schema={schema} activeView={activeView} {...props}
    /></I18nextProvider>);
    await Promise.resolve();
  });
}

describe('actual vault renderer connections', () => {
  it.each(['board', 'gallery', 'timeline', 'feed'])('renders and searches real %s with open metadata and optional actions', async type => {
    await renderBody({ type });
    if (type === 'gallery') {
      act(() => {
        container.querySelectorAll<HTMLButtonElement>('button[title="Expand"]').forEach(button => { button.click(); });
      });
    }
    expect(container.textContent).toContain('Mercè');
    expect(container.textContent).toContain('42');
    expect(notes[0]?.metadata).toBe(metadata);
    expect(metadata.extension).toBe(extension);
    expect(extension.self).toBe(extension);
    await renderBody({ type, searchTerm: 'merce' });
    expect(container.textContent).toContain('Mercè');
    expect(container.textContent).not.toContain('42');
  });

  it('uses the real filter and chart readers for grouped values without projecting metadata', async () => {
    await renderBody({ type: 'chart', activeView: { ...activeView, aggregation: 'sum', chartType: 'bar',
      xField: 'Status', yField: 'Score', filters: [{ field: 'Score', operator: 'greater_than', value: 4 }] } });
    const chartTitles = [...container.querySelectorAll('svg title')].map(node => node.textContent);
    expect(chartTitles).toEqual(['Review: 8']);
    expect(metadata.extension).toBe(extension);
    expect(notes[2]?.metadata).toBeNull();
  });

  it('accepts a view containing only opaque extension keys without chart configuration', async () => {
    await renderBody({ type: 'chart', activeView: { extension } });
    expect(container.textContent).toContain('Configure the chart');
  });
});
