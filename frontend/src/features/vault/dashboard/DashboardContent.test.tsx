import { emitCancelableAppEvent } from '../../../shared/platform/app-events';
import { resetBrowserTestStorage } from '../../../../tests/browser-storage';
import { act, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBrainTableStatus } from '../../../shared/api/brain';
import { fetchReferenceTable } from '../../../shared/api/literature-resources';
import { fetchVaultPage } from '../../../shared/api/vaults';
import { DashboardContent } from './DashboardContent';
import type { DashboardController } from './useDashboardController';
import { renderController } from './__tests__/controller-support';
import { installApiDefaults, PAGE_ID, OTHER_ID } from './test-support';
import { VaultGallery } from '../views/VaultGallery';
import type { GalleryNote } from '../views/vault-gallery/vaultGalleryModel';

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock('../../../shared/api/vaults');
vi.mock('../../../shared/api/vault-views');
vi.mock('../../../shared/api/brain');
vi.mock('../../../shared/api/literature-resources');
vi.mock('../../../shared/api/resource-processing');
vi.mock('../navigation/VaultDocumentTabs', () => ({ VaultDocumentTabs: () => <button data-tab-strip>Tabs</button> }));
vi.mock('../../../shared/i18n/useLocaleSettings', () => ({ useLocaleSettings: () => ({ currencyCode: 'EUR', dateFormat: 'locale', dateLocale: 'en-US', decimalSymbol: '.', numberLocale: 'en-US' }) }));
vi.mock('../../../shared/editor/useTitlePreview', () => ({ useTitlePreview: () => ({ getTitleProps: () => ({}), openForKeyboard: vi.fn(), preview: null }) }));
vi.mock('../views/GalleryCardPreview', () => ({
  GalleryOpenButton: () => null,
  GalleryContentPreview: ({ note }: { note: GalleryNote }) => <a href="#citation" data-citation={note.id} onClick={event => {
    event.preventDefault();
    emitCancelableAppEvent('gnosi:open-pdf', { documentKey: 'Assets/book.pdf', kind: 'pdf', src: 'Assets/book.pdf', title: 'Book', location: { pageNumber: 6 } });
  }}>p. 6</a>,
}));
vi.mock('./EditorPane', () => ({ EditorPane: TestEditorPane }));
vi.mock('./TablePane', () => ({ TablePane: ({ tableId }: { tableId: string }) => <div data-table={tableId} /> }));
vi.mock('../drawings/TldrawEditor', () => ({ default: () => <div>Drawing</div> }));

const notes = ['one', 'two', 'three'].map(id => ({ id, title: id, metadata: { type: 'Summary' } }));
function TestEditorPane({ dashboard, tabId }: { dashboard: DashboardController; tabId: string }) {
  useEffect(() => {
    lifecycle.mount(tabId);
    return () => { lifecycle.unmount(tabId); };
  }, [tabId]);
  if (dashboard.tabs.find(tab => tab.id === tabId)?.isPdf) return <button data-pdf onClick={() => { dashboard.handleTabClose(tabId); }}>Back</button>;
  return <VaultGallery notes={notes} schema={{ properties: [{ name: 'type', type: 'select' }] }} activeView={{ id: 'notes', groupBy: 'type', galleryPreview: 'content', cardSize: 'full' }} viewStateScope={tabId} />;
}

let harness: Awaited<ReturnType<typeof renderController>> | undefined;
function required(selector: string): HTMLElement {
  const element = harness?.container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}
async function click(element: HTMLElement) { await act(async () => { element.click(); await Promise.resolve(); }); }
beforeEach(() => {
  vi.clearAllMocks();
  resetBrowserTestStorage('local', 'session');
  installApiDefaults();
  vi.mocked(fetchBrainTableStatus).mockRejectedValue(new Error('disabled fixture'));
  vi.mocked(fetchReferenceTable).mockRejectedValue(new Error('disabled fixture'));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => { callback(0); }, 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { window.clearTimeout(id); });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(async () => { await harness?.unmount(); vi.unstubAllGlobals(); });

async function openResource() {
  harness = await renderController(`page/${PAGE_ID}`, controller => <DashboardContent {...controller} />);
  await harness.run(() => Promise.resolve());
  await click(required('button[aria-expanded="false"]'));
  return required('[data-pane-focus-return="two"]');
}

describe('document tab continuity', () => {
  it.each(['select', 'close'] as const)('keeps the resource mounted and returns to its card and nested scroll through %s', async returnMethod => {
    const card = await openResource();
    const pane = required(`[data-document-pane="tab:${PAGE_ID}"]`);
    const pageScroll = pane.firstElementChild;
    const galleryScroll = pane.querySelector<HTMLDivElement>('.custom-scrollbar');
    if (!(pageScroll instanceof HTMLElement) || !galleryScroll) throw new Error('Missing nested scrollers');
    act(() => {
      card.focus();
      pageScroll.scrollTop = 540;
      galleryScroll.scrollTop = 210;
      galleryScroll.scrollLeft = 12;
      pageScroll.dispatchEvent(new Event('scroll'));
      galleryScroll.dispatchEvent(new Event('scroll'));
    });
    const loadsBefore = vi.mocked(fetchVaultPage).mock.calls.length;
    await click(required('[data-citation="two"]'));
    expect(required('[data-pdf]')).toBeTruthy();
    expect(pane.hidden).toBe(true);
    expect(pane.hasAttribute('inert')).toBe(true);
    expect(lifecycle.unmount).not.toHaveBeenCalledWith(PAGE_ID);
    // Simulate focus moving to the PDF / tab strip and layout resetting while hidden.
    act(() => { required('[data-pdf]').focus(); pageScroll.scrollTop = 0; galleryScroll.scrollTop = 0; galleryScroll.scrollLeft = 0; });
    if (returnMethod === 'close') await click(required('[data-pdf]'));
    else await harness?.run(controller => { controller.handleTabSelect(PAGE_ID); });
    expect(required('[data-pane-focus-return="two"]')).toBe(card);
    expect(document.activeElement).toBe(card);
    expect(pageScroll.scrollTop).toBe(540);
    expect(galleryScroll.scrollTop).toBe(210);
    expect(galleryScroll.scrollLeft).toBe(12);
    expect(required('button[aria-expanded="true"]')).toBeTruthy();
    expect(lifecycle.mount.mock.calls.filter(([id]) => id === PAGE_ID)).toHaveLength(1);
    expect(vi.mocked(fetchVaultPage).mock.calls).toHaveLength(loadsBefore);
    act(() => { card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(required('[data-pane-focus-return="three"]'));
  });

  it('remembers the clicked citation card even when focus was elsewhere', async () => {
    const card = await openResource();
    act(() => { required('[data-tab-strip]').focus(); });
    await click(required('[data-citation="two"]'));
    await harness?.run(controller => { controller.handleTabSelect(PAGE_ID); });
    expect(document.activeElement).toBe(card);
  });

  it('does not remount a document when it moves between primary and split panes', async () => {
    const card = await openResource();
    await harness?.run(controller => {
      controller.setTabs(previous => [...previous, { id: OTHER_ID, title: 'Other', content: 'body' }]);
      controller.setSplitTabIds([OTHER_ID]);
    });
    await harness?.run(controller => {
      controller.setActiveTabId(OTHER_ID);
      controller.setSplitTabIds([PAGE_ID]);
    });
    expect(required('[data-pane-focus-return="two"]')).toBe(card);
    expect(lifecycle.mount.mock.calls.filter(([id]) => id === PAGE_ID)).toHaveLength(1);
    expect(lifecycle.unmount).not.toHaveBeenCalled();
    expect(harness?.container.querySelectorAll('[data-document-pane]:not([hidden])')).toHaveLength(2);
  });

  it('mounts restored tabs on first visit and releases them on close', async () => {
    await openResource();
    await harness?.run(controller => {
      controller.setTabs(previous => [...previous, { id: OTHER_ID, title: 'Other', content: 'body' }]);
    });
    expect(lifecycle.mount).not.toHaveBeenCalledWith(OTHER_ID);
    await harness?.run(controller => { controller.handleTabSelect(OTHER_ID); });
    expect(lifecycle.mount).toHaveBeenCalledWith(OTHER_ID);
    await harness?.run(controller => { controller.handleTabClose(PAGE_ID); });
    expect(lifecycle.unmount).toHaveBeenCalledWith(PAGE_ID);
    expect(harness?.container.querySelector(`[data-document-pane="tab:${PAGE_ID}"]`)).toBeNull();
  });
});
