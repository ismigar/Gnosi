import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GnosiApiError } from '../../../shared/api/errors';
import { useLlmWikiController } from './useLlmWikiController';
import type { LlmWikiController } from './llmWikiModel';

const api = vi.hoisted(() => ({
    fetchPluginLlmWikiConfig: vi.fn(), savePluginLlmWikiConfig: vi.fn(),
    createPluginLlmWikiBrain: vi.fn(), runPluginLlmWikiMaintenance: vi.fn(),
}));
const suggestions = vi.hoisted(() => vi.fn(() => new Promise<never>(() => {})));
const translate = vi.hoisted(() => (key: string) => key);
vi.mock('../../../shared/api/plugins', () => api);
vi.mock('../../../shared/api/vaults', () => ({ fetchVaultTables: () => Promise.resolve([]) }));
vi.mock('../../../shared/api/brain', () => ({ fetchBrainSuggestions: suggestions }));
vi.mock('../../../shared/notifications/notifyError', () => ({ logError: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: translate }) }));
let controller: LlmWikiController;
let root: Root;
let host: HTMLDivElement;
function Harness() {
    const value = useLlmWikiController();
    useLayoutEffect(() => { controller = value; });
    return null;
}
beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    api.fetchPluginLlmWikiConfig.mockResolvedValue({ config: { brain_table_id: 'brain', source_tables: [] } });
    api.savePluginLlmWikiConfig.mockRejectedValue(new GnosiApiError(new Response(null, { status: 400 }), { detail: 'Invalid source field' }));
    host = document.createElement('div');
    root = createRoot(host);
    await act(async () => { root.render(<Harness />); await Promise.resolve(); });
});
afterEach(() => { act(() => { root.unmount(); }); vi.useRealTimers(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('keeps the failed draft and error stable instead of retrying every debounce interval', async () => {
    expect(controller.loading).toBe(false);
    act(() => { controller.setDraft(current => ({ ...current, source_tables: [{
        table_id: 'resources', title_property_id: '', language_property_id: '',
        relation_property_id: '', include_body: false, attachment_property_ids: [],
        url_property_ids: [], dimension_mappings: {},
    }] })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(api.savePluginLlmWikiConfig).toHaveBeenCalledTimes(1);
    expect(controller.error).toBe('Invalid source field');
    expect(controller.busy).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(api.savePluginLlmWikiConfig).toHaveBeenCalledTimes(1);
    expect(controller.draft.source_tables[0]?.table_id).toBe('resources');
    await act(async () => { await controller.retrySave(); });
    expect(api.savePluginLlmWikiConfig).toHaveBeenCalledTimes(2);
    act(() => { controller.setDraft(current => ({ ...current, ui_locale: 'ca' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(api.savePluginLlmWikiConfig).toHaveBeenCalledTimes(3);
});

it('times out a stuck configuration request and can retry without exposing an empty editable draft', async () => {
    api.fetchPluginLlmWikiConfig.mockImplementationOnce(() => new Promise<never>(() => {}));
    let pending = Promise.resolve();
    act(() => { pending = controller.retryLoad(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    await pending;
    expect(controller.loading).toBe(false);
    expect(controller.error).toBe('settings.plugins.llm_wiki_load_error');
    await act(async () => { await controller.retryLoad(); });
    expect(controller.error).toBe('');
    expect(controller.loading).toBe(false);
});
