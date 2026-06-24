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
import { toast } from '../../lib/toast';
import { X, Loader2, Eye, ExternalLink, Copy, AlertTriangle } from 'lucide-react';

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
        } catch {
            toast.error('Error carregant contingut');
        } finally {
            setLoading(false);
        }
    };

    const openInNewTab = () => {
        window.open(`/vault?page=${pageId}`, '_blank');
    };

    const copyId = async () => {
        // navigator.clipboard pot rebutjar (insecure context, permís denegat).
        // Sense `await` el toast.success es mostrava abans de saber el resultat.
        try {
            await navigator.clipboard.writeText(pageId);
            toast.success('ID copiat!');
        } catch {
            toast.error('No s\'ha pogut copiar l\'ID');
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
    // 'loading' | 'ready' | 'error' | 'incompatible' — el desat (autosave i
    // Ctrl+S) NOMÉS és possible a 'ready'. Si la càrrega falla o el snapshot
    // no s'aplica, desar significaria sobreescriure el dibuix real amb un
    // llenç buit (vegeu directiva tldraw_save_integrity.md).
    const [loadState, setLoadState] = useState(drawingId ? 'loading' : 'ready');
    const [retryTick, setRetryTick] = useState(0);
    const editorRef = useRef(null);
    const wrapperRef = useRef(null);
    const autosaveTimerRef = useRef(null);
    const [selectedPage, setSelectedPage] = useState(null);

    // Reset síncron si canvia el dibuix sense remuntar (patró React
    // "adjusting state when props change"): cap render no pot veure 'ready'
    // amb l'estat del dibuix anterior — l'autosave quedaria armat amb un
    // store que encara té el contingut antic. (El consumidor normal posa
    // key={drawingId} i remunta, però això no ho podem garantir des d'aquí.)
    const [loadedDrawingId, setLoadedDrawingId] = useState(drawingId);
    if (loadedDrawingId !== drawingId) {
        setLoadedDrawingId(drawingId);
        setLoadState(drawingId ? 'loading' : 'ready');
    }

    // Carregar dibuix existent
    useEffect(() => {
        if (!drawingId) return; // sense id no hi ha persistència (estat 'ready' inicial)

        const controller = new AbortController();
        axios.get(`/api/vault/drawings/${drawingId}`, { signal: controller.signal })
            .then(res => {
                if (controller.signal.aborted) return;
                const data = res.data;
                // loadSnapshot NO valida el format: amb un objecte sense claus
                // store/document/session no fa res (no-op silenciós) — és el cas
                // dels dibuixos legacy .excalidraw.json. Validem abans de cridar-lo.
                const isPlainObject = data && typeof data === 'object' && !Array.isArray(data);
                // {} és el data inicial amb què el dashboard crea un dibuix nou
                const isEmptyInitial = isPlainObject && Object.keys(data).length === 0;
                const isTldrawSnapshot = isPlainObject &&
                    ('store' in data || 'document' in data || 'session' in data);

                if (!isEmptyInitial && !isTldrawSnapshot) {
                    console.error(`Dibuix ${drawingId} amb format no compatible amb tldraw (legacy .excalidraw?)`);
                    setLoadState('incompatible');
                    return;
                }
                try {
                    if (isTldrawSnapshot) loadSnapshot(store, data);
                    setLoadState('ready');
                } catch (e) {
                    console.error("Error aplicant el snapshot del dibuix:", e);
                    setLoadState('incompatible');
                }
            })
            .catch((err) => {
                if (controller.signal.aborted || err?.name === 'CanceledError' || axios.isCancel?.(err)) return;
                if (err?.response?.status === 404) {
                    // El dibuix no existeix encara → pissarra buida nova (es pot desar)
                    setLoadState('ready');
                } else {
                    // 500, xarxa, fitxer online-only de OneDrive... el dibuix
                    // existeix però no l'hem pogut llegir: bloquegem el desat.
                    console.error("Error carregant dibuix:", err);
                    setLoadState('error');
                }
            });

        return () => {
            controller.abort();
        };
    }, [drawingId, store, retryTick]);

    // Guardar dibuix (auto-save)
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
            console.error("Error al desar el dibuix:", err);
        }
    }, [drawingId, store, title, onSaveSuccess, loadState]);

    // Autosave automàtic cada 1 segon si hi ha canvis (igual que BlockEditor)
    useEffect(() => {
        if (!drawingId || loadState !== 'ready') return;

        // Només canvis de document fets per l'usuari: càmera i selecció són
        // scope 'session' i no han de programar cap PUT.
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

    // Flush en desmuntar: si queda un autosave PENDENT (un canvi fet menys d'1s
    // abans de tancar el dibuix o navegar fora), desa'l abans que el component
    // desaparegui. Sense això, el cleanup de dalt només cancel·la el timer i
    // l'últim traç es perdia. Ref a la darrera `handleSave` perquè l'effect
    // d'unmount (deps buides) no en capturi una de vella amb un `title` ranci.
    const handleSaveRef = useRef(handleSave);
    useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);
    useEffect(() => () => {
        if (autosaveTimerRef.current) {
            clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
            handleSaveRef.current?.();
        }
    }, []);

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
        // Depèn de loadState: quan passa a 'ready' es munta <Tldraw> i onMount
        // (efecte del fill, s'executa abans que aquest) ja ha omplert editorRef.
    }, [loadState]);

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
                    className="gnosi-close-btn"
                    aria-label="Tancar"
                >
                    <X />
                </button>
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
                    <Tldraw
                        store={store}
                        hideUi={false}
                        inferDarkMode
                        onMount={(editor) => { editorRef.current = editor; }}
                    />
                )}

                {/* Càrrega fallida o snapshot inaplicable: bloquegem el llenç
                    perquè cap edició (ni l'autosave) sobreescrigui el fitxer real */}
                {(loadState === 'error' || loadState === 'incompatible') && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                        <div className="max-w-md mx-4 p-5 bg-white rounded-xl shadow-xl border border-amber-300 text-center">
                            <AlertTriangle size={28} className="mx-auto mb-3 text-amber-500" />
                            <p className="text-sm font-semibold text-slate-700 mb-1">
                                {loadState === 'error'
                                    ? 'No s\'ha pogut carregar el dibuix'
                                    : 'Format de dibuix no compatible'}
                            </p>
                            <p className="text-xs text-slate-500 mb-4">
                                {loadState === 'error'
                                    ? 'El desat està desactivat per no sobreescriure el dibuix original amb un llenç buit.'
                                    : 'Aquest dibuix té un format antic (Excalidraw) o desconegut. El desat està desactivat per protegir el fitxer original.'}
                            </p>
                            {loadState === 'error' && (
                                <button
                                    onClick={() => { setLoadState('loading'); setRetryTick(t => t + 1); }}
                                    className="px-4 py-2 text-xs font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 transition-colors"
                                >
                                    Torna-ho a provar
                                </button>
                            )}
                        </div>
                    </div>
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
