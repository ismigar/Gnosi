import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import {
    CheckCircle2, CircleAlert, Database, EyeOff, KeyRound, Pencil, Plus,
    RefreshCw, RotateCcw, Search, Trash2, Wifi,
} from 'lucide-react';

import ConfirmModal from './ConfirmModal';

const EMPTY_REPOSITORY = {
    id: '', name: '', kind: 'oai', base_url: '', metadata_prefix: 'oai_dc', set: '',
    sync_mode: 'incremental', tombstones: true, default_enabled: true,
    query_parameter: 'q', limit_parameter: 'limit', results_path: 'results',
    pagination: 'none', page_parameter: 'page', offset_parameter: 'offset',
    cursor_parameter: 'cursor', next_cursor_path: 'next_cursor',
    static_filters: {}, mapping: { title: 'title' },
};

const fieldStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--border-primary)', background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
};

function statusLabel(source, t) {
    if (source.kind === 'external') return t('literature.settings.external_only');
    if (source.kind === 'metric') return t('literature.settings.metric_only');
    if (source.credential_status === 'missing') return t('literature.settings.credential_missing');
    if (source.kind === 'oai' && !source.sync?.index_size) return t('literature.settings.index_empty');
    if (!source.implemented) return t('literature.settings.adapter_pending');
    return t('literature.settings.ready');
}

export default function ResourcesPluginConfig() {
    const { t } = useTranslation();
    const [configuration, setConfiguration] = useState({ sources: [], source_defaults: {}, hidden_sources: [], contact_email: '' });
    const [tables, setTables] = useState([]);
    const [referenceTable, setReferenceTable] = useState({ table_id: '', configured: false });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [showHidden, setShowHidden] = useState(false);
    const [repository, setRepository] = useState(EMPTY_REPOSITORY);
    const [showRepositoryForm, setShowRepositoryForm] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteIndex, setDeleteIndex] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [configResponse, tablesResponse, referenceResponse] = await Promise.all([
                axios.get('/api/vault/literature/configuration'),
                axios.get('/api/vault/tables'),
                axios.get('/api/vault/reference-table'),
            ]);
            setConfiguration(configResponse.data || {});
            setTables(Array.isArray(tablesResponse.data) ? tablesResponse.data : []);
            setReferenceTable(referenceResponse.data || { table_id: '', configured: false });
            setError('');
        } catch (requestError) {
            console.error('Could not load Resources plugin configuration:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.load_error'));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => { void reload(); }, [reload]);

    const saveConfiguration = async (patch) => {
        setBusy('configuration');
        setNotice('');
        try {
            const response = await axios.put('/api/vault/literature/configuration', patch);
            setConfiguration(response.data || {});
            setError('');
        } catch (requestError) {
            console.error('Could not save Resources plugin configuration:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.save_error'));
        } finally {
            setBusy('');
        }
    };

    const setReference = async (tableId) => {
        setBusy('reference');
        try {
            const response = tableId
                ? await axios.post('/api/vault/reference-table', { table_id: tableId })
                : await axios.delete('/api/vault/reference-table');
            setReferenceTable(response.data || { table_id: '', configured: false });
            setNotice(t('literature.settings.reference_saved'));
        } catch (requestError) {
            console.error('Could not update the Resources table:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.reference_error'));
        } finally { setBusy(''); }
    };

    const createReference = async () => {
        setBusy('reference');
        try {
            const response = await axios.post('/api/vault/reference-table/create', {});
            setReferenceTable(response.data || {});
            await reload();
            setNotice(t('literature.settings.reference_created'));
        } catch (requestError) {
            console.error('Could not create the Resources table:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.reference_error'));
        } finally { setBusy(''); }
    };

    const toggleSource = (source, enabled) => saveConfiguration({
        source_defaults: { ...(configuration.source_defaults || {}), [source.id]: enabled },
    });

    const toggleHidden = (source, hidden) => {
        const values = new Set(configuration.hidden_sources || []);
        if (hidden) values.add(source.id); else values.delete(source.id);
        return saveConfiguration({ hidden_sources: Array.from(values) });
    };

    const editRepository = (source) => {
        setRepository({ ...EMPTY_REPOSITORY, ...source });
        setShowRepositoryForm(true);
    };

    const saveRepository = async () => {
        setBusy('repository');
        setError('');
        try {
            const payload = { ...repository };
            delete payload.id;
            if (repository.id) {
                await axios.put(`/api/vault/literature/repositories/${encodeURIComponent(repository.id)}`, payload);
            } else {
                await axios.post('/api/vault/literature/repositories', payload);
            }
            setRepository(EMPTY_REPOSITORY);
            setShowRepositoryForm(false);
            setNotice(t('literature.settings.repository_saved'));
            await reload();
        } catch (requestError) {
            console.error('Could not save the academic repository:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.repository_error'));
        } finally { setBusy(''); }
    };

    const testRepository = async () => {
        setBusy('test');
        try {
            const response = await axios.post('/api/vault/literature/repositories/test', { ...repository, query: 'open science' });
            setNotice(t('literature.settings.test_ok', { count: response.data?.count || 0, latency: response.data?.latency_ms || 0 }));
            setError('');
        } catch (requestError) {
            console.error('Academic repository test failed:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.test_error'));
        } finally { setBusy(''); }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setBusy(`delete:${deleteTarget.id}`);
        try {
            await axios.delete(`/api/vault/literature/repositories/${encodeURIComponent(deleteTarget.id)}`, {
                params: { confirm: true, delete_index: deleteIndex },
            });
            setDeleteTarget(null);
            setDeleteIndex(false);
            setNotice(t('literature.settings.repository_deleted'));
            await reload();
        } catch (requestError) {
            console.error('Could not delete the academic repository:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.repository_delete_error'));
        } finally { setBusy(''); }
    };

    const synchronize = async (source, full = false) => {
        setBusy(`sync:${source.id}`);
        try {
            await axios.post(`/api/vault/literature/synchronizations/${encodeURIComponent(source.id)}`, { full });
            setNotice(t('literature.settings.sync_started'));
            await reload();
        } catch (requestError) {
            console.error('Could not start academic repository synchronization:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.sync_error'));
        } finally { setBusy(''); }
    };

    const visibleSources = useMemo(
        () => (configuration.sources || []).filter((source) => showHidden || !source.hidden),
        [configuration.sources, showHidden],
    );

    if (loading) {
        return <div className="resources-plugin-config" role="status">{t('common.loading')}</div>;
    }

    return (
        <div className="resources-plugin-config">
            {error && <div className="resources-plugin-config__error" role="alert"><CircleAlert size={15} /> {error}</div>}
            {notice && <div className="resources-plugin-config__notice" role="status"><CheckCircle2 size={15} /> {notice}</div>}

            <section className="resources-plugin-config__section">
                <div className="resources-plugin-config__heading">
                    <div><h4>{t('literature.settings.resources_table')}</h4><p>{t('literature.settings.resources_table_help')}</p></div>
                    <Database size={18} />
                </div>
                <div className="resources-plugin-config__row">
                    <select style={fieldStyle} value={referenceTable.table_id || ''} disabled={busy === 'reference'} onChange={(event) => void setReference(event.target.value)} aria-label={t('literature.settings.resources_table')}>
                        <option value="">{t('literature.settings.no_resources_table')}</option>
                        {tables.map((table) => <option key={table.id} value={table.id}>{table.name || table.id}</option>)}
                    </select>
                    <button type="button" className="btn-gnosi-secondary" onClick={() => void createReference()} disabled={busy === 'reference'}><Plus size={14} /> {t('literature.settings.create_resources_table')}</button>
                </div>
            </section>

            <section className="resources-plugin-config__section">
                <div className="resources-plugin-config__heading"><div><h4>{t('literature.settings.contact_title')}</h4><p>{t('literature.settings.contact_help')}</p></div><KeyRound size={18} /></div>
                <div className="resources-plugin-config__row">
                    <input style={fieldStyle} type="email" value={configuration.contact_email || ''} placeholder={t('literature.settings.contact_placeholder')} onChange={(event) => setConfiguration((current) => ({ ...current, contact_email: event.target.value }))} onBlur={() => void saveConfiguration({ contact_email: configuration.contact_email || '' })} />
                    <button type="button" className="btn-gnosi-secondary" onClick={() => window.dispatchEvent(new CustomEvent('open-settings', { detail: 'api' }))}><KeyRound size={14} /> {t('literature.settings.manage_credentials')}</button>
                </div>
            </section>

            <section className="resources-plugin-config__section">
                <div className="resources-plugin-config__heading">
                    <div><h4>{t('literature.settings.sources_title')}</h4><p>{t('literature.settings.sources_help')}</p></div>
                    <button type="button" className="btn-gnosi-secondary" onClick={() => setShowHidden((value) => !value)}>{showHidden ? <EyeOff size={14} /> : <RotateCcw size={14} />} {showHidden ? t('literature.settings.hide_hidden') : t('literature.settings.show_hidden')}</button>
                </div>
                <div className="resources-plugin-config__sources">
                    {visibleSources.map((source) => (
                        <article key={source.id} className="resources-plugin-config__source">
                            <div className="resources-plugin-config__source-main">
                                <strong>{source.name}</strong>
                                <span className={`resources-plugin-config__status ${source.available ? 'is-ready' : ''}`}>{statusLabel(source, t)}</span>
                                {source.sync && <small>{t('literature.settings.index_records', { count: source.sync.index_size || 0 })}</small>}
                                {source.sync?.error && <small className="is-error">{source.sync.error}</small>}
                            </div>
                            <div className="resources-plugin-config__source-actions">
                                {source.kind === 'oai' && <button type="button" className="icon-button" title={t('literature.settings.synchronize')} aria-label={t('literature.settings.synchronize')} disabled={busy === `sync:${source.id}`} onClick={() => void synchronize(source)}><RefreshCw size={15} /></button>}
                                {source.group === 'custom' && <button type="button" className="icon-button" title={t('common.edit')} aria-label={t('common.edit')} onClick={() => editRepository(source)}><Pencil size={15} /></button>}
                                {source.group === 'custom' && <button type="button" className="icon-button is-danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setDeleteTarget(source)}><Trash2 size={15} /></button>}
                                {source.group !== 'custom' && source.kind !== 'external' && source.kind !== 'metric' && <button type="button" className="icon-button" title={source.hidden ? t('literature.settings.restore') : t('literature.settings.hide')} aria-label={source.hidden ? t('literature.settings.restore') : t('literature.settings.hide')} onClick={() => void toggleHidden(source, !source.hidden)}>{source.hidden ? <RotateCcw size={15} /> : <EyeOff size={15} />}</button>}
                                {source.automated && <button type="button" role="switch" aria-checked={source.enabled} className={`resource-source-switch ${source.enabled ? 'is-on' : ''}`} onClick={() => void toggleSource(source, !source.enabled)}><span /></button>}
                                {!source.automated && source.search_url && <a className="btn-gnosi-secondary" href={source.search_url.replace('{query}', '')} target="_blank" rel="noreferrer"><Search size={14} /> {t('literature.settings.open_external')}</a>}
                            </div>
                        </article>
                    ))}
                </div>
                <button type="button" className="btn-gnosi-secondary" onClick={() => { setRepository(EMPTY_REPOSITORY); setShowRepositoryForm((value) => !value); }}><Plus size={14} /> {t('literature.settings.add_repository')}</button>
            </section>

            {showRepositoryForm && (
                <section className="resources-plugin-config__section resources-plugin-config__form">
                    <div className="resources-plugin-config__heading"><div><h4>{repository.id ? t('literature.settings.edit_repository') : t('literature.settings.add_repository')}</h4><p>{t('literature.settings.repository_help')}</p></div><Wifi size={18} /></div>
                    <div className="resources-plugin-config__grid">
                        <label><span>{t('literature.settings.repository_name')}</span><input style={fieldStyle} value={repository.name} onChange={(event) => setRepository((current) => ({ ...current, name: event.target.value }))} /></label>
                        <label><span>{t('literature.settings.repository_kind')}</span><select style={fieldStyle} value={repository.kind} onChange={(event) => setRepository((current) => ({ ...current, kind: event.target.value }))}><option value="oai">OAI-PMH</option><option value="rest">REST JSON</option></select></label>
                        <label className="is-wide"><span>{t('literature.settings.repository_url')}</span><input style={fieldStyle} type="url" value={repository.base_url} onChange={(event) => setRepository((current) => ({ ...current, base_url: event.target.value }))} placeholder="https://repository.example.org/oai" /></label>
                        {repository.kind === 'oai' ? (
                            <><label><span>{t('literature.settings.metadata_prefix')}</span><input style={fieldStyle} value={repository.metadata_prefix} onChange={(event) => setRepository((current) => ({ ...current, metadata_prefix: event.target.value }))} /></label><label><span>{t('literature.settings.oai_set')}</span><input style={fieldStyle} value={repository.set} onChange={(event) => setRepository((current) => ({ ...current, set: event.target.value }))} /></label></>
                        ) : (
                            <><label><span>{t('literature.settings.query_parameter')}</span><input style={fieldStyle} value={repository.query_parameter} onChange={(event) => setRepository((current) => ({ ...current, query_parameter: event.target.value }))} /></label><label><span>{t('literature.settings.results_path')}</span><input style={fieldStyle} value={repository.results_path} onChange={(event) => setRepository((current) => ({ ...current, results_path: event.target.value }))} /></label><label><span>{t('literature.settings.pagination')}</span><select style={fieldStyle} value={repository.pagination} onChange={(event) => setRepository((current) => ({ ...current, pagination: event.target.value }))}><option value="none">None</option><option value="page">Page</option><option value="offset">Offset</option><option value="cursor">Cursor</option><option value="link">HTTP Link</option></select></label><label><span>{t('literature.settings.title_mapping')}</span><input style={fieldStyle} value={repository.mapping?.title || ''} onChange={(event) => setRepository((current) => ({ ...current, mapping: { ...current.mapping, title: event.target.value } }))} /></label><label><span>{t('literature.settings.doi_mapping')}</span><input style={fieldStyle} value={repository.mapping?.doi || ''} onChange={(event) => setRepository((current) => ({ ...current, mapping: { ...current.mapping, doi: event.target.value } }))} /></label></>
                        )}
                    </div>
                    <div className="resources-plugin-config__row">
                        <button type="button" className="btn-gnosi-secondary" disabled={busy === 'test'} onClick={() => void testRepository()}><Wifi size={14} /> {t('literature.settings.test_repository')}</button>
                        <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={busy === 'repository' || !repository.name || !repository.base_url} onClick={() => void saveRepository()}>{t('common.save')}</button>
                        <button type="button" className="btn-gnosi-secondary" onClick={() => setShowRepositoryForm(false)}>{t('common.cancel')}</button>
                    </div>
                </section>
            )}

            <ConfirmModal
                isOpen={Boolean(deleteTarget)}
                onClose={() => { setDeleteTarget(null); setDeleteIndex(false); }}
                onConfirm={() => void confirmDelete()}
                title={t('literature.settings.delete_repository_title')}
                message={t('literature.settings.delete_repository_message', { name: deleteTarget?.name || '' })}
                confirmText={t('common.delete')}
                isDestructive
            >
                <label className="resources-plugin-config__delete-index"><input type="checkbox" checked={deleteIndex} onChange={(event) => setDeleteIndex(event.target.checked)} /> {t('literature.settings.delete_index_too')}</label>
            </ConfirmModal>
        </div>
    );
}
