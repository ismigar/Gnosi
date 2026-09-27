import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import AgentContextSources from './AgentContextSources';
import type { ContextReference } from './agent-context/agentContextModel';
import { emitAppEvent } from '../../shared/platform/app-events';
import { writeStorage, removeStorage } from '../../shared/platform/browser-storage';
import { VAULT_ID_STORAGE_KEY, WORKSPACE_ID_STORAGE_KEY } from '../../shared/api/request-context';

const mocks = vi.hoisted(() => ({ internal: vi.fn(), external: vi.fn(), pages: vi.fn(), tables: vi.fn(), folders: vi.fn() }));
vi.mock('../../shared/api/agent-context', () => ({ fetchInternalContextSources: mocks.internal, fetchExternalContextSources: mocks.external }));
vi.mock('../../shared/api/vaults', () => ({ fetchVaultPages: mocks.pages, fetchVaultTables: mocks.tables }));
vi.mock('../../shared/api/mail', () => ({ fetchMailFolders: mocks.folders }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string, values: Record<string, unknown> = {}) => {
    const text = key === 'settings.ai.context_internal_planning' ? 'Planificació' : fallback ?? key;
    return Object.entries(values).reduce((result, [name, value]) => result.replace(`{{${name}}}`, String(value)), text);
} }) }));
const reader = { id: 'reader', name: 'Reader', description: '', scope: { source_ids: [], unread_only: true }, options: { sources: [{ id: 7, name: 'Educació' }, { id: 8, name: 'Història' }], categories: ['Cultura'] } };
const planning = { id: 'planning', name: 'Planning', description: '', scope: {}, options: { projects: [], resources: [], entity_types: ['task'] } };
const mail = { id: 'mail', name: 'Mail', description: '', scope: { accounts: [], folder: 'INBOX' }, options: { accounts: ['a@test', 'b@test'] } };
const ref = (source = 'reader', scope: Record<string, unknown> = {}): ContextReference => ({ id: `ctx-${source}`, ref: source, label: source, type: 'internal', scope });
function Harness({ initial = [], changed = () => undefined }: { readonly initial?: ContextReference[]; readonly changed?: (value: ContextReference[]) => void }) {
    const [value, setValue] = useState(initial);
    return <AgentContextSources value={value} onChange={next => { setValue(next); changed(next); }} />;
}
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const click = async (element: HTMLElement) => { await act(async () => { element.click(); await Promise.resolve(); }); };
const find = (selector: string, root: ParentNode = document): HTMLElement => {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element;
};
const button = (text: string, root: ParentNode = document): HTMLElement => {
    const element = [...root.querySelectorAll<HTMLElement>('button')].find(item => item.textContent === text);
    if (!element) throw new Error(`Missing button: ${text}`);
    return element;
};
const search = async (element: HTMLElement, value: string) => {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
    });
};
const pick = (text: string) => {
    const element = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent.includes(text));
    if (!element) throw new Error(`Missing option: ${text}`);
    return click(element);
};
beforeEach(() => {
    mocks.internal.mockResolvedValue([reader, planning, mail]);
    mocks.external.mockResolvedValue([{ id: 'ext', label: 'External catalogue' }]);
    mocks.pages.mockResolvedValue([{ id: 'page-1', title: 'A page' }]);
    mocks.tables.mockResolvedValue([{ id: 'table-1', title: 'A database' }]);
    mocks.folders.mockResolvedValue({ folders: [{ name: 'INBOX', type: 'Received' }, { name: 'Archive', type: 'Archived' }] });
});
afterEach(() => { vi.resetAllMocks(); removeStorage(VAULT_ID_STORAGE_KEY); removeStorage(WORKSPACE_ID_STORAGE_KEY); });

describe('Source settings interactions', () => {
    it('hides added sources, opens their row and restores removed sources', async () => {
        const { container } = mountTestComponent(<Harness />);
        await click(button('Gnosi source', container)); await click(button('Reader', container));
        expect(find('button[aria-expanded="true"]', container).textContent).toContain('Reader');
        await click(button('Gnosi source', container));
        expect([...container.querySelectorAll('button')].some(item => item.textContent === 'Reader')).toBe(false);
        await click(find('button[aria-label^="Remove from context:"]', container));
        expect(button('Reader', container)).toBeTruthy();
    });
    it('filters selected entries before the result limit and searches translated names without accents', async () => {
        const descriptors = Array.from({ length: 55 }, (_, index) => ({ ...reader, id: `s${String(index)}`, name: `Source ${String(index)}` }));
        mocks.internal.mockResolvedValue([...descriptors, planning]);
        const { container } = mountTestComponent(<Harness initial={descriptors.map(item => ({ ...ref(item.id), label: item.name }))} />);
        await click(button('Gnosi source', container)); await search(find('input[aria-label="Search..."]', container), 'PLANIFICACIO');
        expect(button('Planificació', container)).toBeTruthy();
    });
    it('hides external sources, pages, legacy database aliases and whole vault while retaining navigation', async () => {
        const initial: ContextReference[] = [
            { id: 'v', type: 'vault', ref: 'active', label: 'Vault' }, { id: 'p', type: 'page', ref: 'page-1', label: 'A page' },
            { id: 't', type: 'database', ref: 'table-1', label: 'A database' }, { id: 'e', type: 'source', ref: 'ext', label: 'External catalogue' },
        ];
        mocks.internal.mockResolvedValue([]);
        const { container } = mountTestComponent(<Harness initial={initial} />);
        await click(button('External source', container)); expect(container.textContent).toContain('You have added all available sources.');
        await click(button('Gnosi source', container));
        expect([...container.querySelectorAll('button')].some(item => item.textContent === 'Vault')).toBe(false);
        await click(find('button[aria-label="Remove from context: Vault · A page"]', container));
        await click(button('VaultPages and databases in the active vault.', container));
        expect([...container.querySelectorAll('button')].some(item => item.textContent === 'Entire active vault')).toBe(false);
        await click(button('Page', container)); expect(button('A page', container)).toBeTruthy();
        await click(button('Database', container)); expect(container.textContent).toContain('You have added all available sources.');
    });
    it('edits numeric filters by keyboard without losing unknown fields or unavailable selections', async () => {
        const changed = vi.fn<(value: ContextReference[]) => void>();
        const { container } = mountTestComponent(<Harness initial={[ref('reader', { source_ids: [999], custom: { keep: true } })]} changed={changed} />);
        await flush(); await click(find('button[aria-label^="Configure source scope:"]', container));
        expect(container.textContent).toContain('999 · Unavailable');
        await click(find('[role="combobox"][aria-label="Feeds"]', container)); await search(find('[data-property-dropdown] input'), 'educacio');
        await act(async () => { find('[data-property-dropdown] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await Promise.resolve(); });
        expect(changed.mock.lastCall?.[0][0]?.scope).toEqual({ source_ids: [999, 7], custom: { keep: true } });
        expect(document.querySelector('[role="option"]')).toBeNull();
        await click(find('button[aria-label="Delete: 999"]', container)); expect(changed.mock.lastCall?.[0][0]?.scope?.source_ids).toEqual([7]);
    });
    it('retries failed catalogs without dropping saved sources', async () => {
        mocks.internal.mockRejectedValueOnce(new Error('offline'));
        const { container } = mountTestComponent(<Harness initial={[ref()]} />);
        await flush(); await click(find('button[aria-label^="Configure source scope:"]', container));
        expect(find('[role="alert"]', container).textContent).toContain('Could not load options');
        await click(find('button[aria-label="Refresh"]', container));
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(container.querySelector('[role="combobox"][aria-label="Feeds"]')).not.toBeNull();
        expect(container.querySelectorAll('.agent-source-row')).toHaveLength(1);
    });
    it('distinguishes empty catalogs from searches without matches', async () => {
        mocks.external.mockResolvedValue([]);
        const { container } = mountTestComponent(<Harness />);
        await click(button('External source', container)); expect(container.textContent).toContain('No sources available.');
        await search(find('input[aria-label="Search..."]', container), 'missing'); expect(container.textContent).toContain('No results.');
    });
    it.each([VAULT_ID_STORAGE_KEY, WORKSPACE_ID_STORAGE_KEY])('discards old catalog responses when context changes: %s', async storageKey => {
        let resolveOld: (value: typeof reader[]) => void = () => undefined;
        mocks.internal.mockReturnValueOnce(new Promise<typeof reader[]>(resolve => { resolveOld = resolve; }));
        const { container } = mountTestComponent(<Harness />);
        await click(button('Gnosi source', container)); expect(container.textContent).toContain('Loading...');
        mocks.internal.mockResolvedValue([planning]);
        await act(async () => { writeStorage(storageKey, 'new-context'); emitAppEvent('gnosi:config-changed'); await Promise.resolve(); });
        await click(button('Gnosi source', container));
        await act(async () => { resolveOld([reader]); await Promise.resolve(); });
        expect(button('Planificació', container)).toBeTruthy();
        expect([...container.querySelectorAll('button')].some(item => item.textContent === 'Reader')).toBe(false);
    });
    it('configures folders independently per account and round-trips legacy settings', async () => {
        const changed = vi.fn<(value: ContextReference[]) => void>();
        const initial = ref('mail', { accounts: ['a@test', 'b@test'], folder: 'INBOX', extension: 'keep' });
        const { container, unmount } = mountTestComponent(<Harness initial={[initial]} changed={changed} />);
        await flush(); await click(find('button[aria-label^="Configure source scope:"]', container));
        expect(mocks.folders).toHaveBeenCalledWith('a@test', expect.any(AbortSignal));
        expect(mocks.folders).toHaveBeenCalledWith('b@test', expect.any(AbortSignal));
        const account = find('.agent-source-folders', container);
        expect(find('button[aria-label="Delete: INBOX"]', account).hasAttribute('disabled')).toBe(true);
        await click(find('[role="combobox"]', account)); await pick('Archive');
        expect(changed.mock.lastCall?.[0][0]?.scope).toEqual({ ...initial.scope, folders_by_account: { 'a@test': ['INBOX', 'Archive'] } });
        const saved: ContextReference[] = changed.mock.lastCall?.[0] ?? []; unmount();
        const reopened = mountTestComponent(<Harness initial={saved} />);
        await flush(); await click(find('button[aria-label^="Configure source scope:"]', reopened.container));
        expect(find('.agent-source-folders', reopened.container).textContent).toContain('Archive');
        expect(reopened.container.querySelectorAll('.agent-source-folders')[1]?.textContent).not.toContain('Archive');
    });
    it('preserves folder choices on loading errors and retries', async () => {
        mocks.folders.mockRejectedValueOnce(new Error('offline'));
        const { container } = mountTestComponent(<Harness initial={[ref('mail', { accounts: ['a@test'], folder: 'Archive' })]} />);
        await flush(); await click(find('button[aria-label^="Configure source scope:"]', container));
        expect(container.textContent).toContain('Archive'); expect(container.querySelector('[role="alert"]')).not.toBeNull();
        await click(find('.agent-source-folders button[aria-label="Refresh"]', container));
        expect(container.querySelector('[role="alert"]')).toBeNull(); expect(container.textContent).toContain('Archive');
    });
});
