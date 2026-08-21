import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import {
    Archive, ArrowLeft, BookOpenCheck, Bot, Check, ChevronDown, ChevronRight,
    CircleAlert, Download, ExternalLink, Eye, FilePlus2, Filter, LibraryBig,
    LoaderCircle, NotebookTabs, Plus, RefreshCw, Search, Sparkles, Users, X,
} from 'lucide-react';

import { usePlugins } from '../plugins/usePlugins';
import { toast } from '../lib/toast';
import './LiteraturePage.css';

const EMPTY_FILTERS = {
    date_from: '', date_to: '', language: '', type: '', peer_reviewed: null, open_access: null,
};

function authorLine(work) {
    return (work.authors || []).map((author) => (
        author.literal || [author.given, author.family].filter(Boolean).join(' ')
    )).filter(Boolean).join('; ');
}

function SourcePicker({ sources, selected, onChange, statuses, t }) {
    const [expanded, setExpanded] = useState(false);
    const automated = sources.filter((source) => source.automated && !source.hidden);
    const visible = expanded ? automated : automated.slice(0, 12);
    return (
        <div className="literature-source-picker">
            <div className="literature-source-picker__header">
                <strong>{t('literature.search.sources')}</strong>
                <span>{t('literature.search.sources_selected', { count: selected.size })}</span>
            </div>
            <div className="literature-source-picker__items">
                {visible.map((source) => {
                    const status = statuses?.[source.id];
                    return (
                        <label key={source.id} className={`literature-source-chip ${selected.has(source.id) ? 'is-selected' : ''} ${!source.available ? 'is-unavailable' : ''}`}>
                            <input type="checkbox" checked={selected.has(source.id)} disabled={!source.available} onChange={(event) => onChange(source.id, event.target.checked)} />
                            <span>{source.name}</span>
                            {status?.state === 'running' && <LoaderCircle size={12} className="spin" />}
                            {status?.state === 'completed' && <small>{status.count}</small>}
                            {status?.state === 'failed' && <CircleAlert size={12} />}
                        </label>
                    );
                })}
            </div>
            {automated.length > 12 && <button type="button" className="literature-link-button" onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {expanded ? t('literature.search.show_less_sources') : t('literature.search.show_all_sources')}</button>}
        </div>
    );
}

function WorkPreview({ work, onClose, onImport, t }) {
    if (!work) return null;
    const conflicts = Object.entries(work.conflicts || {});
    return (
        <div className="literature-preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="literature-preview-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <aside className="literature-preview">
                <header><div><span>{t('literature.preview.eyebrow')}</span><h2 id="literature-preview-title">{work.title}</h2></div><button type="button" className="literature-icon-button" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button></header>
                <div className="literature-preview__body">
                    <dl className="literature-metadata-grid">
                        <div><dt>{t('literature.result.authors')}</dt><dd>{authorLine(work) || '—'}</dd></div>
                        <div><dt>{t('literature.result.year')}</dt><dd>{work.year || '—'}</dd></div>
                        <div><dt>{t('literature.result.publication')}</dt><dd>{work.publication?.container_title || work.publication?.publisher || '—'}</dd></div>
                        <div><dt>{t('literature.result.language')}</dt><dd>{work.language || '—'}</dd></div>
                        <div><dt>{t('literature.result.identifiers')}</dt><dd>{[work.identifiers?.doi && `DOI ${work.identifiers.doi}`, work.identifiers?.pmid && `PMID ${work.identifiers.pmid}`, work.identifiers?.arxiv && `arXiv ${work.identifiers.arxiv}`, ...(work.identifiers?.isbn13 || [])].filter(Boolean).join(' · ') || '—'}</dd></div>
                        <div><dt>{t('literature.result.open_access')}</dt><dd>{work.open_access?.is_oa === true ? t('common.yes') : work.open_access?.is_oa === false ? t('common.no') : t('literature.result.unknown')}</dd></div>
                    </dl>
                    <section><h3>{t('literature.preview.abstract')}</h3><p>{work.abstract || t('literature.preview.no_abstract')}</p></section>
                    <section><h3>{t('literature.preview.field_provenance')}</h3><div className="literature-provenance">{Object.entries(work.provenance || {}).map(([field, providers]) => <div key={field}><strong>{field}</strong><span>{(providers || []).join(', ')}</span></div>)}</div></section>
                    {conflicts.length > 0 && <section><h3>{t('literature.preview.conflicts')}</h3>{conflicts.map(([field, variants]) => <div key={field} className="literature-conflict"><strong>{field}</strong>{variants.map((variant, index) => <p key={`${variant.provider}-${index}`}><span>{variant.provider}</span> {typeof variant.value === 'object' ? JSON.stringify(variant.value) : String(variant.value)}</p>)}</div>)}</section>}
                    <section><h3>{t('literature.preview.locations')}</h3><div className="literature-locations">{(work.locations || []).map((location, index) => <a key={`${location.url}-${index}`} href={location.landing_page_url || location.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {location.license || location.landing_page_url || location.url}</a>)}</div></section>
                    <section><h3>{t('literature.preview.original_sources')}</h3><div className="literature-locations">{(work.sources || []).map((source, index) => <a key={`${source.provider}-${source.provider_id}-${index}`} href={source.url || '#'} target="_blank" rel="noreferrer"><ExternalLink size={13} /> {source.provider} · {source.provider_id}</a>)}</div></section>
                </div>
                <footer><button type="button" className="btn-gnosi-secondary" onClick={onClose}>{t('common.close')}</button><button type="button" className="btn-gnosi btn-gnosi-primary" disabled={work.in_resources} onClick={() => onImport(work)}><FilePlus2 size={15} /> {work.in_resources ? t('literature.result.already_added') : t('literature.result.add')}</button></footer>
            </aside>
        </div>
    );
}

function ResultCard({ work, selected, onSelect, onPreview, onImport, t }) {
    const citations = Object.entries(work.metrics?.citations || {});
    return (
        <article className={`literature-result ${selected ? 'is-selected' : ''}`}>
            <label className="literature-result__select"><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} /><span className="sr-only">{t('literature.result.select', { title: work.title })}</span></label>
            <div className="literature-result__content">
                <div className="literature-result__badges">
                    {(work.sources || []).map((source) => <span key={`${source.provider}-${source.provider_id}`}>{source.provider}</span>)}
                    {(work.sources || []).length > 1 && <strong>{t('literature.result.occurrences', { count: work.sources.length })}</strong>}
                    {work.open_access?.is_oa && <span className="is-oa">{t('literature.result.oa')}</span>}
                    {work.in_resources && <span className="is-added"><Check size={11} /> {t('literature.result.already_added')}</span>}
                </div>
                <h3>{work.title}</h3>
                <p className="literature-result__authors">{authorLine(work) || t('literature.result.unknown_author')} {work.year ? `· ${work.year}` : ''}</p>
                <p className="literature-result__publication">{work.publication?.container_title || work.publication?.publisher || ''}</p>
                {work.abstract && <p className="literature-result__abstract">{work.abstract}</p>}
                <div className="literature-result__meta">
                    {work.identifiers?.doi && <span>DOI {work.identifiers.doi}</span>}
                    {citations.map(([provider, count]) => <span key={provider}>{t('literature.result.citations', { provider, count })}</span>)}
                    {(work.possible_duplicates || []).length > 0 && <span className="is-warning">{t('literature.result.possible_duplicates', { count: work.possible_duplicates.length })}</span>}
                </div>
            </div>
            <div className="literature-result__actions"><button type="button" className="btn-gnosi-secondary" onClick={onPreview}><Eye size={14} /> {t('literature.result.view')}</button><button type="button" className="btn-gnosi btn-gnosi-primary" disabled={work.in_resources} onClick={onImport}><FilePlus2 size={14} /> {work.in_resources ? t('literature.result.already_added') : t('literature.result.add')}</button></div>
        </article>
    );
}

function ReviewWorkspace({ selectedWorks, currentSearch, t }) {
    const [reviews, setReviews] = useState([]);
    const [selectedReviewId, setSelectedReviewId] = useState('');
    const [detail, setDetail] = useState(null);
    const [question, setQuestion] = useState('');
    const [mode, setMode] = useState('single');
    const [reviewers, setReviewers] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [aiInsight, setAiInsight] = useState(null);
    const [scheduleEnabled, setScheduleEnabled] = useState(false);
    const [scheduleDays, setScheduleDays] = useState(7);

    const loadReviews = useCallback(async () => {
        try {
            const response = await axios.get('/api/vault/literature/reviews');
            setReviews(response.data?.reviews || []);
        } catch (requestError) {
            console.error('Could not load literature reviews:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.load_error'));
        }
    }, [t]);

    const loadDetail = useCallback(async (reviewId) => {
        if (!reviewId) { setDetail(null); return; }
        try {
            const response = await axios.get(`/api/vault/literature/reviews/${encodeURIComponent(reviewId)}`);
            setDetail(response.data);
            const schedule = response.data?.review?.configuration?.schedule || {};
            setScheduleEnabled(Boolean(schedule.enabled));
            setScheduleDays(Number(schedule.interval_days || 7));
        } catch (requestError) {
            console.error('Could not load the literature review:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.load_error'));
        }
    }, [t]);

    useEffect(() => { void loadReviews(); }, [loadReviews]);
    useEffect(() => { void loadDetail(selectedReviewId); }, [loadDetail, selectedReviewId]);

    const createReview = async () => {
        setBusy('create');
        try {
            const response = await axios.post('/api/vault/literature/reviews', {
                question, title: question, reviewer_mode: mode,
                reviewers: reviewers.split(',').map((value) => value.trim()).filter(Boolean),
                protocol: '', criteria: {}, configuration: {},
            });
            setQuestion('');
            await loadReviews();
            setSelectedReviewId(response.data.id);
        } catch (requestError) {
            console.error('Could not create the literature review:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.create_error'));
        } finally { setBusy(''); }
    };

    const addSelected = async () => {
        if (!selectedReviewId || !selectedWorks.length) return;
        setBusy('candidates');
        try {
            await axios.post(`/api/vault/literature/reviews/${encodeURIComponent(selectedReviewId)}/candidates`, { works: selectedWorks });
            await loadDetail(selectedReviewId);
            toast.success(t('literature.review.candidates_added'));
        } catch (requestError) {
            console.error('Could not add literature candidates:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.candidates_error'));
        } finally { setBusy(''); }
    };

    const decide = async (candidate, decision) => {
        setBusy(candidate.id);
        try {
            await axios.post(`/api/vault/literature/reviews/${encodeURIComponent(selectedReviewId)}/candidates/${encodeURIComponent(candidate.id)}/decisions`, { phase: candidate.phase, decision, reason: '', notes: '' });
            await loadDetail(selectedReviewId);
        } catch (requestError) {
            console.error('Could not save the screening decision:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.decision_error'));
        } finally { setBusy(''); }
    };

    const resolve = async (candidate, decision) => {
        setBusy(candidate.id);
        try {
            await axios.post(`/api/vault/literature/reviews/${encodeURIComponent(selectedReviewId)}/candidates/${encodeURIComponent(candidate.id)}/consensus`, { decision, reason: 'Consensus resolution', notes: '' });
            await loadDetail(selectedReviewId);
        } catch (requestError) {
            console.error('Could not resolve the screening conflict:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.decision_error'));
        } finally { setBusy(''); }
    };

    const exportReview = async (format) => {
        try {
            const response = await axios.get(`/api/vault/literature/reviews/${encodeURIComponent(selectedReviewId)}/exports/${format}`, { responseType: 'blob' });
            const url = URL.createObjectURL(response.data);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = response.headers['content-disposition']?.match(/filename="([^"]+)"/)?.[1] || `literature-review.${format === 'prisma-svg' ? 'svg' : format}`;
            anchor.click();
            URL.revokeObjectURL(url);
        } catch (requestError) {
            console.error('Could not export the literature review:', requestError);
            setError(t('literature.review.export_error'));
        }
    };

    const saveStrategy = async () => {
        if (!selectedReviewId || !currentSearch?.id) return;
        setBusy('strategy');
        try {
            await axios.post(`/api/vault/literature/reviews/${encodeURIComponent(selectedReviewId)}/activities`, {
                activity_type: 'search_strategy',
                strategy: { query: currentSearch.query, filters: currentSearch.filters, source_ids: currentSearch.source_ids },
                exact_queries: Object.fromEntries((currentSearch.source_ids || []).map((sourceId) => [sourceId, currentSearch.query])),
                source_snapshot: currentSearch.source_snapshots || [], errors: currentSearch.errors || [],
                counts: { results: currentSearch.result_count || 0 }, ai_audit: {}, export_format: '', notes: '',
            });
            await loadDetail(selectedReviewId);
            toast.success(t('literature.review.strategy_saved'));
        } catch (requestError) {
            console.error('Could not save the literature search strategy:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.strategy_error'));
        } finally { setBusy(''); }
    };

    const runReviewAi = async (operation) => {
        if (!detail?.candidates?.length) return;
        setBusy(`ai:${operation}`);
        try {
            const response = await axios.post('/api/vault/literature/ai', {
                operation, review_id: selectedReviewId,
                payload: { question: detail.review.question, criteria: detail.review.criteria, works: detail.candidates.map((candidate) => candidate.work) },
            });
            setAiInsight(response.data);
        } catch (requestError) {
            console.error('Literature review AI operation failed:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.ai.error'));
        } finally { setBusy(''); }
    };

    const saveSchedule = async () => {
        if (!selectedReviewId) return;
        const existingStrategy = detail?.review?.configuration?.schedule?.strategy || {};
        const strategy = currentSearch?.id ? {
            query: currentSearch.query, filters: currentSearch.filters, source_ids: currentSearch.source_ids,
            limit_per_source: currentSearch.limit_per_source || 25,
        } : existingStrategy;
        if (scheduleEnabled && !strategy.query) {
            setError(t('literature.review.schedule_needs_strategy'));
            return;
        }
        setBusy('schedule');
        try {
            await axios.put(`/api/vault/literature/reviews/${encodeURIComponent(selectedReviewId)}/schedule`, { enabled: scheduleEnabled, interval_days: scheduleDays, strategy });
            await loadDetail(selectedReviewId);
            toast.success(t('literature.review.schedule_saved'));
        } catch (requestError) {
            console.error('Could not save the literature review schedule:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.schedule_error'));
        } finally { setBusy(''); }
    };

    return (
        <div className="literature-review-workspace">
            {error && <div className="literature-alert" role="alert"><CircleAlert size={15} /> {error}</div>}
            <aside className="literature-review-list">
                <h2>{t('literature.review.title')}</h2>
                <label><span>{t('literature.review.question')}</span><textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} /></label>
                <label><span>{t('literature.review.mode')}</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="single">{t('literature.review.single')}</option><option value="dual_blind">{t('literature.review.dual_blind')}</option></select></label>
                {mode === 'dual_blind' && <label><span>{t('literature.review.reviewers')}</span><input value={reviewers} onChange={(event) => setReviewers(event.target.value)} placeholder={t('literature.review.reviewers_placeholder')} /></label>}
                <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!question.trim() || busy === 'create'} onClick={() => void createReview()}><Plus size={15} /> {t('literature.review.create')}</button>
                <div className="literature-review-list__items">{reviews.map((review) => <button type="button" key={review.id} className={selectedReviewId === review.id ? 'is-active' : ''} onClick={() => setSelectedReviewId(review.id)}><strong>{review.title}</strong><span>{review.reviewer_mode === 'dual_blind' ? t('literature.review.dual_blind') : t('literature.review.single')} · {review.status}</span></button>)}</div>
            </aside>
            <section className="literature-review-detail">
                {!detail ? <div className="literature-empty"><BookOpenCheck size={34} /><h2>{t('literature.review.select_title')}</h2><p>{t('literature.review.select_help')}</p></div> : <>
                    <header><div><span>{t('literature.review.eyebrow')}</span><h2>{detail.review.title}</h2><p>{detail.review.question}</p></div><div className="literature-review-detail__actions"><button type="button" className="btn-gnosi-secondary" disabled={!selectedWorks.length || busy === 'candidates'} onClick={() => void addSelected()}><Plus size={14} /> {t('literature.review.add_selected', { count: selectedWorks.length })}</button><button type="button" className="btn-gnosi-secondary" disabled={!currentSearch?.id || busy === 'strategy'} onClick={() => void saveStrategy()}><Archive size={14} /> {t('literature.review.save_strategy')}</button><button type="button" className="btn-gnosi-secondary" disabled={!detail.candidates.length || busy.startsWith('ai:')} onClick={() => void runReviewAi('synthesize')}><Sparkles size={14} /> {t('literature.review.synthesize')}</button><button type="button" className="btn-gnosi-secondary" disabled={!detail.candidates.length || busy.startsWith('ai:')} onClick={() => void runReviewAi('snowball')}><RefreshCw size={14} /> {t('literature.review.snowball')}</button><div className="literature-export-menu"><Download size={14} /><button type="button" onClick={() => void exportReview('csv')}>CSV</button><button type="button" onClick={() => void exportReview('json')}>JSON</button><button type="button" onClick={() => void exportReview('markdown')}>Markdown</button><button type="button" onClick={() => void exportReview('prisma-svg')}>PRISMA SVG</button></div></div></header>
                    {aiInsight && <div className="literature-ai-proposal"><header><Bot size={16} /><strong>{t(`literature.review.ai_${aiInsight.operation}`)}</strong><span>{aiInsight.audit?.model}</span><button type="button" onClick={() => setAiInsight(null)} aria-label={t('common.close')}><X size={14} /></button></header><pre>{JSON.stringify(aiInsight.result, null, 2)}</pre><small>{t('literature.ai.human_control')}</small></div>}
                    <div className="literature-review-schedule"><label><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} /> {t('literature.review.schedule_updates')}</label><label>{t('literature.review.every_days')} <input type="number" min="1" max="365" value={scheduleDays} onChange={(event) => setScheduleDays(Math.max(1, Math.min(365, Number(event.target.value) || 1)))} /></label><button type="button" className="btn-gnosi-secondary" disabled={busy === 'schedule'} onClick={() => void saveSchedule()}>{t('common.save')}</button><small>{t('literature.review.schedule_help')}</small></div>
                    <div className="literature-review-phases">{['identified', 'title_abstract', 'full_text_requested', 'full_text_assessed', 'included', 'excluded'].map((phase) => <span key={phase}><strong>{detail.candidates.filter((candidate) => candidate.phase === phase).length}</strong>{t(`literature.review.phase.${phase}`)}</span>)}</div>
                    <div className="literature-candidates">{detail.candidates.length === 0 ? <div className="literature-empty compact"><Archive size={28} /><p>{t('literature.review.no_candidates')}</p></div> : detail.candidates.map((candidate) => <article key={candidate.id}><div><div className="literature-result__badges"><span>{t(`literature.review.phase.${candidate.phase}`)}</span>{candidate.blind_pending && <span><Users size={11} /> {t('literature.review.blind_pending')}</span>}{candidate.conflict && <span className="is-warning">{t('literature.review.conflict')}</span>}</div><h3>{candidate.title}</h3><p>{candidate.work?.abstract || t('literature.preview.no_abstract')}</p></div><div className="literature-candidate-actions">{candidate.conflict ? <><button type="button" disabled={busy === candidate.id} onClick={() => void resolve(candidate, 'include')}><Check size={14} /> {t('literature.review.resolve_include')}</button><button type="button" disabled={busy === candidate.id} className="is-danger" onClick={() => void resolve(candidate, 'exclude')}><X size={14} /> {t('literature.review.resolve_exclude')}</button></> : <><button type="button" disabled={busy === candidate.id} onClick={() => void decide(candidate, 'include')}><Check size={14} /> {t('literature.review.include')}</button><button type="button" disabled={busy === candidate.id} onClick={() => void decide(candidate, 'uncertain')}>{t('literature.review.uncertain')}</button><button type="button" disabled={busy === candidate.id} className="is-danger" onClick={() => void decide(candidate, 'exclude')}><X size={14} /> {t('literature.review.exclude')}</button></>}</div></article>)}</div>
                </>}
            </section>
        </div>
    );
}

export default function LiteraturePage() {
    const { t } = useTranslation();
    const { isEnabled } = usePlugins();
    const [tab, setTab] = useState('search');
    const [configuration, setConfiguration] = useState({ sources: [] });
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState(EMPTY_FILTERS);
    const [selectedSources, setSelectedSources] = useState(new Set());
    const [searchResult, setSearchResult] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [aiProposal, setAiProposal] = useState(null);
    const pollRef = useRef(null);

    const loadConfiguration = useCallback(async () => {
        try {
            const response = await axios.get('/api/vault/literature/configuration');
            const next = response.data || { sources: [] };
            setConfiguration(next);
            setSelectedSources((current) => current.size ? current : new Set((next.sources || []).filter((source) => source.enabled && source.available && source.automated && !source.hidden).map((source) => source.id)));
        } catch (requestError) {
            console.error('Could not load literature search configuration:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.search.load_error'));
        }
    }, [t]);

    useEffect(() => { void loadConfiguration(); }, [loadConfiguration]);
    useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current); }, []);

    const refreshSearch = useCallback(async (searchId) => {
        try {
            const response = await axios.get(`/api/vault/literature/searches/${encodeURIComponent(searchId)}`, { params: { limit: 200 } });
            setSearchResult(response.data);
            if (['completed', 'cancelled', 'failed'].includes(response.data?.state) && pollRef.current) {
                window.clearInterval(pollRef.current);
                pollRef.current = null;
            }
            return response.data;
        } catch (requestError) {
            console.error('Could not refresh the literature search:', requestError);
            return null;
        }
    }, []);

    const startSearch = async (event) => {
        event.preventDefault();
        if (!query.trim() || !selectedSources.size) return;
        setBusy('search'); setError(''); setSelectedIds(new Set()); setAiProposal(null);
        if (pollRef.current) window.clearInterval(pollRef.current);
        try {
            const response = await axios.post('/api/vault/literature/searches', { query, filters, source_ids: Array.from(selectedSources), limit_per_source: 25 });
            setSearchResult(response.data);
            const refreshed = await refreshSearch(response.data.id);
            if (!['completed', 'cancelled', 'failed'].includes(refreshed?.state)) {
                pollRef.current = window.setInterval(() => void refreshSearch(response.data.id), 900);
            }
        } catch (requestError) {
            console.error('Could not start the literature search:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.search.start_error'));
        } finally { setBusy(''); }
    };

    const runAiQuery = async () => {
        setBusy('ai');
        try {
            const response = await axios.post('/api/vault/literature/ai', { operation: 'query_strategy', payload: { question: query, framework: 'PICO', languages: ['ca', 'es', 'en', 'fr'] } });
            setAiProposal(response.data);
        } catch (requestError) {
            console.error('Literature AI query assistance failed:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.ai.error'));
        } finally { setBusy(''); }
    };

    const importWorks = async (works, sendToNotebook = false) => {
        if (!works.length) return;
        setBusy(sendToNotebook ? 'notebook' : 'import');
        try {
            const response = await axios.post('/api/vault/literature/imports', { works });
            const resourceIds = response.data?.resource_ids || [];
            toast.success(t('literature.import.success', { imported: response.data?.imported_count || 0, existing: response.data?.existing_count || 0 }));
            if (sendToNotebook && resourceIds.length) {
                window.dispatchEvent(new CustomEvent('gnosi:create-notebook', { detail: { resourceIds } }));
            }
            if (searchResult?.id) await refreshSearch(searchResult.id);
        } catch (requestError) {
            console.error('Could not import academic works:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.import.error'));
        } finally { setBusy(''); }
    };

    const results = searchResult?.results || [];
    const selectedWorks = useMemo(() => results.filter((work) => selectedIds.has(work.id)), [results, selectedIds]);

    if (!isEnabled('resources')) {
        return <main className="literature-page"><div className="literature-empty"><LibraryBig size={36} /><h1>{t('literature.disabled.title')}</h1><p>{t('literature.disabled.help')}</p></div></main>;
    }

    return (
        <main className="literature-page">
            <header className="literature-page__header"><div><span>{t('literature.eyebrow')}</span><h1>{t('literature.title')}</h1><p>{t('literature.subtitle')}</p></div><nav aria-label={t('literature.tabs_label')}><button type="button" className={tab === 'search' ? 'is-active' : ''} onClick={() => setTab('search')}><Search size={15} /> {t('literature.tabs.search')}</button><button type="button" className={tab === 'reviews' ? 'is-active' : ''} onClick={() => setTab('reviews')}><BookOpenCheck size={15} /> {t('literature.tabs.reviews')}</button></nav></header>
            {tab === 'reviews' ? <ReviewWorkspace selectedWorks={selectedWorks} currentSearch={searchResult} t={t} /> : <>
                <section className="literature-search-panel">
                    <form onSubmit={startSearch}>
                        <div className="literature-search-box"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('literature.search.placeholder')} aria-label={t('literature.search.query')} /><button type="button" className="literature-ai-button" disabled={!query.trim() || busy === 'ai'} onClick={() => void runAiQuery()} title={t('literature.ai.build_query')}><Sparkles size={16} /> {t('literature.ai.assist')}</button><button type="submit" className="btn-gnosi btn-gnosi-primary" disabled={!query.trim() || !selectedSources.size || busy === 'search'}>{busy === 'search' ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />} {t('literature.search.submit')}</button></div>
                        <div className="literature-search-toolbar"><button type="button" className="literature-link-button" onClick={() => setShowFilters((value) => !value)}><Filter size={14} /> {t('literature.search.filters')} {showFilters ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>{searchResult && <span className={`literature-search-state is-${searchResult.state}`}>{t(`literature.search.state.${searchResult.state}`)} · {t('literature.search.result_count', { count: searchResult.result_count || 0 })}</span>}</div>
                        {showFilters && <div className="literature-filters"><label><span>{t('literature.search.date_from')}</span><input type="date" value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} /></label><label><span>{t('literature.search.date_to')}</span><input type="date" value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} /></label><label><span>{t('literature.search.language')}</span><input value={filters.language} onChange={(event) => setFilters((current) => ({ ...current, language: event.target.value }))} placeholder="ca, es, en…" /></label><label><span>{t('literature.search.document_type')}</span><select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}><option value="">{t('literature.search.any')}</option><option value="journal-article">{t('literature.search.article')}</option><option value="book">{t('literature.search.book')}</option><option value="thesis">{t('literature.search.thesis')}</option><option value="preprint">{t('literature.search.preprint')}</option></select></label><label className="is-check"><input type="checkbox" checked={filters.open_access === true} onChange={(event) => setFilters((current) => ({ ...current, open_access: event.target.checked ? true : null }))} /> {t('literature.search.open_access_only')}</label><label className="is-check"><input type="checkbox" checked={filters.peer_reviewed === true} onChange={(event) => setFilters((current) => ({ ...current, peer_reviewed: event.target.checked ? true : null }))} /> {t('literature.search.peer_reviewed_only')}</label></div>}
                        <SourcePicker sources={configuration.sources || []} selected={selectedSources} statuses={searchResult?.source_status} onChange={(sourceId, checked) => setSelectedSources((current) => { const next = new Set(current); if (checked) next.add(sourceId); else next.delete(sourceId); return next; })} t={t} />
                    </form>
                    {aiProposal && <div className="literature-ai-proposal"><header><Bot size={16} /><strong>{t('literature.ai.proposal')}</strong><span>{aiProposal.audit?.model}</span><button type="button" onClick={() => setAiProposal(null)} aria-label={t('common.close')}><X size={14} /></button></header><pre>{JSON.stringify(aiProposal.result, null, 2)}</pre>{aiProposal.result?.boolean_query && <button type="button" className="btn-gnosi-secondary" onClick={() => setQuery(aiProposal.result.boolean_query)}>{t('literature.ai.use_query')}</button>}<small>{t('literature.ai.human_control')}</small></div>}
                </section>
                {error && <div className="literature-alert" role="alert"><CircleAlert size={16} /> {error}</div>}
                {searchResult?.errors?.length > 0 && <details className="literature-source-errors"><summary>{t('literature.search.partial_errors', { count: searchResult.errors.length })}</summary>{searchResult.errors.map((item, index) => <p key={`${item.source_id}-${index}`}><strong>{item.source_id}</strong> {item.message}</p>)}</details>}
                {selectedWorks.length > 0 && <div className="literature-bulk-bar"><strong>{t('literature.bulk.selected', { count: selectedWorks.length })}</strong><button type="button" className="btn-gnosi-secondary" disabled={busy === 'import'} onClick={() => void importWorks(selectedWorks)}><FilePlus2 size={14} /> {t('literature.bulk.add_resources')}</button><button type="button" className="btn-gnosi btn-gnosi-primary" disabled={busy === 'notebook'} onClick={() => void importWorks(selectedWorks, true)}><NotebookTabs size={14} /> {t('literature.bulk.send_notebook')}</button><button type="button" className="btn-gnosi-secondary" onClick={() => setTab('reviews')}><BookOpenCheck size={14} /> {t('literature.bulk.add_review')}</button></div>}
                <section className="literature-results" aria-live="polite">{!searchResult ? <div className="literature-empty"><LibraryBig size={38} /><h2>{t('literature.empty.title')}</h2><p>{t('literature.empty.help')}</p></div> : results.length === 0 && searchResult.state === 'completed' ? <div className="literature-empty"><Search size={34} /><h2>{t('literature.empty.no_results')}</h2><p>{t('literature.empty.no_results_help')}</p></div> : results.map((work) => <ResultCard key={work.id} work={work} selected={selectedIds.has(work.id)} onSelect={(checked) => setSelectedIds((current) => { const next = new Set(current); if (checked) next.add(work.id); else next.delete(work.id); return next; })} onPreview={() => setPreview(work)} onImport={() => void importWorks([work])} t={t} />)}</section>
                <WorkPreview work={preview} onClose={() => setPreview(null)} onImport={(work) => void importWorks([work])} t={t} />
            </>}
        </main>
    );
}
