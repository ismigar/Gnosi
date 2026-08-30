import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitAppEvent } from '../../../shared/platform/app-events';
import { readFavoritesSort, readWikiLock, saveSections } from './preferences';
import { button, cleanup, click, fixtureRole, inputValue, pageRow, renderSidebar, resetPreferences, settle } from './test-support';

vi.mock('../../../hooks/use-api', () => ({ useApi: () => ({ role: fixtureRole.value }) }));
vi.mock('../../../hooks/useActiveVaultName', () => ({ useActiveVaultName: () => 'Vault fictici' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: string | { name?: string; defaultValue?: string }) => typeof options === 'string' ? options : options?.defaultValue || key + (options?.name ? `:${options.name}` : '') }) }));

beforeEach(() => { fixtureRole.value = 'admin'; resetPreferences(); });
afterEach(cleanup);

describe('VaultSidebar navigation', () => {
    it('preserves routes, daily actions and role visibility', async () => {
        const daily = vi.fn();
        const { props, container } = await renderSidebar({ onOpenDaily: daily });
        expect(container.textContent).toContain('Vault fictici');
        const drawing = [...container.querySelectorAll<HTMLElement>('.vault-sidebar__navigation-row')].find(row => row.textContent.trim() === 'sidebar.drawings');
        if (!drawing) throw new Error('Missing drawings row');
        await click(drawing);
        await click(button('Tags'));
        await click(button('Trash'));
        await click(button('Daily note'));
        expect(props.onNavigate).toHaveBeenNthCalledWith(1, 'drawing');
        expect(props.onNavigate).toHaveBeenNthCalledWith(2, 'tags');
        expect(props.onNavigate).toHaveBeenNthCalledWith(3, 'trash');
        expect(daily).toHaveBeenCalledOnce();
    });
    it('hides admin/editor actions for viewers while retaining read navigation', async () => {
        fixtureRole.value = 'viewer';
        const { container, props } = await renderSidebar({ pages: [{ id: 'a', title: 'Read me' }] });
        expect(container.textContent).not.toContain('Trash');
        expect(container.querySelector('[aria-label="sidebar.add_wiki_page"]')).toBeNull();
        await click(button('Wiki'));
        await click(pageRow('a'));
        expect(props.onPageSelect).toHaveBeenCalledWith('a');
        await click(button('sidebar.options', pageRow('a')));
        expect(document.querySelector('.vault-sidebar__menu')?.textContent).not.toContain('sidebar.rename');
        expect(document.querySelector('.vault-sidebar__menu')?.textContent).not.toContain('sidebar.delete');
        expect(pageRow('a').draggable).toBe(false);
    });
    it('persists favorite sorting and drag locking without changing page ids', async () => {
        const pages = [{ id: 'z', title: 'Zulu' }, { id: 'a', title: 'Alpha' }];
        const { props, container } = await renderSidebar({ pages, favoritePages: pages });
        await click(button('Favorites'));
        await click(button('Sort favorites'));
        await click(button('A → Z'));
        expect(readFavoritesSort().mode).toBe('alpha-asc');
        expect([...container.querySelectorAll<HTMLElement>('[data-vault-page-id]')].map(row => row.dataset.vaultPageId)).toEqual(['a', 'z']);
        await click(button('Alpha'));
        expect(props.onPageSelect).toHaveBeenCalledWith('a');
        await click(button('Wiki'));
        expect(readWikiLock()).toBe(true);
        await click(button('Unlock to reorder (drag&drop)'));
        expect(readWikiLock()).toBe(false);
        expect(container.querySelectorAll('[draggable="true"]').length).toBe(2);
    });
    it('locates an active child and dismisses menus with Escape', async () => {
        const scroll = vi.fn();
        vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scroll, configurable: true });
        await renderSidebar({ activePageId: 'child', pages: [{ id: 'a', title: 'Parent' }, { id: 'child', parent_id: 'a', title: 'Child' }] });
        await act(async () => { await Promise.resolve(); emitAppEvent('gnosi:locate-active-page'); });
        await settle();
        expect(pageRow('child').textContent).toContain('Child');
        expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
        await click(button('sidebar.options', pageRow('child')));
        expect(document.querySelector('.vault-sidebar__menu')).not.toBeNull();
        await act(async () => { await Promise.resolve(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(document.querySelector('.vault-sidebar__menu')).toBeNull();
    });
    it('keeps page rename and pointer favorite callbacks', async () => {
        saveSections(false, { favorites: false, dashboards: false, data: false, wiki: true });
        const { props } = await renderSidebar({ pages: [{ id: 'a', title: 'Original' }] });
        await click(button('sidebar.options', pageRow('a')));
        await click(button('sidebar.rename'));
        const input = pageRow('a').querySelector('input');
        if (!input) throw new Error('Missing rename input');
        await inputValue(input, 'Renamed');
        await act(async () => { await Promise.resolve(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
        expect(props.onRenamePage).toHaveBeenCalledWith('a', 'Renamed');
        await click(button('sidebar.options', pageRow('a')));
        await act(async () => { await Promise.resolve(); button('sidebar.add_favorites').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
        expect(props.onToggleFavorite).toHaveBeenCalledWith('a');
    });
    it('virtualizes large wiki lists and restores hierarchy when expanded', async () => {
        saveSections(false, { favorites: false, dashboards: false, data: false, wiki: true });
        const pages = Array.from({ length: 350 }, (_, i) => ({ id: `p${String(i)}`, title: `Page ${String(i)}` }));
        const { container } = await renderSidebar({ pages });
        expect(container.querySelectorAll('[data-vault-page-id]').length).toBeLessThan(50);
        const sidebar = container.querySelector<HTMLElement>('.vault-sidebar');
        if (!sidebar) throw new Error('Missing sidebar');
        await act(async () => { await Promise.resolve(); sidebar.scrollTop = 3000; sidebar.dispatchEvent(new Event('scroll', { bubbles: true })); });
        expect(container.querySelector('[data-vault-page-id="p100"]')).not.toBeNull();
        expect(container.querySelector('[data-vault-page-id="p0"]')).toBeNull();
    });
});

describe('VaultSidebar registry menus', () => {
    const registry = {
        databases: [{ id: 'db', name: 'Knowledge' }],
        tables: [{ id: 'a', name: 'Books', database_id: 'db' }, { id: 'b', name: 'Authors', database_id: 'db' }],
        views: [{ id: 'joined', name: 'Books by author', table_id: 'a', joins: [{ tableId: 'b' }] }],
    };
    it('shows a joined view under both tables with the selected table and view ids', async () => {
        const select = vi.fn();
        await renderSidebar({ ...registry, onTableSelect: select });
        await click(button('Data')); await click(button('Knowledge'));
        for (const name of ['Books', 'Authors']) {
            await click(button(`sidebar.expand_children:${name}`));
            const branch = button(name).closest('.w-full.flex.flex-col');
            if (!branch) throw new Error('Missing table branch');
            await click(button('sidebar.views', branch));
            await click(button('Books by author', branch));
        }
        expect(select).toHaveBeenNthCalledWith(1, 'a', 'joined');
        expect(select).toHaveBeenNthCalledWith(2, 'b', 'joined');
    });
    it('renames databases with the same payload and confirms deletion', async () => {
        const { props } = await renderSidebar(registry);
        await click(button('Data'));
        const row = button('Knowledge').parentElement;
        if (!row) throw new Error('Missing database row');
        await click(button('sidebar.options', row));
        await click(button('sidebar.rename'));
        const input = document.querySelector<HTMLInputElement>('[role="dialog"] input');
        if (!input) throw new Error('Missing database rename input');
        expect(input.value).toBe('Knowledge');
        await inputValue(input, 'Library');
        await click(button('Save'));
        expect(props.onRenameDatabase).toHaveBeenCalledWith('db', 'Library');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        await click(button('sidebar.options', row));
        await click(button('common.delete'));
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) throw new Error('Missing confirmation');
        expect(props.onDeleteDatabase).not.toHaveBeenCalled();
        await click(button('common.delete', dialog));
        expect(props.onDeleteDatabase).toHaveBeenCalledWith('db');
    });
});
