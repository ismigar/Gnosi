import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { createShapeId, toRichText } from '@tldraw/tlschema';
import { useTranslation } from 'react-i18next';

import { createVaultPage } from '../../../shared/api/vaults';
import { logError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import { subscribeAppEvent } from '../../../shared/platform/app-events';
import { subscribeDocumentEvent } from '../../../shared/platform/browser-events';
import {
    pageCardIdsForDeletedPage,
    parseDroppedCanvasNote,
    selectedPageFromShape,
} from './tldrawEditorModel';
import type {
    CanvasEditor,
    SelectedCanvasPage,
    TldrawVaultNote,
} from './tldrawEditorTypes';

interface UseTldrawPageCardsOptions {
    readonly allNotes: readonly TldrawVaultNote[];
    readonly cardsEnabled: boolean;
    readonly editorRef: RefObject<CanvasEditor | null>;
    readonly loadState: string;
    readonly wrapperRef: RefObject<HTMLDivElement | null>;
}

export interface TldrawPageCards {
    readonly closeSelectedPage: () => void;
    readonly createNote: () => Promise<void>;
    readonly insertFromSearch: (pageId: string) => void;
    readonly isSearchOpen: boolean;
    readonly openSearch: () => void;
    readonly selectedPage: SelectedCanvasPage | null;
    readonly setSearchOpen: (isOpen: boolean) => void;
}

function insertPage(
    editor: CanvasEditor,
    pageId: string,
    pageTitle: string | null | undefined,
    cardsEnabled: boolean,
): void {
    const displayTitle = pageTitle || 'Untitled page';
    const center = editor.getViewportPageBounds().center;
    const shapeId = createShapeId();
    if (cardsEnabled) {
        editor.createShape({
            id: shapeId,
            props: { h: 170, pageId, pageTitle: displayTitle, w: 260 },
            type: 'page-card',
            x: center.x - 130,
            y: center.y - 85,
        });
    } else {
        editor.createShape({
            id: shapeId,
            meta: { pageId, pageTitle: displayTitle },
            props: {
                color: 'blue',
                font: 'sans',
                richText: toRichText(displayTitle),
                size: 'm',
            },
            type: 'note',
            x: center.x - 100,
            y: center.y - 50,
        });
    }
    editor.select(shapeId);
}

export function useTldrawPageCards({
    allNotes,
    cardsEnabled,
    editorRef,
    loadState,
    wrapperRef,
}: UseTldrawPageCardsOptions): TldrawPageCards {
    const { t } = useTranslation();
    const [selectedPage, setSelectedPage] = useState<SelectedCanvasPage | null>(null);
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return undefined;
        let selectionTimer: ReturnType<typeof setTimeout> | null = null;
        const checkSelection = (): void => {
            const selectedIds = editor.getSelectedShapeIds();
            const selectedId = selectedIds.length === 1 ? selectedIds[0] : undefined;
            const shape = selectedId ? editor.getShape(selectedId) : undefined;
            setSelectedPage(selectedPageFromShape(shape, t('tldraw.page')));
        };
        checkSelection();
        const unsubscribe = editor.store.listen(() => {
            if (selectionTimer !== null) clearTimeout(selectionTimer);
            selectionTimer = setTimeout(checkSelection, 50);
        });
        return () => {
            unsubscribe();
            if (selectionTimer !== null) clearTimeout(selectionTimer);
        };
    }, [editorRef, loadState, t]);

    useEffect(() => {
        const unsubscribeDragOver = subscribeDocumentEvent('dragover', (event) => {
            if (event.dataTransfer?.types.includes('application/gnosi-note')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
            }
        }, true);
        const unsubscribeDrop = subscribeDocumentEvent('drop', (event) => {
            const editor = editorRef.current;
            const wrapper = wrapperRef.current;
            const transfer = event.dataTransfer;
            const target = event.target;
            if (!editor || !wrapper || !transfer || !(target instanceof Node)) return;
            const serializedNote = transfer.getData('application/gnosi-note');
            if (!serializedNote || !wrapper.contains(target)) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            try {
                const note = parseDroppedCanvasNote(serializedNote);
                const point = editor.screenToPage({ x: event.clientX, y: event.clientY });
                const shapeId = createShapeId();
                const displayTitle = note.title || 'Untitled page';
                if (cardsEnabled) {
                    editor.createShape({
                        id: shapeId,
                        props: {
                            h: 170,
                            pageId: note.id,
                            pageTitle: displayTitle,
                            w: 260,
                        },
                        type: 'page-card',
                        x: point.x - 130,
                        y: point.y - 85,
                    });
                } else {
                    editor.createShape({
                        id: shapeId,
                        meta: { pageId: note.id, pageTitle: displayTitle },
                        props: {
                            color: 'blue',
                            font: 'sans',
                            richText: toRichText(displayTitle),
                            size: 'm',
                        },
                        type: 'note',
                        x: point.x - 100,
                        y: point.y - 50,
                    });
                }
                editor.select(shapeId);
                toast.success(t('tldraw.page_added', { title: note.title }));
            } catch (error) {
                logError('tldraw.page-drop', error);
                toast.error(t('tldraw.add_page_error'));
            }
        }, true);
        return () => {
            unsubscribeDragOver();
            unsubscribeDrop();
        };
    }, [cardsEnabled, editorRef, t, wrapperRef]);

    useEffect(() => subscribeAppEvent('gnosi:page-deleted', ({ pageId }) => {
        const editor = editorRef.current;
        if (!editor || !pageId) return;
        const cardIds = pageCardIdsForDeletedPage(
            editor.getCurrentPageShapes(),
            pageId,
        );
        if (cardIds.length > 0) editor.deleteShapes(cardIds);
    }), [editorRef]);

    const insertFromSearch = useCallback((pageId: string): void => {
        const editor = editorRef.current;
        if (!editor) return;
        const note = allNotes.find((candidate) => candidate.id === pageId);
        insertPage(editor, pageId, note?.title, cardsEnabled);
        toast.success(t('tldraw.page_added', {
            title: note?.title || t('common.untitled'),
        }));
    }, [allNotes, cardsEnabled, editorRef, t]);

    const createNote = useCallback(async (): Promise<void> => {
        const editor = editorRef.current;
        if (!editor) return;
        try {
            const page = await createVaultPage({
                content: '',
                is_database: false,
                metadata: {},
                title: 'Nova nota',
            });
            const pageTitle = typeof page.title === 'string'
                ? page.title
                : 'Nova nota';
            insertPage(editor, page.id, pageTitle, cardsEnabled);
            toast.success(t('tldraw.note_created'));
        } catch (error) {
            logError('tldraw.note-create', error);
            toast.error(t('tldraw.create_note_error'));
        }
    }, [cardsEnabled, editorRef, t]);

    return {
        closeSelectedPage: () => {
            editorRef.current?.deselectAll();
            setSelectedPage(null);
        },
        createNote,
        insertFromSearch,
        isSearchOpen,
        openSearch: () => {
            setIsSearchOpen(true);
        },
        selectedPage,
        setSearchOpen: setIsSearchOpen,
    };
}
