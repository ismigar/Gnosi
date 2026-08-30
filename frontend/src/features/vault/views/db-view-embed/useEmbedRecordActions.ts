import { useCallback, useRef } from 'react';
import { fetchVaultPage, createPageInTable } from './api';
import { reportEmbedError } from './diagnostics';
import type { EmbedInputs } from './inputs';
import type { EmbedDerived } from './useEmbedDerived';
import type { Metadata, EmbedRow } from './types';
export function useEmbedRecordActions({ ctx, tableId, block, activeViewId, headingProp, headingLevelProp, reload }: EmbedInputs & EmbedDerived & { reload: () => void ;}) {
    const { onOpenPage, onOpenPageViewModal } = ctx;
    const isCreatingRef = useRef(false);
    const handleCreate = useCallback(async (extra: Metadata = {}, template: EmbedRow | null = null) => {
        if (isCreatingRef.current || !tableId) return;
        isCreatingRef.current = true;
        try {
            let initialContent = '';
            let baseMeta = template?.metadata || {};
            let title = template ? `Nou (${template.title || 'plantilla'})` : 'Nou registre';

            if (template?.id) {
                try {
                    const pageData = await fetchVaultPage(template.id);
                    {
                        initialContent = pageData.content || '';
                        if (pageData.title) title = pageData.title;
                        baseMeta = { ...pageData.metadata, ...baseMeta };
                    }
                } catch (e) {
                    reportEmbedError('Failed to fetch template content', e);
                }
            }

            const created = await createPageInTable({
                tableId,
                title,
                content: initialContent,
                extraMetadata: {
                    ...baseMeta,
                    is_template: false,
                    ...extra,
                },
            });
            const newId = created.id;
            reload();
            if (newId) {
                onOpenPage?.(newId);
            }
        } catch (e) {
            reportEmbedError('createPageInTable failed', e);
        } finally {
            isCreatingRef.current = false;
        }
    }, [tableId, onOpenPage, reload]);

    const handleOpenConfig = useCallback(() => {
        if (!onOpenPageViewModal || !tableId) return;
        const sectionVid = block?.props?.view_id || '';
        if (!activeViewId || activeViewId === sectionVid) {
            // The active tab is the section's view → the block's config as-is.
            onOpenPageViewModal(tableId, block);
        } else {
            // Config for the ACTIVE tab's view: we pass an editingBlock
            // synthetic one with its view_id. When saving, PageViewModal updates
            // this view and re-anchors the block's section to it (the block then
            // shows the view you configured).
            onOpenPageViewModal(tableId, {
                id: block?.id,
                props: { view_id: activeViewId, heading: headingProp || '', heading_level: headingLevelProp || 1 },
            });
        }
    }, [onOpenPageViewModal, tableId, block, activeViewId, headingProp, headingLevelProp]);
    return { handleCreate, handleOpenConfig };
}
export type EmbedRecordActions = ReturnType<typeof useEmbedRecordActions>;
