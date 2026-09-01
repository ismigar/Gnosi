import type { ReactElement } from 'react';
import { getDefaultReactSlashMenuItems } from '@blocknote/react';
import { CheckSquare, ChevronRight, Code, Columns, Database, Heading1, Heading2, Heading3, List as ListIcon, ListOrdered, Quote, Type } from 'lucide-react';
import { buildColumnLayoutCatalog, buildSlashCommandCatalog, buildTurnIntoCatalog } from '../../slashMenuUtils';
import { aiItems } from './aiItems';
import { blockItems } from './blockItems';
import { quickLinkItems } from './quickLinkItems';
import { columnLayoutAdapter, menuItemKey, turnIntoAdapter } from './catalogAdapters';
import type { EditorMenuItem, SlashMenuInputs } from './types';

const turnIntoIcons: Readonly<Record<string, ReactElement>> = {
    paragraph: <Type size={18} />,
    heading1: <Heading1 size={18} />, heading2: <Heading2 size={18} />, heading3: <Heading3 size={18} />,
    toggleHeading1: <Heading1 size={18} />, toggleHeading2: <Heading2 size={18} />, toggleHeading3: <Heading3 size={18} />,
    bullet: <ListIcon size={18} />, numbered: <ListOrdered size={18} />, check: <CheckSquare size={18} />,
    toggle: <ChevronRight size={18} />, quote: <Quote size={18} />, code: <Code size={18} />,
};

export function slashItems(query: string, inputs: SlashMenuInputs): EditorMenuItem[] {
    const { editor, t, allTables, openInlineIconPicker, capturePageViewAnchor, onOpenPageViewModal } = inputs;
    const defaultItems = getDefaultReactSlashMenuItems(editor)
        .filter(item => menuItemKey(item) !== 'file')
        .map(item => menuItemKey(item) === 'emoji' ? { ...item, onItemClick: openInlineIconPicker } : item);
    const vaultItems = buildSlashCommandCatalog({ allTables, onOpenPageView: (tableId = '') => {
        try { capturePageViewAnchor(editor.getTextCursorPosition().block.id || null); }
        catch { capturePageViewAnchor(null); }
        onOpenPageViewModal?.(tableId);
    } }).map(item => ({
        title: item.title, onItemClick: item.onItemClick, aliases: item.aliases,
        group: item.group || t('editor.database_group'), icon: <Database size={18} />, subtext: item.description,
    }));
    const layoutItems = buildColumnLayoutCatalog({ editor: columnLayoutAdapter(editor) }).map(item => ({
        title: item.title, onItemClick: item.onItemClick, aliases: item.aliases,
        group: item.group, icon: <Columns size={18} />, subtext: item.subtext,
    }));
    const turnIntoItems = buildTurnIntoCatalog({ editor: turnIntoAdapter(editor) }).map(item => ({
        title: item.title, onItemClick: item.onItemClick, aliases: item.aliases,
        group: item.group, icon: turnIntoIcons[item.iconKey], subtext: item.subtext,
    }));
    const allItems = [...aiItems(inputs), ...turnIntoItems, ...defaultItems, ...vaultItems, ...layoutItems, ...quickLinkItems(inputs), ...blockItems(inputs)];
    if (!query) return allItems.slice(0, 12);
    const lowerQuery = query.toLowerCase();
    return allItems.filter(item => item.title.toLowerCase().includes(lowerQuery)
        || (item.aliases ?? []).some(alias => alias.toLowerCase().includes(lowerQuery)));
}

/** Retain the original async callback's rejection contract for synchronous failures. */
export function slashSuggestions(query: string, inputs: SlashMenuInputs): Promise<EditorMenuItem[]> {
    return new Promise(resolve => { resolve(slashItems(query, inputs)); });
}
