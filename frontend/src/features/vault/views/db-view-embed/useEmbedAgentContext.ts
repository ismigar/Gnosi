import { useCallback, useEffect, useMemo, useRef } from 'react';
import { vaultAgentContextRefs } from '../../../agent-context/model/vaultAgentContext';
import { emitAppEvent, subscribeAppEvent } from '../../../../shared/platform/app-events';
import type { EmbedModel } from './useEmbedController';

/** Publish the view the human actually interacts with, including a selected tab. */
export function useEmbedAgentContext(model: EmbedModel) {
    const active = useRef(false);
    const { ctx, table, embeddedView } = model;
    const pageId = ctx.pageId;
    const pageTitle = pageId ? ctx.idToTitle[pageId] : undefined;
    const tableId = table?.id;
    const tableName = table?.name || table?.title;
    const viewId = embeddedView.id;
    const viewName = embeddedView.name;
    // The app rerenders the editor when it receives context. Its registry and
    // title map can be new objects with the same values; they must not republish.
    const refs = useMemo(() => vaultAgentContextRefs({
        page: { id: pageId, title: pageTitle },
        table: { id: tableId, name: tableName },
        view: { id: viewId, name: viewName },
        viewHostPageId: pageId || '',
    }), [pageId, pageTitle, tableId, tableName, viewId, viewName]);
    const published = useRef<typeof refs | null>(null);
    const publish = useCallback(() => {
        if (!pageId || !tableId || !viewId) return;
        if (active.current && published.current === refs) return;
        active.current = true;
        published.current = refs;
        emitAppEvent('gnosi:module-context', refs);
    }, [pageId, tableId, viewId, refs]);
    useEffect(() => subscribeAppEvent('gnosi:module-context', nextRefs => {
        active.current = nextRefs.some(ref => ref.type === 'table' && ref.ref === tableId
            && ref.scope?.view_id === viewId && ref.scope.page_id === pageId);
    }), [pageId, tableId, viewId]);
    useEffect(() => { if (active.current) publish(); }, [publish]);
    return publish;
}
