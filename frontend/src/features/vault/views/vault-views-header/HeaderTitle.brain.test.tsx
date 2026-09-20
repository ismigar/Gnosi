import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HeaderTitle } from './HeaderTitle';
import { dispatchWindowEvent } from '../../../../shared/platform/browser-events';

const api = vi.hoisted(() => ({ config: vi.fn(), maintenance: vi.fn(), suggestions: vi.fn(), dismiss: vi.fn() }));
vi.mock('../../../../shared/api/plugins', () => ({ fetchPluginLlmWikiConfig: api.config, runPluginLlmWikiMaintenance: api.maintenance }));
vi.mock('../../../../shared/api/brain', () => ({ fetchBrainSuggestions: api.suggestions, dismissBrainSuggestion: api.dismiss }));
vi.mock('../../../../shared/editor/WikilinkInline', () => ({ WikilinkInline: ({ title }: { readonly title: string }) => <span>{title}</span> }));
vi.mock('../../../literature/records/ReferenceImportExport', () => ({ ReferenceImportExport: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { readonly defaultValue?: string; readonly count?: number }) =>
    options?.defaultValue ?? `${key}${options?.count === undefined ? '' : `:${String(options.count)}`}` }) }));

let root: Root;
let host: HTMLDivElement;
const changed = vi.fn();
const report = { lint: { note_count: 12, counts: { orphans: 3, broken_cites: 2, index_drift: 1, reprocess: 4 } }, suggestions_pending: 1, suggestions_queued: 1 };
const render = async (brainTableId: string | undefined = 'brain'): Promise<void> => {
    await act(async () => { await Promise.resolve();
        root.render(<HeaderTitle brainTableId={brainTableId} tableName="Notes" recordCount={12} viewRecordCount={12} isFilteredView={false} onReferencesImported={changed} />);
    });
};
const click = async (text: string): Promise<void> => {
    const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent === text);
    if (!button) throw new Error(`Missing button: ${text}`);
    await act(async () => { await Promise.resolve(); button.click(); });
};
const start = async (semantic = false): Promise<void> => {
    await click('llm_wiki.tools.button');
    await click(semantic ? 'settings.plugins.llm_wiki_semantic_run' : 'llm_wiki.tools.review');
};

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    api.config.mockResolvedValue({ brain: { table_id: 'brain' }, validation: { valid: true } });
    api.maintenance.mockResolvedValue(report);
    api.suggestions.mockResolvedValue({ suggestions: [] });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => { root.unmount(); });
    host.remove();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
});

it('only exposes maintenance in the Brain table header', async () => {
    await render('');
    expect(host.textContent).not.toContain('llm_wiki.tools.button');
    expect(api.config).not.toHaveBeenCalled();
    expect(api.maintenance).not.toHaveBeenCalled();
});

it('runs the deterministic review and keeps its result available in the header', async () => {
    await render();
    await start();
    expect(api.maintenance).toHaveBeenCalledWith(false, expect.any(AbortSignal));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('settings.plugins.llm_wiki_lint_summary:12');
    expect(document.body.textContent).toContain('settings.plugins.llm_wiki_lint_cites:2');
    expect(changed).toHaveBeenCalledOnce();
    await act(async () => { await Promise.resolve(); dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    await click('llm_wiki.tools.button');
    await click('llm_wiki.tools.results');
    expect(document.body.textContent).toContain('settings.plugins.llm_wiki_lint_summary:12');
    expect(api.maintenance).toHaveBeenCalledOnce();
});

it('opens freshly generated connections after an AI audit', async () => {
    await render();
    api.suggestions.mockResolvedValue({ suggestions: [{ id: 'new', title: 'New connection', member_ids: [], kind: 'connection' }] });
    await start(true);
    expect(api.maintenance).toHaveBeenCalledWith(true, expect.any(AbortSignal));
    expect(api.suggestions.mock.calls.length).toBeGreaterThan(1);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('New connection');
    expect(changed).toHaveBeenCalledOnce();
});

it.each([
    { brain: { table_id: 'brain' }, validation: { valid: false } },
    { brain: { table_id: 'another-table' }, validation: { valid: true } },
])('prevents maintenance with incomplete or changed Brain configuration', async config => {
    api.config.mockResolvedValue(config);
    await render();
    await start();
    expect(api.maintenance).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('llm_wiki.tools.unavailable');
});

it('shows an action failure and retries the same operation', async () => {
    api.maintenance.mockRejectedValueOnce(new Error('Offline'));
    await render();
    await start(true);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await click('common.retry');
    expect(api.maintenance).toHaveBeenCalledTimes(2);
    expect(api.maintenance).toHaveBeenLastCalledWith(true, expect.any(AbortSignal));
});

it('supports keyboard navigation and blocks duplicate actions while running', async () => {
    api.maintenance.mockImplementation(() => new Promise<never>(() => {}));
    await render();
    await click('llm_wiki.tools.button');
    expect(document.activeElement?.textContent).toBe('llm_wiki.tools.review');
    await act(async () => { await Promise.resolve(); document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
    expect(document.activeElement?.textContent).toBe('settings.plugins.llm_wiki_semantic_run');
    await click('llm_wiki.tools.review');
    await act(async () => { await Promise.resolve(); dispatchWindowEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    await click('llm_wiki.tools.button');
    const actions = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(actions.slice(0, 2).every(button => button.disabled)).toBe(true);
    await click('llm_wiki.tools.review');
    expect(api.maintenance).toHaveBeenCalledOnce();
});
