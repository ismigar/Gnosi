
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

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

        // A graph node is a Vault page: we request its content with
        // the real endpoint. It used to call `/api/node/{id}`, which doesn't exist in the
        // native backend → 404 on every click (panel with no content + error in the
        // console). Nodes that aren't pages (404) fall back to `initialData`.
        fetch(`/api/vault/pages/${encodeURIComponent(nodeId)}`)
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
    const displayTitle = data?.title || data?.label || t('common.untitled', "Untitled");

    return (
        <div className="node-details-panel" style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '400px',
            height: '100%',
            backgroundColor: 'var(--bg-primary)',
            boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
            zIndex: 1000,
            padding: '20px',
            overflowY: 'auto',
            transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
            transition: 'transform 0.3s ease-in-out',
            borderLeft: '1px solid var(--border-primary)',
            color: 'var(--text-primary)'
        }}>
            {/* Top Actions: Close */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '10px', gap: '10px' }}>
                <button
                    onClick={onClose}
                    className="gnosi-close-btn"
                    aria-label={t('graph.node_panel.close', "Close details")}
                >
                    <X />
                </button>
            </div>

            {loading && !data && <div style={{ marginTop: '40px', textAlign: 'center' }}>{t('graph.node_panel.loading', "Loading... ⏳")}</div>}

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
                            <div style={{ marginBottom: '20px', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-primary)' }}>
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
                                    backgroundColor: 'var(--bg-tertiary)',
                                    color: 'var(--text-primary)',
                                    padding: '2px 8px',
                                    borderRadius: '12px',
                                    fontSize: '0.8rem'
                                }}>
                                    #{typeof tag === 'string' ? tag : tag.name || tag}
                                </span>
                            ))}
                        </div>

                        {data.last_edited_time && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                                {t('graph.node_panel.updated', "Updated: {{date}}", { date: new Date(data.last_edited_time).toLocaleDateString() })}
                            </div>
                        )}
                    </div>

                    {/* Content Body */}
                    {loading && <div style={{ marginBottom: '20px', color: 'var(--text-tertiary)' }}>{t('graph.node_panel.loading_content', "Finishing loading content...")}</div>}

                    <div className="markdown-body" style={{
                        lineHeight: '1.6',
                        fontSize: '0.95rem',
                        whiteSpace: 'pre-wrap'
                    }}>
                        {data.content ? data.content : (!loading && <em style={{ color: 'var(--text-tertiary)' }}>{t('graph.node_panel.no_content', "No content...")}</em>)}
                    </div>
                </div>
            )}
        </div>
    );
}

