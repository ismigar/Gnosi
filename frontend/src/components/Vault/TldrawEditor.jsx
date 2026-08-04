/**
 * TldrawEditor.jsx
 * Drawing editor based on Tldraw for the Gnosi Vault.
 * Replaces ExcalidrawEditor and is fully compatible with React 19.
 */
import React, { useEffect, useCallback, useState, useRef } from 'react';
import { Tldraw, createTLStore, defaultShapeUtils, getSnapshot, loadSnapshot } from 'tldraw';
import { createShapeId, toRichText } from '@tldraw/tlschema';
import 'tldraw/tldraw.css';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';
import { X, Loader2, Eye, ExternalLink, Copy, AlertTriangle, FilePlus2, Search, ScanText, PenLine } from 'lucide-react';
import { PageCardShapeUtil, CanvasPageContext } from './canvasPageCardShape';
import { GlobalSearchModal } from './GlobalSearchModal';
import { usePlugins } from '../../plugins/usePlugins';

// Custom shape utils for the canvas (page cards) on top of the tldraw defaults.
const CANVAS_SHAPE_UTILS = [...defaultShapeUtils, PageCardShapeUtil];

// ──────────────── Page Actions Panel ────────────────
function PageActionsPanel({ pageId, pageTitle, onClose }) {
    const { t } = useTranslation();
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(false);

    const loadPreview = async () => {
        if (loading) return;
        setLoading(true);
        try {
            const res = await axios.get(`/api/vault/pages/${pageId}`);
            const data = res.data;
            setPreview(data.content || t('editor.no_content'));
        } catch {
            toast.error(t('tldraw.load_content_error'));
        } finally {
            setLoading(false);
        }
    };

    const openInNewTab = () => {
        window.open(`/vault?page=${pageId}`, '_blank');
    };

    const copyId = async () => {
        // navigator.clipboard may reject (insecure context, permission denied).
        // Without `await` the toast.success was shown before knowing the result.
        try {
            await navigator.clipboard.writeText(pageId);
            toast.success(t('tldraw.id_copied'));
        } catch {
            toast.error(t('tldraw.id_copy_error'));
        }
    };

    return (
        <div className="absolute top-2 left-2 z-50 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden" style={{ minWidth: 280 }}>
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                <span className="text-xs font-semibold text-slate-700 truncate">{pageTitle}</span>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                    <X size={14} />
                </button>
            </div>

            {/* Buttons */}
            <div className="flex gap-1 p-2">
                <button
                    onClick={loadPreview}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                    {t('tldraw.preview')}
                </button>
                <button
                    onClick={openInNewTab}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-green-50 hover:text-green-600 transition-colors"
                >
                    <ExternalLink size={14} />
                    {t('common.open')}
                </button>
                <button
                    onClick={copyId}
                    className="px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-slate-100 transition-colors"
                >
                    <Copy size={14} />
                </button>
            </div>

            {/* Content preview */}
            {preview !== null && (
                <div className="border-t border-slate-200 max-h-[200px] overflow-y-auto p-3">
                    <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                        {preview.substring(0, 500) || t('editor.no_content')}
                        {preview.length > 500 && '...'}
                    </p>
                </div>
            )}
        </div>
    );
}

// ──────────────── TldrawEditor Component ────────────────
export default function TldrawEditor({ drawingId, title, onClose, onSaveSuccess, onOpenPage, allNotes = [], tables = [] }) {
    const { t } = useTranslation();
    const { isEnabled: isPluginEnabled } = usePlugins();
    const cardsEnabled = isPluginEnabled('canvas-cards');
    const [store] = useState(() => createTLStore({ shapeUtils: CANVAS_SHAPE_UTILS }));
    // 'loading' | 'ready' | 'error' | 'incompatible' — saving (autosave and
    // Ctrl+S) is ONLY possible in 'ready'. If loading fails or the snapshot
    // doesn't apply, saving would mean overwriting the real drawing with an
    // empty canvas (see the tldraw_save_integrity.md directive).
    const [loadState, setLoadState] = useState(drawingId ? 'loading' : 'ready');
    const [retryTick, setRetryTick] = useState(0);
    const editorRef = useRef(null);
    const wrapperRef = useRef(null);
    const autosaveTimerRef = useRef(null);
    const [selectedPage, setSelectedPage] = useState(null);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [recognizing, setRecognizing] = useState(false);
    const [penOnly, setPenOnly] = useState(false);

    // Synchronous reset if the drawing changes without remounting (React
    // "adjusting state when props change"): no render can see 'ready'
    // with the previous drawing's state — autosave would remain armed with a
    // store that still has the old content. (The normal consumer sets
    // key={drawingId} and remounts, but we can't guarantee that from here.)
    const [loadedDrawingId, setLoadedDrawingId] = useState(drawingId);
    if (loadedDrawingId !== drawingId) {
        setLoadedDrawingId(drawingId);
        setLoadState(drawingId ? 'loading' : 'ready');
    }

    // Load existing drawing
    useEffect(() => {
        if (!drawingId) return; // without an id there's no persistence (initial 'ready' state)

        const controller = new AbortController();
        axios.get(`/api/vault/drawings/${drawingId}`, { signal: controller.signal })
            .then(res => {
                if (controller.signal.aborted) return;
                const data = res.data;
                // loadSnapshot does NOT validate the format: with an object lacking
                // store/document/session keys it does nothing (silent no-op) — this is the case
                // of legacy .excalidraw.json drawings. We validate before calling it.
                const isPlainObject = data && typeof data === 'object' && !Array.isArray(data);
                // {} or falsy/non-object is the initial data the dashboard uses to create a new drawing
                const isEmptyInitial = !data || typeof data !== 'object' || Object.keys(data).length === 0;
                const isTldrawSnapshot = isPlainObject &&
                    ('store' in data || 'document' in data || 'session' in data);

                if (!isEmptyInitial && !isTldrawSnapshot) {
                    console.error(`Drawing ${drawingId} has a format incompatible with tldraw (legacy .excalidraw?)`);
                    setLoadState('incompatible');
                    return;
                }
                try {
                    if (isTldrawSnapshot) {
                        const snapshotToLoad = data.store
                            ? data
                            : (data.document?.store
                                ? { store: data.document.store, schema: data.document.schema }
                                : (data.document ? { store: data.document, schema: data.schema } : data));
                        loadSnapshot(store, snapshotToLoad);
                    }
                    setLoadState('ready');
                } catch (e) {
                    console.error("Error applying drawing snapshot:", e);
                    setLoadState('incompatible');
                }
            })
            .catch((err) => {
                if (controller.signal.aborted || err?.name === 'CanceledError' || axios.isCancel?.(err)) return;
                if (err?.response?.status === 404) {
                    // The drawing doesn't exist yet → new empty whiteboard (can be saved)
                    setLoadState('ready');
                } else {
                    // 500, network, OneDrive online-only file... the drawing
                    // exists but we couldn't read it: we block saving.
                    console.error("Error loading drawing:", err);
                    setLoadState('error');
                }
            });

        return () => {
            controller.abort();
        };
    }, [drawingId, store, retryTick]);

    // Save drawing (auto-save)
    const handleSave = useCallback(async () => {
        if (!drawingId || loadState !== 'ready') return;
        try {
            const snapshot = getSnapshot(store);
            await axios.put(`/api/vault/drawings/${drawingId}`, {
                title: title || 'Dibuix sense títol',
                data: snapshot,
                metadata: {}
            });
            onSaveSuccess?.();
        } catch (err) {
            console.error("Error saving drawing:", err);
        }
    }, [drawingId, store, title, onSaveSuccess, loadState]);

    // Automatic autosave every 1 second if there are changes (same as BlockEditor)
    useEffect(() => {
        if (!drawingId || loadState !== 'ready') return;

        // Only document changes made by the user: camera and selection are
        // scope 'session' and must not schedule any PUT.
        const unsub = store.listen(() => {
            if (autosaveTimerRef.current) {
                clearTimeout(autosaveTimerRef.current);
            }
            autosaveTimerRef.current = setTimeout(() => {
                autosaveTimerRef.current = null;
                handleSave();
            }, 1000);
        }, { scope: 'document', source: 'user' });

        return () => {
            unsub();
            if (autosaveTimerRef.current) {
                clearTimeout(autosaveTimerRef.current);
            }
        };
    }, [drawingId, store, handleSave, loadState]);

    // Flush on unmount: if a PENDING autosave remains (a change made less than 1s
    // before closing the drawing or navigating away), save it before the component
    // disappears. Without this, the cleanup above only cancels the timer and
    // the last stroke would be lost. Ref to the latest `handleSave` so the effect
    // on unmount (empty deps) doesn't capture an old one with a stale `title`.
    const handleSaveRef = useRef(handleSave);
    useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);
    useEffect(() => () => {
        if (autosaveTimerRef.current) {
            clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
            handleSaveRef.current?.();
        }
    }, []);

    // Save with Ctrl+S / Cmd+S
    useEffect(() => {
        const handleKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [handleSave]);

    // Detect shape selection with pageId in the metadata
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;

        const checkSelection = () => {
            const selectedIds = editor.getSelectedShapeIds();
            if (selectedIds.length === 1) {
                const shape = editor.getShape(selectedIds[0]);
                if (shape?.meta?.pageId) {
                    setSelectedPage({
                        id: shape.meta.pageId,
                        title: shape.meta.pageTitle || t('tldraw.page'),
                    });
                    return;
                }
            }
            setSelectedPage(null);
        };

        // Check immediately
        checkSelection();

        // Check on changes
        const unsub = editor.store.listen(() => {
            setTimeout(checkSelection, 50);
        });

        return () => unsub();
        // Depends on loadState (and t for the fallback's i18n): when it switches to 'ready' <Tldraw> mounts and onMount
        // (child effect, runs before this one) has already filled editorRef.
    }, [loadState, t]);

    // Register the drag & drop handlers with capture phase
    useEffect(() => {
        const dragOver = (e) => {
            if (e.dataTransfer.types.includes('application/gnosi-note')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }
        };

        const drop = (e) => {
            const editor = editorRef.current;
            if (!editor) return;

            const noteDataString = e.dataTransfer.getData('application/gnosi-note');
            if (!noteDataString) return;

            // Verify that the drop is inside the tldraw wrapper
            const wrapper = wrapperRef.current;
            if (!wrapper || !wrapper.contains(e.target)) return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            try {
                const noteData = JSON.parse(noteDataString);

                // Convert screen coordinates to canvas coordinates
                const point = editor.screenToPage({
                    x: e.clientX,
                    y: e.clientY,
                });

                const shapeId = createShapeId();

                if (cardsEnabled) {
                    // Page card (page-card) with a live preview, Obsidian Canvas style.
                    editor.createShape({
                        id: shapeId,
                        type: 'page-card',
                        x: point.x - 130,
                        y: point.y - 85,
                        props: {
                            w: 260,
                            h: 170,
                            pageId: noteData.id,
                            pageTitle: noteData.title || 'Untitled page',
                        },
                    });
                } else {
                    // Plugin disabled: simple link as a tldraw note.
                    editor.createShape({
                        id: shapeId,
                        type: 'note',
                        x: point.x - 100,
                        y: point.y - 50,
                        props: { color: 'blue', size: 'm', font: 'sans', richText: toRichText(noteData.title || 'Untitled page') },
                        meta: { pageId: noteData.id, pageTitle: noteData.title || 'Untitled page' },
                    });
                }

                // Select the created shape
                editor.select(shapeId);

                toast.success(t('tldraw.page_added', { title: noteData.title }));
            } catch (err) {
                console.error("Error adding page to drawing:", err);
                toast.error(t('tldraw.add_page_error'));
            }
        };

        document.addEventListener('dragover', dragOver, true);
        document.addEventListener('drop', drop, true);

        return () => {
            document.removeEventListener('dragover', dragOver, true);
            document.removeEventListener('drop', drop, true);
        };
    }, [t]);

    // Embeds an existing page as a card at the center of the canvas (same
    // logic as the drag&drop drop, but without a destination point: the viewport).
    const insertPageOnCanvas = useCallback((pageId, pageTitle) => {
        const editor = editorRef.current;
        if (!editor) return;
        const displayTitle = pageTitle || 'Untitled page';
        const center = editor.getViewportPageBounds().center;
        const shapeId = createShapeId();
        if (cardsEnabled) {
            editor.createShape({
                id: shapeId,
                type: 'page-card',
                x: center.x - 130,
                y: center.y - 85,
                props: { w: 260, h: 170, pageId, pageTitle: displayTitle },
            });
        } else {
            editor.createShape({
                id: shapeId,
                type: 'note',
                x: center.x - 100,
                y: center.y - 50,
                props: { color: 'blue', size: 'm', font: 'sans', richText: toRichText(displayTitle) },
                meta: { pageId, pageTitle: displayTitle },
            });
        }
        editor.select(shapeId);
    }, [cardsEnabled]);

    // Searches for a vault note (including DB rows) and places it on the canvas.
    const handleSearchSelect = useCallback((pageId) => {
        const note = allNotes.find((n) => n.id === pageId);
        insertPageOnCanvas(pageId, note?.title);
        toast.success(t('tldraw.page_added', { title: note?.title || t('common.untitled') }));
    }, [allNotes, insertPageOnCanvas, t]);

    // Creates a new page in the Vault and embeds it as a card at the center of the canvas.
    const handleCreateNoteOnCanvas = useCallback(async () => {
        const editor = editorRef.current;
        if (!editor) return;
        try {
            const res = await axios.post('/api/vault/pages', {
                title: 'Nova nota',
                content: '',
                is_database: false,
                metadata: {},
            });
            const page = res.data;
            insertPageOnCanvas(page.id, page.title || 'Nova nota');
            toast.success(t('tldraw.note_created'));
        } catch (err) {
            console.error('Error creating note on canvas:', err);
            toast.error(t('tldraw.create_note_error'));
        }
    }, [insertPageOnCanvas, t]);

    // ── TrOCR model warmup ──
    // When opening the canvas, it asks the backend to preload the model in the background
    // fashion (fire-and-forget). While the user draws, the model loads, and
    // when clicking "Convert to text" it's already there → the 1st call doesn't wait on ~1.3 GB.
    useEffect(() => {
        axios.post('/api/vault/handwriting/warmup').catch(() => {});
    }, []);

    // ── Convert handwritten strokes to text (local OCR with TrOCR on the backend) ──
    // Exports the selected shapes (or the whole canvas if there's no selection) to
    // PNG with a white background, sends it to the backend, and inserts the recognized text right
    // below. The strokes are NOT deleted: the text is added alongside.
    const handleRecognize = useCallback(async () => {
        const editor = editorRef.current;
        if (!editor || recognizing) return;

        let ids = editor.getSelectedShapeIds();
        if (!ids || ids.length === 0) {
            // Without a selection: uses all the strokes on the current page.
            ids = [...editor.getCurrentPageShapeIds()];
        }
        if (ids.length === 0) {
            toast.error(t('tldraw.no_strokes'));
            return;
        }

        setRecognizing(true);
        try {
            // White background + light mode: TrOCR expects a dark document on white.
            const img = await editor.toImage(ids, {
                format: 'png',
                background: true,
                darkMode: false,
                padding: 16,
                scale: 2,
            });
            if (!img?.blob) throw new Error('Could not export the image');

            const form = new FormData();
            form.append('image', img.blob, 'ink.png');
            const res = await axios.post('/api/vault/handwriting/recognize', form);
            const text = (res.data?.text || '').trim();

            if (!text) {
                toast.error(t('tldraw.no_text_recognized'));
                return;
            }

            // Places the text right below the recognized strokes.
            const bounds = editor.getSelectionPageBounds()
                || editor.getCurrentPageBounds();
            const x = bounds ? bounds.x : editor.getViewportPageBounds().center.x;
            const y = bounds ? bounds.maxY + 24 : editor.getViewportPageBounds().center.y;
            const textId = createShapeId();
            editor.createShape({
                id: textId,
                type: 'text',
                x,
                y,
                props: { richText: toRichText(text), color: 'black', size: 'm' },
            });
            editor.select(textId);
            toast.success(res.data?.corrected
                ? t('tldraw.recognized_corrected')
                : t('tldraw.recognized'));
        } catch (err) {
            console.error('Error recognizing handwriting:', err);
            const status = err?.response?.status;
            if (status === 503) {
                toast.error(t('tldraw.engine_unavailable'));
            } else {
                toast.error(t('tldraw.recognize_error'));
            }
        } finally {
            setRecognizing(false);
        }
    }, [recognizing, t]);

    // ── "Pen only" mode (palm rejection) ──
    // Blocks 'touch' type pointer events before they reach tldraw
    // (capture phase) so a resting palm doesn't draw. The pen
    // (pointerType 'pen') and the mouse keep working. It's a toggle: when
    // it's active, two-finger pan/zoom is lost, which is expected in this mode.
    useEffect(() => {
        if (!penOnly) return;
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        const blockTouch = (e) => {
            if (e.pointerType === 'touch') {
                e.stopPropagation();
            }
        };
        const events = ['pointerdown', 'pointermove', 'pointerup', 'pointerenter'];
        events.forEach((ev) => wrapper.addEventListener(ev, blockTouch, true));
        return () => {
            events.forEach((ev) => wrapper.removeEventListener(ev, blockTouch, true));
        };
    }, [penOnly, loadState]);

    return (
        <div className="flex flex-col h-full w-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200 shrink-0">
                <h2 className="text-sm font-semibold text-slate-700 truncate">
                    {title || t('tldraw.untitled_drawing')}
                </h2>
                <div className="flex items-center gap-2">
                    {loadState === 'ready' && (
                        <button
                            onClick={handleRecognize}
                            disabled={recognizing}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-wait"
                            title={t('tldraw.recognize_title')}
                        >
                            {recognizing ? <Loader2 size={14} className="animate-spin" /> : <ScanText size={14} />}
                            {recognizing ? t('tldraw.recognizing') : t('tldraw.to_text')}
                        </button>
                    )}
                    {loadState === 'ready' && (
                        <button
                            onClick={() => setPenOnly((v) => !v)}
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
                            onClick={() => setIsSearchOpen(true)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                            title={t('tldraw.add_note_title')}
                        >
                            <Search size={14} /> {t('tldraw.add_note')}
                        </button>
                    )}
                    {loadState === 'ready' && cardsEnabled && (
                        <button
                            onClick={handleCreateNoteOnCanvas}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-md hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                            title={t('tldraw.new_note_title')}
                        >
                            <FilePlus2 size={14} /> {t('tldraw.new_note')}
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="gnosi-close-btn"
                        aria-label={t('common.close')}
                    >
                        <X />
                    </button>
                </div>
            </div>

            {/* Editor */}
            <div
                ref={wrapperRef}
                className="flex-1 relative"
            >
                {loadState === 'loading' ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-white">
                        <Loader2 size={32} className="animate-spin text-indigo-500" />
                    </div>
                ) : (
                    <CanvasPageContext.Provider value={{ onOpenPage }}>
                        <Tldraw
                            store={store}
                            shapeUtils={CANVAS_SHAPE_UTILS}
                            hideUi={false}
                            inferDarkMode
                            onMount={(editor) => { editorRef.current = editor; }}
                        />
                    </CanvasPageContext.Provider>
                )}

                {/* Failed load or inapplicable snapshot: we lock the canvas
                    so that no edit (not even autosave) overwrites the real file */}
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
                                    onClick={() => { setLoadState('loading'); setRetryTick(t => t + 1); }}
                                    className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
                                >
                                    {t('common.retry')}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Vault note search to place them on the canvas */}
                <GlobalSearchModal
                    isOpen={isSearchOpen}
                    onClose={() => setIsSearchOpen(false)}
                    allNotes={allNotes}
                    tables={tables}
                    onNoteSelect={handleSearchSelect}
                />

                {/* Actions panel for selected pages */}
                {selectedPage && (
                    <PageActionsPanel
                        pageId={selectedPage.id}
                        pageTitle={selectedPage.title}
                        onClose={() => {
                            const editor = editorRef.current;
                            if (editor) editor.deselectAll();
                            setSelectedPage(null);
                        }}
                    />
                )}
            </div>
        </div>
    );
}
