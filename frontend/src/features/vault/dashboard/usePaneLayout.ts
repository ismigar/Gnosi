import React from 'react';
import { useEffect } from 'react';
import { useEffectEvent } from 'react';
import { subscribeDocumentEvent } from '../../../shared/platform/browser-events';
import type { DashboardActions } from './useDashboardActions';
export function usePaneLayout(context: DashboardActions) {
    const { activeTabId, activeTableId, pages, paneContainerRef, paneSizes, registry, resolvePageTableId, setPaneSizes, splitTabIds, splitTableIds, t, tabs } = context;
    const quickOpenItems = React.useMemo(() => {
        const pageItems = pages
            .filter(p => !p.metadata?.is_template)
            .map(page => {
            const tableId = resolvePageTableId(page);
            const table = tableId ? registry.tables.find(t => t.id === tableId) : null;
            const db = table ? registry.databases.find(d => d.id === table.database_id) : null;
            const subtitle = table ? t('common.page_db', { db: db?.name || t('common.no_base'), table: table.name }) : t('common.page_wiki');
            return {
                type: 'page',
                id: page.id,
                title: page.title || t('common.untitled'),
                subtitle
            };
        });
        const tableItems = registry.tables.map(table => {
            const db = registry.databases.find(d => d.id === table.database_id);
            return {
                type: 'table',
                id: table.id,
                title: table.name,
                subtitle: t('common.table_db', { db: db?.name || t('common.no_base') })
            };
        });
        const unique = new Map<string, {
            type: string;
            id: string;
            title: string;
            subtitle: string;
        }>();
        [...tableItems, ...pageItems].forEach(item => {
            const key = `${item.type}-${item.id}`;
            if (!unique.has(key))
                unique.set(key, item);
        });
        return Array.from(unique.values());
    }, [pages, registry.tables, registry.databases, resolvePageTableId, t]);
    const openPaneEntries = [
        ...(activeTabId ? [{ type: tabs.find(t => t.id === activeTabId)?.isTable ? 'table' : 'page', id: activeTabId }] : []),
        ...splitTabIds
            .filter(tabId => tabId !== activeTabId && tabs.some(tab => tab.id === tabId))
            .map(tabId => ({ type: 'page', id: tabId })),
        ...splitTableIds
            .filter(tableId => tableId !== activeTableId)
            .map(tableId => ({ type: 'table', id: tableId }))
    ];
    // Relative size of each panel (% of total space). Initialized equally.
    // Resynchronize sizes when the number of panels changes
    const synchronizeSizes = useEffectEvent(() => {
        if (openPaneEntries.length === 0) {
            setPaneSizes([]);
            return;
        }
        setPaneSizes(prev => {
            if (prev.length === openPaneEntries.length)
                return prev;
            const equal = 100 / openPaneEntries.length;
            return openPaneEntries.map(() => equal);
        });
    });
    useEffect(() => { synchronizeSizes(); }, [openPaneEntries.length]);
    const handleDividerMouseDown = (dividerIndex: number, e: React.MouseEvent) => {
        e.preventDefault();
        const container = paneContainerRef.current;
        if (!container)
            return;
        const containerWidth = container.getBoundingClientRect().width;
        const startX = e.clientX;
        const startSizes = [...paneSizes];
        const leftStart = startSizes[dividerIndex];
        const rightStart = startSizes[dividerIndex + 1];
        if (leftStart === undefined || rightStart === undefined)
            return;
        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = ((moveEvent.clientX - startX) / containerWidth) * 100;
            const newSizes = [...startSizes];
            const leftIdx = dividerIndex;
            const rightIdx = dividerIndex + 1;
            const newLeft = Math.max(10, leftStart + delta);
            const newRight = Math.max(10, rightStart - delta);
            const total = newLeft + newRight;
            newSizes[leftIdx] = (newLeft / total) * (leftStart + rightStart);
            newSizes[rightIdx] = (newRight / total) * (leftStart + rightStart);
            setPaneSizes(newSizes);
        };
        const onMouseUp = () => {
            offMove();
            offUp();
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        const offMove = subscribeDocumentEvent('mousemove', onMouseMove);
        const offUp = subscribeDocumentEvent('mouseup', onMouseUp);
    };
    return { quickOpenItems, openPaneEntries, handleDividerMouseDown };
}
