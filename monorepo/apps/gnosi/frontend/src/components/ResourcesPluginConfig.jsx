import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import {
    CheckCircle2, CircleAlert, Database, Eye, EyeOff, KeyRound, Loader2, Pencil, Plus,
    Play, RefreshCw, RotateCcw, Search, Square, Trash2, Wifi,
} from 'lucide-react';

import ConfirmModal from './ConfirmModal';
import './ResourcesPluginConfig.css';

const ACADEMIC_SERVICES = [
    {
        key: 'openalex_api_key',
        name: 'OpenAlex',
        badge: 'Gratuïta / Free',
        docsUrl: 'https://developers.openalex.org',
    },
    {
        key: 'semantic_scholar_api_key',
        name: 'Semantic Scholar',
        badge: 'Gratuïta / Academic',
        docsUrl: 'https://www.semanticscholar.org/product/api',
    },
    {
        key: 'core_api_key',
        name: 'CORE',
        badge: 'Gratuïta / Free',
        docsUrl: 'https://core.ac.uk/services/api',
    },
    {
        key: 'springer_nature_api_key',
        name: 'Springer Nature',
        badge: 'Institucional',
        docsUrl: 'https://dev.springernature.com/',
    },
    {
        key: 'scopus_api_key',
        name: 'Scopus',
        badge: 'Institucional',
        docsUrl: 'https://dev.elsevier.com/sc_apis.html',
    },
    {
        key: 'web_of_science_api_key',
        name: 'Web of Science',
        badge: 'Institucional',
        docsUrl: 'https://developer.clarivate.com/apis/wos',
    },
    {
        key: 'dimensions_api_key',
        name: 'Dimensions',
        badge: 'Subscripció',
        docsUrl: 'https://docs.dimensions.ai/dsl/',
    },
];

const EMPTY_REPOSITORY = {
    id: '', name: '', kind: 'oai', base_url: '', metadata_prefix: 'oai_dc', set: '',
    sync_mode: 'incremental', tombstones: true, default_enabled: true,
    query_parameter: 'q', limit_parameter: 'limit', results_path: 'results',
    pagination: 'none', page_parameter: 'page', offset_parameter: 'offset',
    cursor_parameter: 'cursor', next_cursor_path: 'next_cursor',
    static_filters: {}, mapping: {
        title: 'title', authors: 'authors', year: 'year', abstract: 'abstract', type: 'type',
        container: 'container', publisher: 'publisher', language: 'language', doi: 'doi',
        pmid: 'pmid', arxiv: 'arxiv', isbn: 'isbn', url: 'url', pdf_url: 'pdf_url',
        is_oa: 'is_oa', license: 'license', citations: 'citations', provider_id: 'id',
    },
};

const REST_MAPPING_FIELDS = [
    'provider_id', 'title', 'authors', 'date', 'year', 'abstract', 'type', 'container',
    'publisher', 'volume', 'issue', 'pages', 'language', 'doi', 'pmid', 'pmcid', 'arxiv',
    'isbn', 'url', 'pdf_url', 'is_oa', 'license', 'peer_reviewed', 'citations',
];

function staticFiltersText(filters) {
    return Object.entries(filters || {}).map(([key, value]) => `${key}=${value}`).join('\n');
}

function parseStaticFilters(value) {
    return Object.fromEntries(value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const separator = line.indexOf('=');
        return separator < 0 ? [line, ''] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }).filter(([key]) => key));
}

function statusLabel(source, t) {
    if (source.kind === 'external') return t('literature.settings.external_only');
    if (source.kind === 'metric') return t('literature.settings.metric_only');
    if (source.credential_status === 'missing') return t('literature.settings.credential_missing');
    if (source.kind === 'oai' && source.sync?.state === 'running') return t('literature.settings.sync_state_running', 'En curs');
    if (source.kind === 'oai' && source.sync?.state === 'queued') return t('literature.settings.sync_state_queued', 'En cua');
    if (source.kind === 'oai' && !source.sync?.index_size) return t('literature.settings.index_empty');
    if (!source.implemented) return t('literature.settings.adapter_pending');
    return t('literature.settings.ready');
}

export default function ResourcesPluginConfig() {
    const { t } = useTranslation();
    const [configuration, setConfiguration] = useState({ sources: [], source_defaults: {}, hidden_sources: [], contact_email: '' });
    const [contactEmailInput, setContactEmailInput] = useState('');
    const isEditingEmailRef = React.useRef(false);
    const [tables, setTables] = useState([]);
    const [referenceTable, setReferenceTable] = useState({ table_id: '', configured: false });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [repository, setRepository] = useState(EMPTY_REPOSITORY);
    const [repositoryStaticFilters, setRepositoryStaticFilters] = useState('');
    const [showRepositoryForm, setShowRepositoryForm] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [deleteIndex, setDeleteIndex] = useState(false);
    const [showCredentialsInline, setShowCredentialsInline] = useState(false);
    const [credentialsStatus, setCredentialsStatus] = useState({});
    const [credentialsInputs, setCredentialsInputs] = useState({});
    const [credentialsVisible, setCredentialsVisible] = useState({});
    const [savingCredentialKey, setSavingCredentialKey] = useState('');
    const [credentialFeedback, setCredentialFeedback] = useState({ key: '', message: '', isError: false });
    const [highlightCredentialKey, setHighlightCredentialKey] = useState('');

    const loadCredentialsStatuses = useCallback(async () => {
        try {
            const response = await axios.get('/api/credentials/');
            const map = {};
            for (const item of response.data || []) {
                map[item.key] = item.has_value;
            }
            setCredentialsStatus(map);
        } catch (err) {
            console.error('Could not load credentials status:', err);
        }
    }, []);

    useEffect(() => {
        if (showCredentialsInline) {
            void loadCredentialsStatuses();
        }
    }, [showCredentialsInline, loadCredentialsStatuses]);

    const reload = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const [configResponse, tablesResponse, referenceResponse] = await Promise.all([
                axios.get('/api/vault/literature/configuration'),
                axios.get('/api/vault/tables'),
                axios.get('/api/vault/reference-table'),
            ]);
            const nextConfig = configResponse.data || {};
            setConfiguration(nextConfig);
            if (!isEditingEmailRef.current) {
                setContactEmailInput(nextConfig.contact_email || '');
            }
            setTables(Array.isArray(tablesResponse.data) ? tablesResponse.data : []);
            setReferenceTable(referenceResponse.data || { table_id: '', configured: false });
            setError('');
        } catch (requestError) {
            console.error('Could not load Resources plugin configuration:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.load_error'));
        } finally { if (!silent) setLoading(false); }
    }, [t]);

    const handleSaveCredential = async (serviceKey, serviceName, customValue) => {
        const val = (customValue !== undefined ? customValue : (credentialsInputs[serviceKey] || '')).trim();
        if (!val) return;
        setSavingCredentialKey(serviceKey);
        setCredentialFeedback({ key: '', message: '', isError: false });
        try {
            await axios.post('/api/credentials/', { key: serviceKey, value: val });
            setCredentialsInputs((prev) => ({ ...prev, [serviceKey]: '' }));
            setCredentialFeedback({
                key: serviceKey,
                message: t('literature.settings.credential_saved', { name: serviceName }),
                isError: false,
            });
            await loadCredentialsStatuses();
            void reload(true);
        } catch (err) {
            console.error(`Could not save credential for ${serviceKey}:`, err);
            setCredentialFeedback({
                key: serviceKey,
                message: err?.response?.data?.detail || t('literature.settings.save_error', 'Error'),
                isError: true,
            });
        } finally {
            setSavingCredentialKey('');
        }
    };

    const handleDeleteCredential = async (serviceKey, serviceName) => {
        setSavingCredentialKey(serviceKey);
        setCredentialFeedback({ key: '', message: '', isError: false });
        try {
            await axios.delete(`/api/credentials/${serviceKey}`);
            setCredentialsInputs((prev) => ({ ...prev, [serviceKey]: '' }));
            setCredentialFeedback({
                key: serviceKey,
                message: t('literature.settings.credential_deleted', { name: serviceName }),
                isError: false,
            });
            await loadCredentialsStatuses();
            void reload(true);
        } catch (err) {
            console.error(`Could not delete credential for ${serviceKey}:`, err);
            setCredentialFeedback({
                key: serviceKey,
                message: err?.response?.data?.detail || t('literature.settings.save_error', 'Error'),
                isError: true,
            });
        } finally {
            setSavingCredentialKey('');
        }
    };

    useEffect(() => { void reload(); }, [reload]);

    useEffect(() => {
        const hasActiveSynchronization = (configuration.sources || []).some(
            (source) => source.kind === 'oai' && ['queued', 'running'].includes(source.sync?.state),
        );
        if (!hasActiveSynchronization) return undefined;
        const timer = window.setInterval(() => void reload(true), 2000);
        return () => window.clearInterval(timer);
    }, [configuration.sources, reload]);

    const saveConfiguration = async (patch) => {
        setBusy('configuration');
        setNotice('');
        try {
            const response = await axios.put('/api/vault/literature/configuration', patch);
            const nextConfig = response.data || {};
            setConfiguration(nextConfig);
            if (patch.contact_email !== undefined) {
                setContactEmailInput(nextConfig.contact_email || '');
                setNotice(t('literature.settings.contact_saved'));
            }
            setError('');
            return true;
        } catch (requestError) {
            console.error('Could not save Resources plugin configuration:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.save_error'));
            return false;
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
            await reload(true);
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

    const hiddenSourceCount = (configuration.sources || []).filter((source) => source.hidden).length;

    const restoreHiddenSources = async () => {
        if (hiddenSourceCount === 0) return;
        const restoredCount = hiddenSourceCount;
        const saved = await saveConfiguration({ hidden_sources: [] });
        if (saved) setNotice(t('literature.settings.sources_restored', { count: restoredCount }));
    };

    const editRepository = (source) => {
        setRepository({ ...EMPTY_REPOSITORY, ...source });
        setRepositoryStaticFilters(staticFiltersText(source.static_filters));
        setShowRepositoryForm(true);
    };

    const saveRepository = async () => {
        setBusy('repository');
        setError('');
        try {
            const payload = { ...repository, static_filters: parseStaticFilters(repositoryStaticFilters) };
            delete payload.id;
            if (repository.id) {
                await axios.put(`/api/vault/literature/repositories/${encodeURIComponent(repository.id)}`, payload);
            } else {
                await axios.post('/api/vault/literature/repositories', payload);
            }
            setRepository(EMPTY_REPOSITORY);
            setRepositoryStaticFilters('');
            setShowRepositoryForm(false);
            setNotice(t('literature.settings.repository_saved'));
            await reload(true);
        } catch (requestError) {
            console.error('Could not save the academic repository:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.repository_error'));
        } finally { setBusy(''); }
    };

    const testRepository = async () => {
        setBusy('test');
        try {
            const response = await axios.post('/api/vault/literature/repositories/test', { ...repository, static_filters: parseStaticFilters(repositoryStaticFilters), query: 'open science' });
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
            await reload(true);
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
            await reload(true);
        } catch (requestError) {
            console.error('Could not start academic repository synchronization:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.sync_error'));
        } finally { setBusy(''); }
    };

    const cancelSynchronization = async (source) => {
        setBusy(`sync:${source.id}`);
        try {
            await axios.delete(`/api/vault/literature/synchronizations/${encodeURIComponent(source.id)}`);
            setNotice(t('literature.settings.sync_cancel_requested'));
            await reload(true);
        } catch (requestError) {
            console.error('Could not cancel academic repository synchronization:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.sync_error'));
        } finally { setBusy(''); }
    };

    const resumeSynchronization = async (source) => {
        setBusy(`sync:${source.id}`);
        try {
            await axios.post(`/api/vault/literature/synchronizations/${encodeURIComponent(source.id)}/resume`);
            setNotice(t('literature.settings.sync_resumed'));
            await reload(true);
        } catch (requestError) {
            console.error('Could not resume academic repository synchronization:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.settings.sync_error'));
        } finally { setBusy(''); }
    };

    const visibleSources = useMemo(
        () => (configuration.sources || []).filter((source) => !source.hidden),
        [configuration.sources],
    );

    if (loading && !configuration.sources?.length) {
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
                    <select value={referenceTable.table_id || ''} disabled={busy === 'reference'} onChange={(event) => void setReference(event.target.value)} aria-label={t('literature.settings.resources_table')}>
                        <option value="">{t('literature.settings.no_resources_table')}</option>
                        {tables.map((table) => <option key={table.id} value={table.id}>{table.name || table.id}</option>)}
                    </select>
                    <button type="button" className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action" onClick={() => void createReference()} disabled={busy === 'reference'}><Plus size={14} /> {t('literature.settings.create_resources_table')}</button>
                </div>
            </section>

            <section className="resources-plugin-config__section">
                <div className="resources-plugin-config__heading"><div><h4>{t('literature.settings.contact_title')}</h4><p>{t('literature.settings.contact_help')}</p></div><KeyRound size={18} /></div>
                <div className="resources-plugin-config__row">
                    <input
                        type="email"
                        value={contactEmailInput}
                        placeholder={t('literature.settings.contact_placeholder')}
                        onFocus={() => { isEditingEmailRef.current = true; }}
                        onChange={(event) => setContactEmailInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.currentTarget.blur();
                            }
                        }}
                        onBlur={() => {
                            isEditingEmailRef.current = false;
                            const trimmed = contactEmailInput.trim();
                            if (trimmed !== (configuration.contact_email || '')) {
                                void saveConfiguration({ contact_email: trimmed });
                            }
                        }}
                    />
                    <button
                        type="button"
                        className={`btn-gnosi btn-gnosi-secondary resources-plugin-config__action ${showCredentialsInline ? 'is-active' : ''}`}
                        onClick={() => {
                            setShowCredentialsInline((prev) => !prev);
                            setHighlightCredentialKey('');
                        }}
                    >
                        <KeyRound size={14} /> {t('literature.settings.manage_credentials')}
                    </button>
                </div>

                {showCredentialsInline && (
                    <div className="resources-plugin-config__credentials-box">
                        <div className="resources-plugin-config__credentials-heading">
                            <KeyRound size={16} />
                            <div>
                                <h5>{t('literature.settings.credentials_modal_title')}</h5>
                                <p>{t('literature.settings.credentials_modal_desc')}</p>
                            </div>
                        </div>

                        <div className="resources-plugin-config__credentials-list">
                            {ACADEMIC_SERVICES.map((service) => {
                                const isConfigured = Boolean(credentialsStatus[service.key]);
                                const isSaving = savingCredentialKey === service.key;
                                const isHighlighted = highlightCredentialKey === service.key;
                                const isVisible = Boolean(credentialsVisible[service.key]);
                                const currentInput = credentialsInputs[service.key] || '';
                                const currentFeedback = credentialFeedback.key === service.key ? credentialFeedback : null;

                                return (
                                    <div
                                        key={service.key}
                                        id={`credential-${service.key}`}
                                        className={`resources-plugin-config__credential-card ${isHighlighted ? 'is-highlighted' : ''}`}
                                    >
                                        <div className="resources-plugin-config__credential-header">
                                            <div className="resources-plugin-config__credential-name-row">
                                                <strong>{service.name}</strong>
                                                <span className="resources-plugin-config__credential-badge-type">{service.badge}</span>
                                                <span className={`resources-plugin-config__status ${isConfigured ? 'is-ready' : ''}`}>
                                                    {isConfigured ? (
                                                        <>
                                                            <CheckCircle2 size={10} />
                                                            {t('literature.settings.credential_configured')}
                                                        </>
                                                    ) : (
                                                        t('literature.settings.credential_not_configured')
                                                    )}
                                                </span>
                                            </div>
                                            {service.docsUrl && (
                                                <a
                                                    href={service.docsUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="resources-plugin-config__credential-doc-link"
                                                >
                                                    {t('literature.settings.get_api_key')} ↗
                                                </a>
                                            )}
                                        </div>

                                        <div className="resources-plugin-config__credential-input-row">
                                            <div className="resources-plugin-config__credential-input-wrap">
                                                <input
                                                    type={isVisible ? 'text' : 'password'}
                                                    value={currentInput}
                                                    placeholder={
                                                        isConfigured
                                                            ? '••••••••••••••••••••••••'
                                                            : 'API Key / Token'
                                                    }
                                                    onChange={(e) =>
                                                        setCredentialsInputs((prev) => ({
                                                            ...prev,
                                                            [service.key]: e.target.value,
                                                        }))
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.currentTarget.blur();
                                                        }
                                                    }}
                                                    onBlur={(e) => {
                                                        const trimmed = e.target.value.trim();
                                                        if (trimmed) {
                                                            void handleSaveCredential(service.key, service.name, trimmed);
                                                        }
                                                    }}
                                                    disabled={isSaving}
                                                />
                                                <button
                                                    type="button"
                                                    className="resources-plugin-config__credential-visibility-btn"
                                                    onClick={() =>
                                                        setCredentialsVisible((prev) => ({
                                                            ...prev,
                                                            [service.key]: !prev[service.key],
                                                        }))
                                                    }
                                                    aria-label="Toggle visibility"
                                                    tabIndex={-1}
                                                >
                                                    {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                                                </button>
                                            </div>

                                            {isSaving && (
                                                <Loader2 size={16} className="resources-plugin-config__spin" />
                                            )}

                                            {isConfigured && !isSaving && (
                                                <button
                                                    type="button"
                                                    className="gnosi-icon-button resources-plugin-config__icon-button is-danger"
                                                    title={t('literature.settings.delete_credential')}
                                                    aria-label={t('literature.settings.delete_credential')}
                                                    disabled={isSaving}
                                                    onClick={() => void handleDeleteCredential(service.key, service.name)}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>

                                        {currentFeedback && (
                                            <p
                                                className={`resources-plugin-config__credential-feedback ${
                                                    currentFeedback.isError ? 'is-error' : 'is-success'
                                                }`}
                                            >
                                                {currentFeedback.message}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </section>

            <section className="resources-plugin-config__section">
                <div className="resources-plugin-config__heading">
                    <div><h4>{t('literature.settings.sources_title')}</h4><p>{t('literature.settings.sources_help')}</p></div>
                    <button
                        type="button"
                        className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action"
                        onClick={() => void restoreHiddenSources()}
                        disabled={busy === 'configuration' || hiddenSourceCount === 0}
                    >
                        <RotateCcw size={14} />
                        {hiddenSourceCount > 0
                            ? t('literature.settings.restore_hidden_sources', { count: hiddenSourceCount })
                            : t('literature.settings.no_hidden_sources')}
                    </button>
                </div>
                <div className="resources-plugin-config__sources">
                    {visibleSources.map((source) => {
                        const isSyncing = ['queued', 'running'].includes(source.sync?.state);
                        const progressPercent = source.sync?.complete_list_size > 0
                            ? Math.min(100, Math.round(((source.sync.indexed_count || 0) / source.sync.complete_list_size) * 100))
                            : null;
                        const hasCredential = Boolean(source.credential_key || source.optional_credential_key || source.group === 'credential' || source.group === 'subscription');
                        return (
                            <article key={source.id} className="resources-plugin-config__source">
                                <div className="resources-plugin-config__source-main">
                                    <div className="resources-plugin-config__source-title-row">
                                        <strong>{source.name}</strong>
                                        <span className={`resources-plugin-config__status ${source.available ? 'is-ready' : ''} ${isSyncing ? 'is-syncing' : ''}`}>
                                            {isSyncing && <Loader2 size={11} className="resources-plugin-config__spin" />}
                                            {statusLabel(source, t)}
                                        </span>
                                    </div>
                                    {source.sync && <small>{t('literature.settings.index_records', { count: source.sync.index_size || 0 })}</small>}
                                    {source.sync && source.sync.state !== 'never' && (
                                        <small className={isSyncing ? 'is-syncing-text' : ''}>
                                            {t('literature.settings.sync_progress', {
                                                state: t(`literature.settings.sync_state_${source.sync.state}`, source.sync.state),
                                                received: source.sync.received_count || 0,
                                                indexed: source.sync.indexed_count || 0,
                                                deleted: source.sync.deleted_count || 0,
                                            })}
                                            {progressPercent !== null && ` (${progressPercent}%)`}
                                        </small>
                                    )}
                                    {isSyncing && progressPercent !== null && (
                                        <div className="resources-plugin-config__progress-track" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
                                            <div className="resources-plugin-config__progress-fill" style={{ width: `${progressPercent}%` }} />
                                        </div>
                                    )}
                                    {source.sync?.last_successful_datestamp && <small>{t('literature.settings.last_sync', { date: new Date(source.sync.last_successful_datestamp).toLocaleString() })}</small>}
                                    {source.sync?.error && <small className="is-error">{source.sync.error}</small>}
                                </div>
                            <div className="resources-plugin-config__source-actions">
                                {hasCredential && (
                                    <button
                                        type="button"
                                        className="gnosi-icon-button resources-plugin-config__icon-button"
                                        title={t('literature.settings.configure_credentials')}
                                        aria-label={t('literature.settings.configure_credentials')}
                                        onClick={() => {
                                            const targetKey = source.credential_key || source.optional_credential_key || '';
                                            setShowCredentialsInline(true);
                                            setHighlightCredentialKey(targetKey);
                                            if (targetKey) {
                                                setTimeout(() => {
                                                    const el = document.getElementById(`credential-${targetKey}`);
                                                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                                }, 60);
                                            }
                                        }}
                                    >
                                        <KeyRound size={15} />
                                    </button>
                                )}
                                {source.kind === 'oai' && ['queued', 'running'].includes(source.sync?.state) && <button type="button" className="gnosi-icon-button resources-plugin-config__icon-button is-danger" title={t('literature.settings.cancel_sync')} aria-label={t('literature.settings.cancel_sync')} disabled={busy === `sync:${source.id}`} onClick={() => void cancelSynchronization(source)}><Square size={15} /></button>}
                                {source.kind === 'oai' && ['cancelled', 'failed'].includes(source.sync?.state) && <button type="button" className="gnosi-icon-button resources-plugin-config__icon-button" title={t('literature.settings.resume_sync')} aria-label={t('literature.settings.resume_sync')} disabled={busy === `sync:${source.id}`} onClick={() => void resumeSynchronization(source)}><Play size={15} /></button>}
                                {source.kind === 'oai' && !['queued', 'running'].includes(source.sync?.state) && <button type="button" className="gnosi-icon-button resources-plugin-config__icon-button" title={t('literature.settings.synchronize')} aria-label={t('literature.settings.synchronize')} disabled={busy === `sync:${source.id}`} onClick={() => void synchronize(source)}><RefreshCw size={15} /></button>}
                                {source.kind === 'oai' && !['queued', 'running'].includes(source.sync?.state) && <button type="button" className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action" title={t('literature.settings.full_reindex_help')} disabled={busy === `sync:${source.id}`} onClick={() => void synchronize(source, true)}>{t('literature.settings.full_reindex')}</button>}
                                    {source.group === 'custom' && <button type="button" className="gnosi-icon-button resources-plugin-config__icon-button" title={t('common.edit')} aria-label={t('common.edit')} onClick={() => editRepository(source)}><Pencil size={15} /></button>}
                                    {source.group === 'custom' && <button type="button" className="gnosi-icon-button resources-plugin-config__icon-button is-danger" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => setDeleteTarget(source)}><Trash2 size={15} /></button>}
                                    {source.group !== 'custom' && source.kind !== 'external' && source.kind !== 'metric' && <button type="button" className="gnosi-icon-button resources-plugin-config__icon-button" title={source.hidden ? t('literature.settings.restore') : t('literature.settings.hide')} aria-label={source.hidden ? t('literature.settings.restore') : t('literature.settings.hide')} onClick={() => void toggleHidden(source, !source.hidden)}>{source.hidden ? <RotateCcw size={15} /> : <EyeOff size={15} />}</button>}
                                    {source.automated && <button type="button" role="switch" aria-checked={source.enabled} aria-label={t(source.enabled ? 'literature.settings.disable_source' : 'literature.settings.enable_source', { name: source.name })} className={`gnosi-toggle resource-source-switch ${source.enabled ? 'active' : ''}`} onClick={() => void toggleSource(source, !source.enabled)}><span className="gnosi-toggle-handle" /></button>}
                                    {!source.automated && source.search_url && <a className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action" href={source.search_url.replace('{query}', '')} target="_blank" rel="noreferrer"><Search size={14} /> {t('literature.settings.open_external')}</a>}
                                </div>
                            </article>
                        );
                    })}
                </div>
                <button type="button" className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action resources-plugin-config__add-button" onClick={() => { setRepository(EMPTY_REPOSITORY); setRepositoryStaticFilters(''); setShowRepositoryForm((value) => !value); }}><Plus size={14} /> {t('literature.settings.add_repository')}</button>
            </section>

            {showRepositoryForm && (
                <section className="resources-plugin-config__section resources-plugin-config__form">
                    <div className="resources-plugin-config__heading"><div><h4>{repository.id ? t('literature.settings.edit_repository') : t('literature.settings.add_repository')}</h4><p>{t('literature.settings.repository_help')}</p></div><Wifi size={18} /></div>
                    <div className="resources-plugin-config__grid">
                        <label><span>{t('literature.settings.repository_name')}</span><input value={repository.name} onChange={(event) => setRepository((current) => ({ ...current, name: event.target.value }))} /></label>
                        <label><span>{t('literature.settings.repository_kind')}</span><select value={repository.kind} onChange={(event) => setRepository((current) => ({ ...current, kind: event.target.value }))}><option value="oai">OAI-PMH</option><option value="rest">REST JSON</option></select></label>
                        <label className="is-wide"><span>{t('literature.settings.repository_url')}</span><input type="url" value={repository.base_url} onChange={(event) => setRepository((current) => ({ ...current, base_url: event.target.value }))} placeholder="https://repository.example.org/oai" /></label>
                        {repository.kind === 'oai' ? (
                            <><label><span>{t('literature.settings.metadata_prefix')}</span><input value={repository.metadata_prefix} onChange={(event) => setRepository((current) => ({ ...current, metadata_prefix: event.target.value }))} /></label><label><span>{t('literature.settings.oai_set')}</span><input value={repository.set} onChange={(event) => setRepository((current) => ({ ...current, set: event.target.value }))} /></label></>
                        ) : (
                            <><label><span>{t('literature.settings.query_parameter')}</span><input value={repository.query_parameter} onChange={(event) => setRepository((current) => ({ ...current, query_parameter: event.target.value }))} /></label><label><span>{t('literature.settings.limit_parameter')}</span><input value={repository.limit_parameter} onChange={(event) => setRepository((current) => ({ ...current, limit_parameter: event.target.value }))} /></label><label><span>{t('literature.settings.results_path')}</span><input value={repository.results_path} onChange={(event) => setRepository((current) => ({ ...current, results_path: event.target.value }))} /></label><label><span>{t('literature.settings.pagination')}</span><select value={repository.pagination} onChange={(event) => setRepository((current) => ({ ...current, pagination: event.target.value }))}><option value="none">None</option><option value="page">Page</option><option value="offset">Offset</option><option value="cursor">Cursor</option><option value="link">HTTP Link</option></select></label>{repository.pagination === 'page' && <label><span>{t('literature.settings.page_parameter')}</span><input value={repository.page_parameter} onChange={(event) => setRepository((current) => ({ ...current, page_parameter: event.target.value }))} /></label>}{repository.pagination === 'offset' && <label><span>{t('literature.settings.offset_parameter')}</span><input value={repository.offset_parameter} onChange={(event) => setRepository((current) => ({ ...current, offset_parameter: event.target.value }))} /></label>}{repository.pagination === 'cursor' && <><label><span>{t('literature.settings.cursor_parameter')}</span><input value={repository.cursor_parameter} onChange={(event) => setRepository((current) => ({ ...current, cursor_parameter: event.target.value }))} /></label><label><span>{t('literature.settings.next_cursor_path')}</span><input value={repository.next_cursor_path} onChange={(event) => setRepository((current) => ({ ...current, next_cursor_path: event.target.value }))} /></label></>}<label className="is-wide"><span>{t('literature.settings.static_filters')}</span><textarea rows={3} value={repositoryStaticFilters} onChange={(event) => setRepositoryStaticFilters(event.target.value)} placeholder="type=article&#10;status=published" /><small>{t('literature.settings.static_filters_help')}</small></label>{REST_MAPPING_FIELDS.map((field) => <label key={field}><span>{t('literature.settings.mapping_field', { field })}</span><input value={repository.mapping?.[field] || ''} onChange={(event) => setRepository((current) => ({ ...current, mapping: { ...current.mapping, [field]: event.target.value } }))} /></label>)}</>
                        )}
                    </div>
                    <div className="resources-plugin-config__row">
                        <button type="button" className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action" disabled={busy === 'test'} onClick={() => void testRepository()}><Wifi size={14} /> {t('literature.settings.test_repository')}</button>
                        <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={busy === 'repository' || !repository.name || !repository.base_url} onClick={() => void saveRepository()}>{t('common.save')}</button>
                        <button type="button" className="btn-gnosi btn-gnosi-secondary resources-plugin-config__action" onClick={() => setShowRepositoryForm(false)}>{t('common.cancel')}</button>
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
