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
import { toast } from 'react-hot-toast';
import { X, Loader2, Eye, ExternalLink, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
            setPreview(data.content || t('No content'));
        } catch (err) {
            toast.error(t('Error loading content'));
        } finally {
            setLoading(false);
        }
    };

    const openInNewTab = () => {
        window.open(`/vault?page=${pageId}`, '_blank');
    };

    const copyId = () => {
        navigator.clipboard.writeText(pageId);
        toast.success(t('ID copied!'));
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
                    {t('Preview')}
                </button>
                <button
                    onClick={openInNewTab}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-green-50 hover:text-green-600 transition-colors"
                >
                    <ExternalLink size={14} />
                    {t('Open')}
                </button>
                <button
                    onClick={copyId}
                    className="px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-slate-100 transition-colors"
                    title={t('Copy ID')}
                >
                    <Copy size={14} />
                </button>
            </div>

            {/* Content Preview */}
            {preview !== null && (
                <div className="border-t border-slate-200 max-h-[200px] overflow-y-auto p-3">
                    <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                        {preview.substring(0, 500) || t('No content')}
                        {preview.length > 500 && '...'}
                    </p>
                </div>
            )}
        </div>
    );
}

// ──────────────── TldrawEditor Component ────────────────
export default function TldrawEditor({ drawingId, title, onClose, onSaveSuccess }) {
    const { t } = useTranslation();
    const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }));
    const [isLoading, setIsLoading] = useState(true);
    const editorRef = useRef(null);
    const wrapperRef = useRef(null);
    const autosaveTimerRef = useRef(null);
    const [selectedPage, setSelectedPage] = useState(null);

    // Load existing drawing
    useEffect(() => {
        if (!drawingId) { setIsLoading(false); return; }

        axios.get(`/api/vault/drawings/${drawingId}`)
            .then(res => {
                const data = res.data;
                if (data && typeof data === 'object') {
                    try {
                        loadSnapshot(store, data);
                    } catch (e) {
                        console.error("Error loading drawing:", e);
                    }
                }
            })
            .catch(() => {
                // Drawing does not exist yet → empty canvas
            })
            .finally(() => setIsLoading(false));
    }, [drawingId, store]);

    // Save drawing (auto-save)
    const handleSave = useCallback(async () => {
        if (!drawingId) return;
        try {
            const snapshot = getSnapshot(store);
            await axios.put(`/api/vault/drawings/${drawingId}`, {
                title: title || t('Untitled Drawing'),
                data: snapshot,
                metadata: {}
            });
            onSaveSuccess?.();
        } catch (err) {
            console.error("Error saving drawing:", err);
        }
    }, [drawingId, store, title, onSaveSuccess, t]);

    // Automatic autosave every 1 second if there are changes (same as BlockEditor)
    useEffect(() => {
        if (!drawingId) return;

        const unsub = store.listen(() => {
            if (autosaveTimerRef.current) {
                clearTimeout(autosaveTimerRef.current);
            }
            autosaveTimerRef.current = setTimeout(() => {
                handleSave();
            }, 1000);
        });

        return () => {
            unsub();
            if (autosaveTimerRef.current) {
                clearTimeout(autosaveTimerRef.current);
            }
        };
    }, [drawingId, store, handleSave]);

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

    // Detect shape selection with pageId in metadata
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
                        title: shape.meta.pageTitle || t('Page'),
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
    }, [editorRef.current, isLoading, t]);

    // Register drag & drop handlers with capture phase
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

            // Verify that drop is inside the tldraw wrapper
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

                // Create a note shape with the page title and metadata
                editor.createShape({
                    id: shapeId,
                    type: 'note',
                    x: point.x - 100,
                    y: point.y - 50,
                    props: {
                        color: 'blue',
                        size: 'm',
                        font: 'sans',
                        richText: toRichText(noteData.title || t('Untitled Page')),
                    },
                    meta: {
                        pageId: noteData.id,
                        pageTitle: noteData.title || t('Untitled Page'),
                    },
                });

                // Select created shape to show buttons
                editor.select(shapeId);

                toast.success(t('Page "{{title}}" added to canvas', { title: noteData.title }));
            } catch (err) {
                console.error("Error adding page to drawing:", err);
                toast.error(t('Error adding page'));
            }
        };

        document.addEventListener('dragover', dragOver, true);
        document.addEventListener('drop', drop, true);

        return () => {
            document.removeEventListener('dragover', dragOver, true);
            document.removeEventListener('drop', drop, true);
        };
    }, [t]);

    return (
        <div className="flex flex-col h-full w-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200 shrink-0">
                <h2 className="text-sm font-semibold text-slate-700 truncate">
                    {title || t('Untitled Drawing')}
                </h2>
                <button
                    onClick={onClose}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                    title={t('Close')}
                >
                    <X size={16} />
                </button>
            </div>

            {/* Editor */}
            <div
                ref={wrapperRef}
                className="flex-1 relative"
            >
                {isLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-white">
                        <Loader2 size={32} className="animate-spin text-indigo-500" />
                    </div>
                ) : (
                    <Tldraw
                        store={store}
                        hideUi={false}
                        inferDarkMode
                        onMount={(editor) => { editorRef.current = editor; }}
                    />
                )}

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
