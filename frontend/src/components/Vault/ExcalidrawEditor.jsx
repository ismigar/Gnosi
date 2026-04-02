import React, { useState, useEffect, useCallback, Component } from 'react';
import { Excalidraw, exportToSvg, serializeAsJSON, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import axios from 'axios';
import { Loader2, Save, X, Maximize2, Minimize2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTheme } from '../../hooks/useTheme';
import { BlockEditor } from './BlockEditor';
import './ExcalidrawEditor.css';

class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 20, color: 'red', background: '#ffebee', height: '100%', overflow: 'auto' }}>
                    <h2>Excalidraw Crash</h2>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error?.stack || this.state.error?.toString()}</pre>
                </div>
            );
        }
        return this.props.children;
    }
}

const API_BASE_URL = '/api/vault';

const EmbeddedNote = ({ noteId }) => {
    const [noteData, setNoteData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchNote = async () => {
            try {
                const res = await axios.get(`${API_BASE_URL}/pages/${noteId}`);
                setNoteData(res.data);
            } catch (err) {
                console.error("Error fetching embedded note:", err);
                setError(err);
            }
        };
        fetchNote();
    }, [noteId]);

    if (error) return <div className="p-4 text-red-500 text-sm">Error carregant nota.</div>;
    if (!noteData) return <div className="p-4 text-slate-400 text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Carregant contingut...</div>;

    return (
        <BlockEditor
            noteFilename={noteId}
            initialContent={noteData.content}
            initialMetadata={noteData.metadata}
            isEmbedded={true}
            onNoteSelect={() => { }}
        />
    );
};

const ExcalidrawEditor = ({ drawingId, title: initialTitle, onClose, onSaveSuccess }) => {
    const { effectiveTheme } = useTheme();
    const [excalidrawAPI, setExcalidrawAPI] = useState(null);
    const [initialData, setInitialData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [title, setTitle] = useState(initialTitle || 'Nou Dibuix');

    const overlayContainerRef = React.useRef(null);
    const [dropTick, setDropTick] = useState(0);

    // Carregar dades inicials
    useEffect(() => {
        const fetchDrawing = async () => {
            try {
                setLoading(true);
                const response = await axios.get(`${API_BASE_URL}/drawings/${drawingId}`);
                let payload = response.data;

                // Auto-repair corrupted drawings on load
                const elementsArray = payload.elements || payload.data?.elements;
                if (elementsArray && Array.isArray(elementsArray)) {
                    const repairedElements = elementsArray.map(el => {
                        // 1. Fix float seeds that crash Rough.js
                        if (el.seed && !Number.isInteger(el.seed)) {
                            el.seed = Math.floor(Math.random() * 2147483648);
                        }
                        // 2. Fix legacy types (embeddable from previous attempts)
                        if (el.type === "embeddable" && el.link?.startsWith('gnosi-note://')) {
                            el.type = "rectangle";
                            el.customData = { gnosiNoteId: el.link.replace('gnosi-note://', '') };
                            el.roundness = { type: 3 };
                            delete el.link;
                        }
                        return el;
                    });
                    if (payload.elements) payload.elements = repairedElements;
                    if (payload.data?.elements) payload.data.elements = repairedElements;
                }

                // CRITICAL FIX: JSON.stringify turns standard Excalidraw Maps (like collaborators) into {}.
                // When we pass {} back to initialData, Excalidraw crashes trying to call `.forEach` on it.
                // We must strip `collaborators` from the loaded appState to prevent this crash.
                const stateData = payload.data || payload;
                if (stateData.appState && stateData.appState.collaborators) {
                    delete stateData.appState.collaborators;
                }

                setInitialData(stateData);
                if (payload.metadata?.title || payload.title) {
                    setTitle(payload.metadata?.title || payload.title);
                }
            } catch (error) {
                if (error.response?.status === 404) {
                    // Si no existeix, inicialitzem buit
                    setInitialData({ 
                        elements: [], 
                        appState: { 
                            viewBackgroundColor: effectiveTheme === 'dark' ? "#121212" : "#ffffff" 
                        }, 
                        files: {} 
                    });
                } else {
                    toast.error("Error carregant el dibuix");
                    console.error(error);
                }
            } finally {
                setLoading(false);
            }
        };

        if (drawingId) {
            fetchDrawing();
        }
    }, [drawingId]);

    // Funció per guardar
    const handleSave = useCallback(async (elements, appState, files) => {
        if (!drawingId) return;

        setSaving(true);
        try {
            await axios.put(`${API_BASE_URL}/drawings/${drawingId}`, {
                title: title,
                data: { elements, appState, files },
                metadata: {}
            });
            if (onSaveSuccess) onSaveSuccess();
        } catch (error) {
            console.error("Error auto-saving drawing:", error);
        } finally {
            setSaving(false);
        }
    }, [drawingId, title, onSaveSuccess]);

    // Debounce save (manual o automàtic al tancar)
    const triggerSave = () => {
        if (excalidrawAPI) {
            const elements = excalidrawAPI.getSceneElements();
            const appState = excalidrawAPI.getAppState();
            const files = excalidrawAPI.getFiles();
            handleSave(elements, appState, files);
            toast.success("Dibuix desat");
        }
    };

    // Gestionar el Drag & Drop de notes al llenç
    const handleDrop = useCallback((e) => {
        console.log("DROP CAPTURED", e.dataTransfer.types);
        if (!excalidrawAPI) {
            console.error("No Excalidraw API");
            return;
        }

        const noteDataString = e.dataTransfer.getData('application/gnosi-note');
        if (!noteDataString) {
            console.log("No valid payload for gnosi-note");
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        try {
            const noteData = JSON.parse(noteDataString);

            // Obtenir la posició (intent de traduir pantalles a coordenades internes)
            // L'API d'Excalidraw inclou `screenToClient` o similiar si exportéssim o usem ref.
            // Una aproximació simple si tenim la posició central del viewport:
            const appState = excalidrawAPI.getAppState();
            const x = (e.clientX - appState.offsetLeft - appState.scrollX) / appState.zoom.value;
            const y = (e.clientY - appState.offsetTop - appState.scrollY) / appState.zoom.value;

            // Use the native converter to ensure 100% schema compliance (seed, index, ids, etc.)
            const elements = convertToExcalidrawElements([{
                type: "rectangle",
                x: x,
                y: y,
                width: 400,
                height: 500,
                customData: {
                    gnosiNoteId: noteData.id,
                },
                backgroundColor: "transparent",
                strokeColor: "#e2e8f0",
                fillStyle: "hachure",
                strokeWidth: 2,
                strokeStyle: "solid",
                roundness: { type: 3 },
            }]);

            const newElement = elements[0];

            const currentElements = excalidrawAPI.getSceneElements();
            excalidrawAPI.updateScene({ elements: [...currentElements, newElement] });

            setDropTick(prev => prev + 1);

            toast.success(`Nota afegida al llenç`);
        } catch (err) {
            console.error("Error processant nota al llenç:", err);
        }
    }, [excalidrawAPI]);

    const handleDragOver = (e) => {
        e.preventDefault(); // Necessari per permetre el drop
        e.dataTransfer.dropEffect = 'copy';
    };

    // Dibuixa l'overlay per als elements que tenen customData.gnosiNoteId
    const renderUIOverlays = () => {
        if (!excalidrawAPI) return null;

        const elements = excalidrawAPI.getSceneElements();
        const noteElements = elements.filter(el => el.customData?.gnosiNoteId && !el.isDeleted);

        if (noteElements.length === 0) return null;

        return noteElements.map(el => {
            const handleEditorInteraction = (e) => {
                e.stopPropagation();
            };

            return (
                <div
                    key={el.id}
                    id={`gnosi-overlay-${el.id}`}
                    style={{
                        position: 'absolute',
                        left: `-9999px`, // Initial offscreen
                        top: `-9999px`,
                        width: `0px`,
                        height: `0px`,
                        zIndex: 10,
                        pointerEvents: 'none', // Permet fer click "a través" de les vores
                        padding: '12px' // Deixem 12px de marge interactuable (agafable de la caixa d'Excalidraw)
                    }}
                >
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            backgroundColor: 'var(--bg-primary)',
                            border: '1px solid var(--border-primary)',
                            borderRadius: '8px',
                            overflow: 'auto',
                            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                            pointerEvents: 'auto' // Només l'interior captura events
                        }}
                        onPointerDown={handleEditorInteraction}
                        onKeyDown={handleEditorInteraction}
                        onWheel={handleEditorInteraction}
                    >
                        <EmbeddedNote noteId={el.customData.gnosiNoteId} />
                    </div>
                </div>
            );
        });
    };

    // Sincronitza posicions a 60fps independentment de l'estat de React per evitar cracs
    useEffect(() => {
        if (!excalidrawAPI || !overlayContainerRef.current) return;

        let animationFrameId;

        const syncPositions = () => {
            const appState = excalidrawAPI.getAppState();
            const elements = excalidrawAPI.getSceneElementsIncludingDeleted ? excalidrawAPI.getSceneElementsIncludingDeleted() : excalidrawAPI.getSceneElements();
            const zoom = appState.zoom.value;

            // Ens assegurem de matar completament les overlays eliminades de l'escena
            const allOverlays = document.querySelectorAll('[id^="gnosi-overlay-"]');

            const activeElementIds = new Set();
            elements.forEach(el => {
                if (el.customData?.gnosiNoteId && !el.isDeleted) {
                    activeElementIds.add(el.id);
                }
            });

            allOverlays.forEach(node => {
                const elementId = node.id.replace('gnosi-overlay-', '');
                if (!activeElementIds.has(elementId)) {
                    node.style.display = 'none';
                }
            });

            // Ajusta mida i posició
            elements.forEach(el => {
                if (el.customData?.gnosiNoteId && !el.isDeleted) {
                    const domNode = document.getElementById(`gnosi-overlay-${el.id}`);
                    if (domNode) {
                        const x = (el.x + appState.scrollX) * zoom;
                        const y = (el.y + appState.scrollY) * zoom;
                        const w = el.width * zoom;
                        const h = el.height * zoom;

                        // Només calculem i ajustem si està en pantalla
                        if (x + w < -100 || y + h < -100 || x > window.innerWidth + 100 || y > window.innerHeight + 100) {
                            domNode.style.display = 'none';
                        } else {
                            domNode.style.display = 'block';
                            domNode.style.left = `${x}px`;
                            domNode.style.top = `${y}px`;
                            domNode.style.width = `${w}px`;
                            domNode.style.height = `${h}px`;
                        }
                    }
                }
            });

            animationFrameId = requestAnimationFrame(syncPositions);
        };

        syncPositions();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [excalidrawAPI]);

    if (loading) {
        return (
            <div className="excalidraw-loader">
                <Loader2 className="animate-spin" size={48} />
                <p>Carregant editor de dibuix...</p>
            </div>
        );
    }

    return (
        <div className={`excalidraw-editor-container ${isFullScreen ? 'full-screen' : ''}`}>
            <div className="excalidraw-editor-header">
                <div className="header-left">
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Títol del dibuix..."
                        className="drawing-title-input"
                    />
                    {saving && <span className="saving-indicator"><Loader2 className="animate-spin-fast" size={14} /> Desant...</span>}
                </div>
                <div className="header-actions">
                    <button onClick={triggerSave} disabled={saving} title="Desar" className="action-btn">
                        <Save size={18} />
                    </button>
                    <button onClick={() => setIsFullScreen(!isFullScreen)} title={isFullScreen ? "Sortir de pantalla completa" : "Pantalla completa"} className="action-btn">
                        {isFullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </button>
                    <button onClick={onClose} title="Tancar" className="action-btn close-btn">
                        <X size={18} />
                    </button>
                </div>
            </div>

            <div
                className="excalidraw-wrapper"
                onDropCapture={handleDrop}
                onDragOverCapture={handleDragOver}
            >
                <ErrorBoundary>
                    <Excalidraw
                        excalidrawAPI={(api) => setExcalidrawAPI(api)}
                        initialData={initialData}
                        langCode="ca-ES"
                        theme={effectiveTheme}
                        renderTopRightUI={() => null} // Només placeholder, usem l'overlay absolut
                        UIOptions={{
                            canvasActions: {
                                loadScene: false,
                                saveAsImage: true,
                                export: { saveFileToDisk: true },
                                theme: true,
                            }
                        }}
                    />
                </ErrorBoundary>

                {/* Custom Overlay per les Notes construït fora del llenç natiu per no col·lapsar-lo */}
                <div ref={overlayContainerRef} className="excalidraw-gnosi-overlays" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                    <div style={{ position: 'relative', width: '100%', height: '100%', pointerEvents: 'auto' }}>
                        {renderUIOverlays()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ExcalidrawEditor;
