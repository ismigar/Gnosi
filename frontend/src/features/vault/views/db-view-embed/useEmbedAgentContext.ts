import { useCallback, useEffect, useRef } from 'react';
import { vaultAgentContextRefs } from '../../../agent-context/model/vaultAgentContext';
import { emitAppEvent, subscribeAppEvent } from '../../../../shared/platform/app-events';
import type { EmbedModel } from './useEmbedController';

/** Publish the view the human actually interacts with, including a selected tab. */
export function useEmbedAgentContext(model: EmbedModel) {
    const active = useRef(false);
    const { ctx, table, embeddedView } = model;
    const publish = useCallback(() => {
        if (!ctx.pageId || !table?.id || !embeddedView.id) return;
        emitAppEvent('gnosi:module-context', vaultAgentContextRefs({
            page: { id: ctx.pageId, title: ctx.idToTitle[String(ctx.pageId)] },
            table,
            view: embeddedView,
            viewHostPageId: String(ctx.pageId),
        }));
    }, [ctx.pageId, ctx.idToTitle, table, embeddedView]);
    useEffect(() => subscribeAppEvent('gnosi:module-context', refs => {
        active.current = refs.some(ref => ref.type === 'table' && ref.ref === table?.id
            && ref.scope?.view_id === embeddedView.id && ref.scope.page_id === ctx.pageId);
    }), [ctx.pageId, table?.id, embeddedView.id]);
    useEffect(() => { if (active.current) publish(); }, [publish]);
    return useCallback(() => { active.current = true; publish(); }, [publish]);
}
