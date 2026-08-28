import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, FileText, Paperclip, Layers, Globe, Landmark, X, Plus, Loader2, Blocks, SlidersHorizontal } from 'lucide-react';
import axios from '../shared/api/legacy-http';
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
    internal: Blocks,
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
    const [internalSources, setInternalSources] = useState(null);
    const [editingRefId, setEditingRefId] = useState(null);
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
        if ((picking === 'internal' || refs.some(ref => ref.type === 'internal')) && internalSources === null) {
            axios.get('/api/agent/internal-sources')
                .then(res => setInternalSources(res.data || []))
                .catch(err => {
                    console.error('Could not load the Gnosi source catalogue', err);
                    setInternalSources([]);
                });
        }
    }, [picking, tables, pages, externalSources, internalSources, refs]);

    const addRef = (type, ref, label, extras = {}) => {
        if (refs.some(r => r.type === type && r.ref === ref)) {
            toast(t('settings.ai.context_already_added', "That source is already in the context."));
            return;
        }
        const id = newRefId();
        onChange([...refs, { id, type, ref, label, ...extras }]);
        setPicking(null);
        setQuery('');
        if (type === 'internal') setEditingRefId(id);
    };

    const removeRef = (id) => {
        onChange(refs.filter(r => r.id !== id));
        if (editingRefId === id) setEditingRefId(null);
    };
    const updateRef = (id, patch) => onChange(refs.map(ref => (
        ref.id === id ? { ...ref, ...patch } : ref
    )));

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
        const source = picking === 'table'
            ? tables
            : picking === 'source'
                ? externalSources
                : picking === 'internal'
                    ? internalSources
                    : pages;
        if (!source) return null;
        const needle = query.trim().toLowerCase();
        const list = needle
            ? source.filter(item => String(item.title || item.name || '').toLowerCase().includes(needle))
            : source;
        return list.slice(0, 50);
    }, [picking, tables, pages, externalSources, internalSources, query]);

    const editingRef = refs.find(ref => ref.id === editingRefId && ref.type === 'internal');
    const editingDescriptor = internalSources?.find(source => source.id === editingRef?.ref);
    const internalLabel = (sourceId, fallback) => ({
        reader: t('settings.ai.context_internal_reader', 'Reader'),
        mail: t('settings.ai.context_internal_mail', 'Mail'),
        calendar: t('settings.ai.context_internal_calendar', 'Calendars'),
        contacts: t('settings.ai.context_internal_contacts', 'Contacts'),
        planning: t('settings.ai.context_internal_planning', 'Planning'),
        references: t('settings.ai.context_internal_references', 'References'),
        social: t('settings.ai.context_internal_social', 'Social'),
        meetings: t('settings.ai.context_internal_meetings', 'Meetings'),
        notion: t('settings.ai.context_internal_notion', 'Notion'),
    }[sourceId] || fallback || sourceId);
    const selectedValues = (event) => Array.from(event.target.selectedOptions, option => option.value);
    const setScope = (patch) => updateRef(editingRef.id, {
        scope: { ...(editingRef.scope || {}), ...patch },
    });

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
                                {ref.type === 'internal' && (
                                    <button
                                        onClick={() => setEditingRefId(editingRefId === ref.id ? null : ref.id)}
                                        aria-label={t('settings.ai.context_configure_source', 'Configure source scope')}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--text-tertiary)' }}
                                    >
                                        <SlidersHorizontal size={13} />
                                    </button>
                                )}
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
                <button style={addBtnStyle} onClick={() => { setUrlDraft(null); setPicking(picking === 'internal' ? null : 'internal'); setQuery(''); }}>
                    <Blocks size={14} /> {t('settings.ai.context_add_internal', 'Gnosi source')}
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
                            const label = picking === 'internal'
                                ? internalLabel(item.id, item.name)
                                : item.title || item.name || item.label || item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => addRef(
                                        picking,
                                        item.id,
                                        label,
                                        picking === 'internal' ? { scope: item.scope || {} } : {},
                                    )}
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

            {editingRef && editingDescriptor && (
                <div style={{
                    border: '1px solid var(--settings-border)', borderRadius: '14px',
                    padding: '14px', display: 'grid', gap: '12px',
                    background: 'var(--settings-bg)',
                }}>
                    <div>
                        <strong style={{ fontSize: '0.88rem' }}>
                            {t('settings.ai.context_scope_title', '{{source}} scope', { source: internalLabel(editingRef.ref, editingRef.label) })}
                        </strong>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                            {t('settings.ai.context_scope_desc', 'The agent can only search and read records inside this scope. Actions are governed separately.')}
                        </p>
                    </div>

                    {editingRef.ref === 'reader' && (
                        <>
                            <label style={{ fontSize: '0.82rem' }}>
                                <input
                                    type="checkbox"
                                    checked={editingRef.scope?.unread_only !== false}
                                    onChange={event => setScope({ unread_only: event.target.checked })}
                                />{' '}{t('settings.ai.context_reader_unread', 'Unread articles only')}
                            </label>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_reader_feeds', 'Feeds')}
                                <select
                                    multiple
                                    className="gnosi-input"
                                    value={(editingRef.scope?.source_ids || []).map(String)}
                                    onChange={event => setScope({ source_ids: selectedValues(event).map(Number) })}
                                    style={{ width: '100%', minHeight: '96px', marginTop: '5px' }}
                                >
                                    {(editingDescriptor.options?.sources || []).map(source => (
                                        <option key={source.id} value={source.id}>{source.name}</option>
                                    ))}
                                </select>
                            </label>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_categories', 'Categories')}
                                <select
                                    multiple
                                    className="gnosi-input"
                                    value={editingRef.scope?.categories || []}
                                    onChange={event => setScope({ categories: selectedValues(event) })}
                                    style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}
                                >
                                    {(editingDescriptor.options?.categories || []).map(category => (
                                        <option key={category} value={category}>{category}</option>
                                    ))}
                                </select>
                            </label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <label style={{ fontSize: '0.78rem' }}>
                                    {t('settings.ai.context_date_from', 'From')}
                                    <input
                                        type="date"
                                        className="gnosi-input"
                                        value={(editingRef.scope?.date_from || '').slice(0, 10)}
                                        onChange={event => setScope({ date_from: event.target.value })}
                                        style={{ width: '100%', marginTop: '5px' }}
                                    />
                                </label>
                                <label style={{ fontSize: '0.78rem' }}>
                                    {t('settings.ai.context_date_to', 'To')}
                                    <input
                                        type="date"
                                        className="gnosi-input"
                                        value={(editingRef.scope?.date_to || '').slice(0, 10)}
                                        onChange={event => setScope({ date_to: event.target.value })}
                                        style={{ width: '100%', marginTop: '5px' }}
                                    />
                                </label>
                            </div>
                            <label style={{ fontSize: '0.82rem' }}>
                                <input
                                    type="checkbox"
                                    checked={!!editingRef.scope?.include_full_content}
                                    onChange={event => setScope({ include_full_content: event.target.checked })}
                                />{' '}{t('settings.ai.context_full_content', 'Include full article bodies in exact reads')}
                            </label>
                        </>
                    )}

                    {(editingRef.ref === 'mail' || editingRef.ref === 'calendar') && (
                        <label style={{ fontSize: '0.78rem' }}>
                            {t('settings.ai.context_accounts', 'Accounts')}
                            <select
                                multiple
                                className="gnosi-input"
                                value={editingRef.scope?.accounts || []}
                                onChange={event => setScope({ accounts: selectedValues(event) })}
                                style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}
                            >
                                {(editingDescriptor.options?.accounts || []).map(account => (
                                    <option key={account} value={account}>{account}</option>
                                ))}
                            </select>
                        </label>
                    )}

                    {editingRef.ref === 'mail' && (
                        <label style={{ fontSize: '0.78rem' }}>
                            {t('settings.ai.context_mail_folder', 'Folder')}
                            <input
                                className="gnosi-input"
                                value={editingRef.scope?.folder || 'INBOX'}
                                onChange={event => setScope({ folder: event.target.value })}
                                style={{ width: '100%', marginTop: '5px' }}
                            />
                        </label>
                    )}

                    {editingRef.ref === 'calendar' && (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <label style={{ fontSize: '0.78rem' }}>
                                    {t('settings.ai.context_date_from', 'From')}
                                    <input type="date" className="gnosi-input" value={(editingRef.scope?.date_from || '').slice(0, 10)} onChange={event => setScope({ date_from: event.target.value })} style={{ width: '100%', marginTop: '5px' }} />
                                </label>
                                <label style={{ fontSize: '0.78rem' }}>
                                    {t('settings.ai.context_date_to', 'To')}
                                    <input type="date" className="gnosi-input" value={(editingRef.scope?.date_to || '').slice(0, 10)} onChange={event => setScope({ date_to: event.target.value })} style={{ width: '100%', marginTop: '5px' }} />
                                </label>
                            </div>
                            <label style={{ fontSize: '0.82rem' }}>
                                <input type="checkbox" checked={editingRef.scope?.include_vault !== false} onChange={event => setScope({ include_vault: event.target.checked })} />{' '}
                                {t('settings.ai.context_calendar_vault', 'Include Vault calendar events')}
                            </label>
                        </>
                    )}

                    {editingRef.ref === 'contacts' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_contact_sources', 'Contact sources')}
                                <select multiple className="gnosi-input" value={editingRef.scope?.sources || []} onChange={event => setScope({ sources: selectedValues(event) })} style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}>
                                    {(editingDescriptor.options?.sources || []).map(source => <option key={source} value={source}>{source}</option>)}
                                </select>
                            </label>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_contact_types', 'Contact types')}
                                <select multiple className="gnosi-input" value={editingRef.scope?.types || []} onChange={event => setScope({ types: selectedValues(event) })} style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}>
                                    {(editingDescriptor.options?.types || []).map(type => <option key={type} value={type}>{type}</option>)}
                                </select>
                            </label>
                        </div>
                    )}

                    {editingRef.ref === 'planning' && (
                        <>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_planning_entities', 'Planning entities')}
                                <select multiple className="gnosi-input" value={editingRef.scope?.entity_types || []} onChange={event => setScope({ entity_types: selectedValues(event) })} style={{ width: '100%', minHeight: '92px', marginTop: '5px' }}>
                                    {(editingDescriptor.options?.entity_types || []).map(type => <option key={type} value={type}>{type}</option>)}
                                </select>
                            </label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <label style={{ fontSize: '0.78rem' }}>
                                    {t('settings.ai.context_planning_projects', 'Projects')}
                                    <select multiple className="gnosi-input" value={editingRef.scope?.project_ids || []} onChange={event => setScope({ project_ids: selectedValues(event) })} style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}>
                                        {(editingDescriptor.options?.projects || []).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                                    </select>
                                </label>
                                <label style={{ fontSize: '0.78rem' }}>
                                    {t('settings.ai.context_planning_resources', 'Resources')}
                                    <select multiple className="gnosi-input" value={editingRef.scope?.resource_ids || []} onChange={event => setScope({ resource_ids: selectedValues(event) })} style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}>
                                        {(editingDescriptor.options?.resources || []).map(resource => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                                    </select>
                                </label>
                            </div>
                            <label style={{ fontSize: '0.82rem' }}>
                                <input type="checkbox" checked={!!editingRef.scope?.include_inactive} onChange={event => setScope({ include_inactive: event.target.checked })} />{' '}
                                {t('settings.ai.context_planning_inactive', 'Include inactive resources')}
                            </label>
                        </>
                    )}

                    {editingRef.ref === 'references' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_reference_types', 'Reference types')}
                                <select multiple className="gnosi-input" value={editingRef.scope?.item_types || []} onChange={event => setScope({ item_types: selectedValues(event) })} style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}>
                                    {(editingDescriptor.options?.item_types || []).map(type => <option key={type} value={type}>{type}</option>)}
                                </select>
                            </label>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_reference_languages', 'Languages')}
                                <select multiple className="gnosi-input" value={editingRef.scope?.languages || []} onChange={event => setScope({ languages: selectedValues(event) })} style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}>
                                    {(editingDescriptor.options?.languages || []).map(language => <option key={language} value={language}>{language}</option>)}
                                </select>
                            </label>
                        </div>
                    )}

                    {editingRef.ref === 'social' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_social_networks', 'Networks')}
                                <select multiple className="gnosi-input" value={editingRef.scope?.networks || []} onChange={event => setScope({ networks: selectedValues(event) })} style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}>
                                    {(editingDescriptor.options?.networks || []).map(network => <option key={network} value={network}>{network}</option>)}
                                </select>
                            </label>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_social_statuses', 'Publication statuses')}
                                <select multiple className="gnosi-input" value={editingRef.scope?.statuses || []} onChange={event => setScope({ statuses: selectedValues(event) })} style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}>
                                    {(editingDescriptor.options?.statuses || []).map(status => <option key={status} value={status}>{status}</option>)}
                                </select>
                            </label>
                        </div>
                    )}

                    {editingRef.ref === 'meetings' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_date_from', 'From')}
                                <input type="date" className="gnosi-input" value={(editingRef.scope?.date_from || '').slice(0, 10)} onChange={event => setScope({ date_from: event.target.value })} style={{ width: '100%', marginTop: '5px' }} />
                            </label>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_date_to', 'To')}
                                <input type="date" className="gnosi-input" value={(editingRef.scope?.date_to || '').slice(0, 10)} onChange={event => setScope({ date_to: event.target.value })} style={{ width: '100%', marginTop: '5px' }} />
                            </label>
                        </div>
                    )}

                    {editingRef.ref === 'notion' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_notion_types', 'Object types')}
                                <select multiple className="gnosi-input" value={editingRef.scope?.object_types || []} onChange={event => setScope({ object_types: selectedValues(event) })} style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}>
                                    {(editingDescriptor.options?.object_types || []).map(type => <option key={type} value={type}>{type}</option>)}
                                </select>
                            </label>
                            <label style={{ fontSize: '0.78rem' }}>
                                {t('settings.ai.context_notion_databases', 'Databases')}
                                <select multiple className="gnosi-input" value={editingRef.scope?.database_ids || []} onChange={event => setScope({ database_ids: selectedValues(event) })} style={{ width: '100%', minHeight: '76px', marginTop: '5px' }}>
                                    {(editingDescriptor.options?.databases || []).map(database => <option key={database.id} value={database.id}>{database.name}</option>)}
                                </select>
                            </label>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
