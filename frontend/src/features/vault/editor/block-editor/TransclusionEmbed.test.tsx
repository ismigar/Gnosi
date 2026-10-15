import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { VaultEditorContext, type VaultEditorContextValue } from '../../../../shared/editor/VaultEditorContext';
import { TransclusionEmbed } from './TransclusionEmbed';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), open: vi.fn(), t: (key: string) => key }));
vi.mock('../../../../shared/api/vaults', () => ({ fetchVaultPage: mocks.fetch, resolveVaultTitle: () => Promise.resolve({ id: null }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('./TransclusionContent', () => ({ TransclusionContent: ({ page }: { page: { content: string } }) => <div data-testid="content">{page.content}</div> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const context: VaultEditorContextValue = { allTables: [], idToTitle: { source: 'Source', host: 'Host' }, onCreateRecord: null, onDeletePage: null, onEditSchema: null, onOpenParallel: null, onOpenPage: mocks.open, pageId: 'host', registry: { databases: [], tables: [], views: [] } };
beforeEach(() => {
    vi.clearAllMocks(); mocks.fetch.mockResolvedValue({ id: 'source', content: 'Complete note '.repeat(100), etag: '1', metadata: {}, title: 'Source' });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); });
async function render(target: string, extra: Partial<VaultEditorContextValue> = {}) {
    await act(async () => { root.render(<VaultEditorContext.Provider value={{ ...context, ...extra }}><TransclusionEmbed block={{ props: { target } }} /></VaultEditorContext.Provider>); await Promise.resolve(); });
}
it('renders the entire source and opens it only through the button', async () => {
    await render('Source');
    expect(container.querySelector('[data-testid="content"]')?.textContent.length).toBeGreaterThan(300);
    await act(async () => { container.querySelector('[data-testid="content"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve(); });
    expect(mocks.open).not.toHaveBeenCalled();
    await act(async () => { container.querySelector<HTMLButtonElement>('button[title="editor.open_embedded_note"]')?.click(); await Promise.resolve(); });
    expect(mocks.open).toHaveBeenCalledWith('source');
});
it('does not load direct or indirect circular references', async () => {
    await render('host'); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain('editor.transclusion_cycle');
    await render('source', { transclusionAncestors: [JSON.stringify(['source', ''])] }); expect(mocks.fetch).not.toHaveBeenCalled();
});
it('reports missing notes without exposing an empty editor', async () => {
    await render('missing'); expect(mocks.fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain('editor.note_not_found');
    expect(container.querySelector('[data-testid="content"]')).toBeNull();
});
