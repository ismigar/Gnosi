/**
 * TldrawEditor.jsx
 * Editor de dibuixos basat en Tldraw per al Vault de Gnosi.
 * Substitueix ExcalidrawEditor i és totalment compatible amb React 19.
 */
import React, { useEffect, useCallback, useState, useRef } from 'react';
import { Tldraw, createTLStore, defaultShapeUtils, getSnapshot, loadSnapshot } from 'tldraw';
import { createShapeId, toRichText } from '@tldraw/tlschema';
import 'tldraw/tldraw.css';
import axios from 'axios';
import { toast } from 'react-hot-toast';
import { X, Loader2, Eye, ExternalLink, Copy } from 'lucide-react';

// ──────────────── Page Actions Panel ────────────────
function PageActionsPanel({ pageId, pageTitle, onClose }) {
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(false);

    const loadPreview = async () => {
        if (loading) return;
        setLoading(true);
        try {
            const res = await axios.get(`/api/vault/pages/${pageId}`);
            const data = res.data;
            setPreview(data.content || 'Sense contingut');
        } catch (err) {
            toast.error('Error carregant contingut');
        } finally {
            setLoading(false);
        }
    };

    const openInNewTab = () => {
        window.open(`/vault?page=${pageId}`, '_blank');
    };

    const copyId = () => {
        navigator.clipboard.writeText(pageId);
        toast.success('ID copiat!');
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

            {/* Botons */}
            <div className="flex gap-1 p-2">
                <button
                    onClick={loadPreview}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                >
                    {loading ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
                    Previsualitzar
                </button>
                <button
                    onClick={openInNewTab}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-green-50 hover:text-green-600 transition-colors"
                >
                    <ExternalLink size={14} />
                    Obrir
                </button>
                <button
                    onClick={copyId}
                    className="px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-slate-100 transition-colors"
                >
                    <Copy size={14} />
                </button>
            </div>

            {/* Preview del contingut */}
            {preview !== null && (
                <div className="border-t border-slate-200 max-h-[200px] overflow-y-auto p-3">
                    <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                        {preview.substring(0, 500) || 'Sense contingut'}
                        {preview.length > 500 && '...'}
                    </p>
                </div>
            )}
        </div>
    );
}

// ──────────────── TldrawEditor Component ────────────────
export default function TldrawEditor({ drawingId, title, onClose, onSaveSuccess }) {
    const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }));
    const [isLoading, setIsLoading] = useState(true);
    const editorRef = useRef(null);
    const wrapperRef = useRef(null);
    const autosaveTimerRef = useRef(null);
    const [selectedPage, setSelectedPage] = useState(null);

    // Carregar dibuix existent
    useEffect(() => {
        if (!drawingId) { setIsLoading(false); return; }

        axios.get(`/api/vault/drawings/${drawingId}`)
            .then(res => {
                const data = res.data;
                if (data && typeof data === 'object') {
                    try {
                        loadSnapshot(store, data);
                    } catch (e) {
                        console.error("Error carregant dibuix:", e);
                    }
                }
            })
            .catch(() => {
                // El dibuix no existeix yet → pissarra buida
            })
            .finally(() => setIsLoading(false));
    }, [drawingId, store]);

    // Guardar dibuix (auto-save)
    const handleSave = useCallback(async () => {
        if (!drawingId) return;
        try {
            const snapshot = getSnapshot(store);
            await axios.put(`/api/vault/drawings/${drawingId}`, {
                title: title || 'Dibuix sense títol',
                data: snapshot,
                metadata: {}
            });
            onSaveSuccess?.();
        } catch (err) {
            console.error("Error al desar el dibuix:", err);
        }
    }, [drawingId, store, title, onSaveSuccess]);

    // Autosave automàtic cada 1 segon si hi ha canvis (igual que BlockEditor)
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

    // Desar amb Ctrl+S / Cmd+S
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

    // Detectar selecció de shape amb pageId al metadata
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
                        title: shape.meta.pageTitle || 'Pàgina',
                    });
                    return;
                }
            }
            setSelectedPage(null);
        };

        // Comprovar immediatament
        checkSelection();

        // Comprovar en canvis
        const unsub = editor.store.listen(() => {
            setTimeout(checkSelection, 50);
        });

        return () => unsub();
    }, [editorRef.current, isLoading]);

    // Registrar els handlers de drag & drop amb fase de captura
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

            // Verificar que el drop és dins del wrapper del tldraw
            const wrapper = wrapperRef.current;
            if (!wrapper || !wrapper.contains(e.target)) return;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            try {
                const noteData = JSON.parse(noteDataString);

                // Convertir coordenades de pantalla a coordenades del canvas
                const point = editor.screenToPage({
                    x: e.clientX,
                    y: e.clientY,
                });

                const shapeId = createShapeId();

                // Crear una forma de nota amb el títol i metadata de la pàgina
                editor.createShape({
                    id: shapeId,
                    type: 'note',
                    x: point.x - 100,
                    y: point.y - 50,
                    props: {
                        color: 'blue',
                        size: 'm',
                        font: 'sans',
                        richText: toRichText(noteData.title || 'Pàgina sense títol'),
                    },
                    meta: {
                        pageId: noteData.id,
                        pageTitle: noteData.title || 'Pàgina sense títol',
                    },
                });

                // Seleccionar el shape creat per mostrar els botons
                editor.select(shapeId);

                toast.success(`Pàgina "${noteData.title}" afegida al llenç`);
            } catch (err) {
                console.error("Error afegint pàgina al dibuix:", err);
                toast.error("Error afegint pàgina");
            }
        };

        document.addEventListener('dragover', dragOver, true);
        document.addEventListener('drop', drop, true);

        return () => {
            document.removeEventListener('dragover', dragOver, true);
            document.removeEventListener('drop', drop, true);
        };
    }, []);

    return (
        <div className="flex flex-col h-full w-full">
            {/* Capçalera */}
            <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200 shrink-0">
                <h2 className="text-sm font-semibold text-slate-700 truncate">
                    {title || 'Dibuix sense títol'}
                </h2>
                <button
                    onClick={onClose}
                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
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

                {/* Panel d'accions per a pàgines seleccionades */}
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
