import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { SchemaConfigModal } from '../SchemaConfigModal';
import type { SchemaConfigModalProps } from './types';
import * as schemaApi from '../../../shared/api/vault-schema';
import { fetchVaultTables } from '../../../shared/api/vaults';

vi.mock('../../../shared/api/vault-schema', () => ({
    fetchAvailableAgentSkills: vi.fn(), fetchDrupalContentTypes: vi.fn(), fetchDrupalFields: vi.fn(),
    fetchOptionCatalogs: vi.fn(), fetchTableOptionUsage: vi.fn(), fetchVirtualFields: vi.fn(),
    generateButtonAction: vi.fn(), matchDrupalRows: vi.fn(), removeTableOption: vi.fn(),
    renameTableOption: vi.fn(), saveVaultFolderSchema: vi.fn(), updateOptionCatalog: vi.fn(),
}));
vi.mock('../../../shared/api/vaults', () => ({ fetchVaultTables: vi.fn() }));
vi.mock('../../../plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: (name: string) => name === 'project-planning' }) }));
vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

export const baseSchema = {
    Title: 'title', Title_config: { id: 'fld_00000001' },
    Status: 'status', Status_config: { id: 'fld_00000002', role: 'status', catalog_ref: 'status' },
};

export async function interact(run: () => void) {
    await act(async () => { run(); await Promise.resolve(); });
}

export function setupModal() {
    let root: Root | null = null;
    let container: HTMLDivElement;
    let props: SchemaConfigModalProps;
    const i18n = createInstance();
    const consoleErrors = vi.fn<(...values: unknown[]) => void>();

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(consoleErrors);
        await i18n.init({ lng: 'en', resources: {}, initImmediate: false });
        vi.mocked(fetchVaultTables).mockResolvedValue([]);
        vi.mocked(schemaApi.fetchAvailableAgentSkills).mockResolvedValue({ catalog_revision: 'test', issues: [], skills: [{ id: 'skill-1', name: 'Test skill' }] });
        vi.mocked(schemaApi.fetchOptionCatalogs).mockResolvedValue({ catalogs: { status: [{ name: 'Open', color: 'blue' }, { name: 'Done', color: 'green' }], Tags: ['A', 'B'] } });
        vi.mocked(schemaApi.fetchVirtualFields).mockResolvedValue({ computers: [{ compute: 'graph.degree', label: 'Degree' }] });
        vi.mocked(schemaApi.fetchTableOptionUsage).mockResolvedValue({ counts: { Open: 3, Done: 1 } });
        vi.mocked(schemaApi.fetchDrupalContentTypes).mockResolvedValue({ content_types: [{ machine: 'article', label: 'Article' }] });
        vi.mocked(schemaApi.fetchDrupalFields).mockResolvedValue({ bundle: 'article', fields: [{ field_name: 'body', label: 'Body', field_type: 'text' }] });
        vi.mocked(schemaApi.matchDrupalRows).mockResolvedValue({ counts: { matched: 2, unmatched: 1 } });
        vi.mocked(schemaApi.renameTableOption).mockResolvedValue({ files_changed: 0 });
        vi.mocked(schemaApi.removeTableOption).mockResolvedValue({ files_changed: 0 });
        vi.mocked(schemaApi.updateOptionCatalog).mockResolvedValue({});
        vi.mocked(schemaApi.saveVaultFolderSchema).mockResolvedValue({});
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    const render = async (next: Partial<SchemaConfigModalProps> = {}) => {
        props = { isOpen: true, onClose: vi.fn(), folder: 'Fixture', currentSchema: baseSchema, tableId: 'table-1', ...next };
        await interact(() => { root?.render(<I18nextProvider i18n={i18n}><SchemaConfigModal {...props} /></I18nextProvider>); });
        return props;
    };
    const rerender = async (next: Partial<SchemaConfigModalProps>) => render({ ...props, ...next });
    const unmount = async () => { await interact(() => { root?.unmount(); }); root = null; };
    afterEach(async () => {
        await unmount();
        container.remove();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        expect(consoleErrors).not.toHaveBeenCalled();
    });
    return { render, rerender, unmount };
}

export function button(text: string): HTMLButtonElement {
    const buttons = [...document.querySelectorAll('button')];
    const element = buttons.find((item) => item.textContent.trim() === text)
        || buttons.find((item) => item.getAttribute('aria-label') === text)
        || buttons.find((item) => item.title === text);
    if (!element) throw new Error(`Button not found: ${text}`);
    return element;
}

export function input(value: string): HTMLInputElement {
    const element = [...document.querySelectorAll('input')].find((item) => item.value === value);
    if (!element) throw new Error(`Input not found: ${value}`);
    return element;
}

export async function change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
    await interact(() => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
        descriptor?.set?.call(element, value);
        element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    });
}

export async function click(element: HTMLElement) {
    await interact(() => { element.click(); });
}

export async function advance(milliseconds = 600) {
    await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
}

export async function key(element: EventTarget, keyValue: string) {
    await interact(() => { element.dispatchEvent(new KeyboardEvent('keydown', { key: keyValue, bubbles: true, cancelable: true })); });
}
