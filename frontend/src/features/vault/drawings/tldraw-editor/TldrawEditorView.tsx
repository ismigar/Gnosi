import { useEffect, type RefObject } from 'react';
import {
    AlertTriangle,
    FilePlus2,
    Loader2,
    PenLine,
    ScanText,
    Search,
    X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    Tldraw,
    type Editor,
    type TLAnyShapeUtilConstructor,
    type TLStore,
} from 'tldraw';

import { PageActionsPanel } from './PageActionsPanel';
import { subscribeElementEvent } from '../../../../shared/platform/browser-events';
import {
    CanvasPageProvider,
    TldrawGlobalSearchModal,
} from './tldrawEditorBridges';
import type {
    DrawingLoadState,
    SelectedCanvasPage,
    TldrawVaultNote,
    TldrawVaultTable,
} from './tldrawEditorTypes';

interface TldrawEditorViewProps {
    readonly allNotes: readonly TldrawVaultNote[];
    readonly cardsEnabled: boolean;
    readonly closeSelectedPage: () => void;
    readonly createNote: () => Promise<void>;
    readonly isSearchOpen: boolean;
    readonly loadState: DrawingLoadState;
    readonly onClose: () => void;
    readonly onEditorMount: (editor: Editor) => void;
    readonly onOpenPage?: ((pageId: string) => void) | null;
    readonly onRecognize: () => Promise<void>;
    readonly onSearchSelect: (pageId: string) => void;
    readonly openSearch: () => void;
    readonly penOnly: boolean;
    readonly recognizing: boolean;
    readonly retryLoad: () => void;
    readonly selectedPage: SelectedCanvasPage | null;
    readonly setPenOnly: (enabled: boolean) => void;
    readonly setSearchOpen: (isOpen: boolean) => void;
    readonly shapeUtils: readonly TLAnyShapeUtilConstructor[];
    readonly store: TLStore;
    readonly supportsTouch: boolean;
    readonly tables: readonly TldrawVaultTable[];
    readonly title: string | null;
    readonly wrapperRef: RefObject<HTMLDivElement | null>;
}

export function TldrawEditorView({
    allNotes,
    cardsEnabled,
    closeSelectedPage,
    createNote,
    isSearchOpen,
    loadState,
    onClose,
    onEditorMount,
    onOpenPage,
    onRecognize,
    onSearchSelect,
    openSearch,
    penOnly,
    recognizing,
    retryLoad,
    selectedPage,
    setPenOnly,
    setSearchOpen,
    shapeUtils,
    store,
    supportsTouch,
    tables,
    title,
    wrapperRef,
}: TldrawEditorViewProps) {
    const { t } = useTranslation();
    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!penOnly || !wrapper) return undefined;
        const blockPalmTouch = (event: PointerEvent): void => {
            if (event.pointerType === 'touch') event.stopPropagation();
        };
        const events = [
            'pointerdown',
            'pointermove',
            'pointerup',
            'pointerenter',
        ] as const;
        const unsubscribers = events.map((event) => subscribeElementEvent(
            wrapper,
            event,
            blockPalmTouch,
            true,
        ));
        return () => {
            for (const unsubscribe of unsubscribers) unsubscribe();
        };
    }, [loadState, penOnly, wrapperRef]);

    return (
        <div className="flex flex-col h-full w-full">
            <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200 shrink-0">
                <h2 className="text-sm font-semibold text-slate-700 truncate">
                    {title || t('tldraw.untitled_drawing')}
                </h2>
                <div className="flex items-center gap-2">
                    {loadState === 'ready' && (
                        <button
                            type="button"
                            onClick={() => {
                                void onRecognize();
                            }}
                            disabled={recognizing}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-wait"
                            title={t('tldraw.recognize_title')}
                        >
                            {recognizing
                                ? <Loader2 size={14} className="animate-spin" />
                                : <ScanText size={14} />}
                            {recognizing ? t('tldraw.recognizing') : t('tldraw.to_text')}
                        </button>
                    )}
                    {loadState === 'ready' && supportsTouch && (
                        <button
                            type="button"
                            onClick={() => {
                                setPenOnly(!penOnly);
                            }}
                            aria-pressed={penOnly}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-md transition-colors ${penOnly
                                ? 'text-indigo-700 bg-indigo-50 border-indigo-300'
                                : 'text-slate-600 bg-slate-50 border-slate-200 hover:bg-indigo-50 hover:text-indigo-600'}`}
                            title={t('tldraw.pen_only_title')}
                        >
                            <PenLine size={14} /> {t('tldraw.pen_only')}
                        </button>
                    )}
                    {loadState === 'ready' && (
                        <button
                            type="button"
                            onClick={openSearch}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                            title={t('tldraw.add_note_title')}
                        >
                            <Search size={14} /> {t('tldraw.add_note')}
                        </button>
                    )}
                    {loadState === 'ready' && cardsEnabled && (
                        <button
                            type="button"
                            onClick={() => {
                                void createNote();
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                            title={t('tldraw.new_note_title')}
                        >
                            <FilePlus2 size={14} /> {t('tldraw.new_note')}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="gnosi-close-btn"
                        aria-label={t('common.close')}
                    >
                        <X />
                    </button>
                </div>
            </div>

            <div
                ref={wrapperRef}
                className="flex-1 relative"
            >
                {loadState === 'loading' ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-white">
                        <Loader2 size={32} className="animate-spin text-indigo-500" />
                    </div>
                ) : (
                    <CanvasPageProvider value={{ onOpenPage }}>
                        <Tldraw
                            store={store}
                            shapeUtils={shapeUtils}
                            hideUi={false}
                            colorScheme="system"
                            onMount={onEditorMount}
                        />
                    </CanvasPageProvider>
                )}

                {(loadState === 'error' || loadState === 'incompatible') && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                        <div className="max-w-md mx-4 p-5 bg-white rounded-xl shadow-xl border border-amber-300 text-center">
                            <AlertTriangle size={28} className="mx-auto mb-3 text-amber-500" />
                            <p className="text-sm font-semibold text-slate-700 mb-1">
                                {loadState === 'error'
                                    ? t('tldraw.load_error_title')
                                    : t('tldraw.incompatible_title')}
                            </p>
                            <p className="text-xs text-slate-500 mb-4">
                                {loadState === 'error'
                                    ? t('tldraw.load_error_desc')
                                    : t('tldraw.incompatible_desc')}
                            </p>
                            {loadState === 'error' && (
                                <button
                                    type="button"
                                    onClick={retryLoad}
                                    className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
                                >
                                    {t('common.retry')}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                <TldrawGlobalSearchModal
                    isOpen={isSearchOpen}
                    onClose={() => {
                        setSearchOpen(false);
                    }}
                    allNotes={allNotes}
                    tables={tables}
                    onNoteSelect={onSearchSelect}
                />

                {selectedPage && (
                    <PageActionsPanel
                        pageId={selectedPage.id}
                        pageTitle={selectedPage.title}
                        onClose={closeSelectedPage}
                    />
                )}
            </div>
        </div>
    );
}
