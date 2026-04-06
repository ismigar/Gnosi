
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function NodeDetailsPanel({ nodeId, isOpen, onClose, initialData }) {
    const { t } = useTranslation();
    const [data, setData] = useState(initialData || null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!isOpen || !nodeId) {
            setData(null);
            return;
        }

        // Use initialData as base immediately to show title/url while fetching content
        const baseData = initialData ? { ...initialData } : {};
        setData(baseData);

        setLoading(true);
        setError(null);

        fetch(`/api/node/${nodeId}`)
            .then(res => {
                if (!res.ok) throw new Error("Node not found");
                return res.json();
            })
            .then(serverData => {
                // Merge server data (content) with existing (initialData has url/label)
                // Priority: Server data > Initial Data
                setData(prev => ({ ...prev, ...serverData }));
            })
            .catch(err => {
                console.error(err);
                // Don't clear data if we have initialData, just show error toast or subtle message?
                // For now, setting error only if we have NO data.
                // Actually, let's keep the initial data visible even on error
                if (!initialData) setError(t('failed_to_load_node_details') || "Failed to load");
            })
            .finally(() => setLoading(false));

    }, [nodeId, isOpen, t, initialData]); // Include initialData in deps? Careful with ref stability. Actually, App.jsx creates it on every render.
    // Ideally we shouldn't rely on initialData changing. App.jsx passes it fresh.

    if (!isOpen) return null;

    // Use label as title if title is missing (common in graph data)
    const displayTitle = data?.title || data?.label || "Sense títol";

    return (
        <div className="node-details-panel" style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '400px',
            height: '100%',
            backgroundColor: 'var(--panel-bg, #fff)',
            boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
            zIndex: 1000,
            padding: '20px',
            overflowY: 'auto',
            transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.3s ease-in-out',
            borderLeft: '1px solid var(--border-color, #eee)',
            color: 'var(--text-color, #333)'
        }}>
            {/* Top Actions: Close and Notion Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '10px', gap: '10px' }}>
                {data?.url && (
                    <a
                        href={data.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            textDecoration: 'none',
                            fontSize: '1.2rem',
                            cursor: 'pointer',
                            opacity: 0.7
                        }}
                        title="Obrir a Notion"
                    >
                        ↗
                    </a>
                )}
                <button
                    onClick={onClose}
                    style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '1.5rem',
                        cursor: 'pointer',
                        color: 'inherit',
                        padding: 0,
                        lineHeight: 1
                    }}
                >
                    &times;
                </button>
            </div>

            {loading && !data && <div style={{ marginTop: '40px', textAlign: 'center' }}>Carregant... ⏳</div>}

            {error && !data && (
                <div style={{ marginTop: '40px', color: 'red', textAlign: 'center' }}>
                    {error}
                </div>
            )}

            {data && (
                <div>
                    {/* Header */}
                    <div style={{ marginBottom: '20px' }}>
                        <h2 style={{ margin: '0 0 10px 0', fontSize: '1.5rem' }}>
                            {displayTitle}
                        </h2>

                        {/* Media Preview (New) */}
                        {(data.kind === 'media' || data.url?.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i)) && (
                            <div style={{ marginBottom: '20px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #eee' }}>
                                <img 
                                    src={data.url} 
                                    alt={displayTitle} 
                                    style={{ width: '100%', height: 'auto', display: 'block' }}
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            </div>
                        )}

                        {/* Meta Tags */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '15px' }}>
                            {data.tags && data.tags.map(tag => (
                                <span key={typeof tag === 'string' ? tag : tag.name || tag} style={{
                                    backgroundColor: '#e0e0e0',
                                    color: '#333',
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    fontSize: '0.8rem'
                                }}>
                                    #{typeof tag === 'string' ? tag : tag.name || tag}
                                </span>
                            ))}
                        </div>

                        {data.last_edited_time && (
                            <div style={{ fontSize: '0.8rem', color: '#888' }}>
                                Actualitzat: {new Date(data.last_edited_time).toLocaleDateString()}
                            </div>
                        )}
                    </div>

                    {/* Content Body */}
                    {loading && <div style={{ marginBottom: '20px', color: '#aaa' }}>Acabant de carregar contingut...</div>}

                    <div className="markdown-body" style={{
                        lineHeight: '1.6',
                        fontSize: '0.95rem',
                        whiteSpace: 'pre-wrap'
                    }}>
                        {data.content ? data.content : (!loading && <em style={{ color: '#888' }}>Sense contingut...</em>)}
                    </div>
                </div>
            )}
        </div>
    );
}

