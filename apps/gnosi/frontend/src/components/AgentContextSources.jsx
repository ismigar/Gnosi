import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, FileText, Paperclip, Layers, Globe, Landmark, X, Plus, Loader2 } from 'lucide-react';
import axios from 'axios';
import { toast } from '../lib/toast';

/**
 * Picker for the sources attached to a Cognition agent's context.
 *
 * The value is a list of REFERENCES ({id, type, ref, label}), never content: a
 * whole vault or database does not fit in a context window, so the agent reads
 * them on demand through its scoped tools. See directive
 * `agent_context_sources.md`.
 *
 * External files are uploaded into the vault's `Assets/` instead of being
 * referenced by absolute path: a disk path breaks when the file moves (OneDrive)
 * and the assets endpoint refuses symlinks pointing outside `Assets/`.
 */

const KIND_ICON = {
    vault: Layers,
    database: Database,
    table: Database,
    page: FileText,
    file: Paperclip,
    url: Globe,
    source: Landmark,
};

const newRefId = () => `ctx-${Math.random().toString(36).slice(2, 10)}`;

export default function AgentContextSources({ value, onChange }) {
    const { t } = useTranslation();
    const refs = useMemo(() => (Array.isArray(value) ? value : []), [value]);
    // Which picker list is open: 'table' | 'page' | 'source' | null.
    const [picking, setPicking] = useState(null);
    const [query, setQuery] = useState('');
    const [tables, setTables] = useState(null);
    const [pages, setPages] = useState(null);
    const [externalSources, setExternalSources] = useState(null);
    // Inline URL field: a window.prompt cannot be styled, validated or tested.
    const [urlDraft, setUrlDraft] = useState(null);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (picking === 'table' && tables === null) {
            axios.get('/api/vault/tables')
                .then(res => setTables(res.data || []))
                .catch(err => {
                    console.error('Could not load the vault tables', err);
                    setTables([]);
                });
        }
        if (picking === 'page' && pages === null) {
            axios.get('/api/vault/pages')
                .then(res => setPages(res.data || []))
                .catch(err => {
                    console.error('Could not load the vault pages', err);
                    setPages([]);
                });
        }
        if (picking === 'source' && externalSources === null) {
            axios.get('/api/agent/context-sources')
                .then(res => setExternalSources(res.data || []))
                .catch(err => {
                    console.error('Could not load the external source catalogue', err);
                    setExternalSources([]);
                });
        }
    }, [picking, tables, pages, externalSources]);

    const addRef = (type, ref, label) => {
        if (refs.some(r => r.type === type && r.ref === ref)) {
            toast(t('settings.ai.context_already_added', "That source is already in the context."));
            return;
        }
        onChange([...refs, { id: newRefId(), type, ref, label }]);
        setPicking(null);
        setQuery('');
    };

    const removeRef = (id) => onChange(refs.filter(r => r.id !== id));

    const handleUpload = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setUploading(true);
        try {
            const form = new FormData();
            form.append('file', file);
            // timeout 0: an upload into an online-only OneDrive folder can take
            // far longer than the global axios timeout.
            const res = await axios.post('/api/vault/assets/upload', form, { timeout: 0 });
            addRef('file', res.data.path, file.name);
        } catch (err) {
            console.error('Asset upload failed', err);
            toast.error(t('settings.ai.context_upload_error', "The file could not be uploaded."));
        } finally {
            setUploading(false);
        }
    };

    const addUrl = () => {
        const url = (urlDraft || '').trim();
        if (!url) return;
        // The backend refuses anything that is not public http(s); reject the
        // obvious cases here so the user gets the feedback while typing.
        if (!/^https?:\/\//i.test(url)) {
            toast.error(t('settings.ai.context_url_invalid', "The URL must start with http:// or https://"));
            return;
        }
        let label = url;
        try { label = new URL(url).hostname; } catch { /* keep the raw URL */ }
        addRef('url', url, label);
        setUrlDraft(null);
    };

    const options = useMemo(() => {
        const source = picking === 'table' ? tables : picking === 'source' ? externalSources : pages;
        if (!source) return null;
        const needle = query.trim().toLowerCase();
        const list = needle
            ? source.filter(item => String(item.title || item.name || '').toLowerCase().includes(needle))
            : source;
        return list.slice(0, 50);
    }, [picking, tables, pages, externalSources, query]);

    const addBtnStyle = {
        display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px',
        borderRadius: '12px', border: '1px solid var(--settings-border)',
        background: 'var(--settings-sidebar-bg)', color: 'var(--text-secondary)',
        fontSize: '0.82rem', cursor: 'pointer',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {refs.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {refs.map(ref => {
                        const Icon = KIND_ICON[ref.type] || FileText;
                        return (
                            <span key={ref.id} style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                padding: '6px 10px', borderRadius: '10px', fontSize: '0.8rem',
                                background: 'var(--settings-sidebar-bg)',
                                border: '1px solid var(--settings-border)',
                            }}>
                                <Icon size={14} />
                                {ref.label}
                                <button
                                    onClick={() => removeRef(ref.id)}
                                    aria-label={t('settings.ai.context_remove_source', "Remove from context")}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--text-tertiary)' }}
                                >
                                    <X size={13} />
                                </button>
                            </span>
                        );
                    })}
                </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button style={addBtnStyle} onClick={() => { setPicking(picking === 'table' ? null : 'table'); setQuery(''); }}>
                    <Database size={14} /> {t('settings.ai.context_add_table', "Database")}
                </button>
                <button style={addBtnStyle} onClick={() => { setPicking(picking === 'page' ? null : 'page'); setQuery(''); }}>
                    <FileText size={14} /> {t('settings.ai.context_add_page', "Page")}
                </button>
                <button style={addBtnStyle} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    {uploading ? <Loader2 size={14} className="spin" /> : <Paperclip size={14} />}
                    {t('settings.ai.context_add_file', "File")}
                </button>
                <button
                    style={addBtnStyle}
                    onClick={() => addRef('vault', 'active', t('settings.ai.context_whole_vault', "Whole vault"))}
                >
                    <Layers size={14} /> {t('settings.ai.context_add_vault', "Whole vault")}
                </button>
                <button style={addBtnStyle} onClick={() => { setPicking(null); setUrlDraft(urlDraft === null ? '' : null); }}>
                    <Globe size={14} /> {t('settings.ai.context_add_url', 'URL')}
                </button>
                <button style={addBtnStyle} onClick={() => { setUrlDraft(null); setPicking(picking === 'source' ? null : 'source'); setQuery(''); }}>
                    <Landmark size={14} /> {t('settings.ai.context_add_external', "External source")}
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleUpload}
                    style={{ display: 'none' }}
                />
            </div>

            {urlDraft !== null && (
                <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                        className="gnosi-input"
                        autoFocus
                        value={urlDraft}
                        onChange={e => setUrlDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }}
                        placeholder={t('settings.ai.context_url_placeholder', 'https://...')}
                        style={{ flex: 1 }}
                    />
                    <button style={addBtnStyle} onClick={addUrl}>
                        <Plus size={14} /> {t('common.add', "Add")}
                    </button>
                </div>
            )}

            {picking && (
                <div style={{
                    border: '1px solid var(--settings-border)', borderRadius: '14px',
                    padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px',
                    background: 'var(--settings-bg)',
                }}>
                    <input
                        className="gnosi-input"
                        autoFocus
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder={t('settings.ai.context_search_placeholder', "Search...")}
                    />
                    <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                        {options === null && (
                            <span style={{ padding: '10px', color: 'var(--text-tertiary)', fontSize: '0.82rem' }}>
                                {t('common.loading', "Loading...")}
                            </span>
                        )}
                        {options?.length === 0 && (
                            <span style={{ padding: '10px', color: 'var(--text-tertiary)', fontSize: '0.82rem' }}>
                                {t('settings.ai.context_no_results', "No results.")}
                            </span>
                        )}
                        {options?.map(item => {
                            const label = item.title || item.name || item.label || item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => addRef(picking, item.id, label)}
                                    style={{
                                        textAlign: 'left', padding: '8px 10px', borderRadius: '10px',
                                        border: 'none', background: 'none', cursor: 'pointer',
                                        fontSize: '0.85rem', color: 'var(--text-primary)',
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                    }}
                                    className="hover-bg"
                                >
                                    <Plus size={13} /> {label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
