import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import {
    Archive, ArrowLeft, BookOpenCheck, Bot, Check, ChevronDown, ChevronRight,
    CircleAlert, Clock3, Download, ExternalLink, Eye, FilePlus2, Filter, LibraryBig,
    LoaderCircle, NotebookTabs, Plus, RefreshCw, Search, Settings, Sparkles, Users, X,
} from 'lucide-react';

import { usePlugins } from '../plugins/usePlugins';
import { useKeyboardScroll } from '../hooks/useKeyboardScroll';
import { toast } from '../lib/toast';
import { AppHeader } from '../components/AppHeader';
import './LiteraturePage.css';

const EMPTY_FILTERS = {
    date_from: '', date_to: '', languages: [], type: '', peer_reviewed: null, open_access: null, full_text: null,
};
const LANGUAGE_OPTIONS = [
    ['ca', 'Català'], ['es', 'Español'], ['en', 'English'], ['fr', 'Français'],
    ['pt', 'Português'], ['de', 'Deutsch'], ['it', 'Italiano'],
];
const SEARCH_PAGE_SIZE = 50;
const TERMINAL_SEARCH_STATES = new Set(['completed', 'cancelled', 'failed']);
const SEARCH_EVENTS = ['source.started', 'source.completed', 'source.failed', 'search.completed', 'search.cancelled', 'search.failed'];

function authorLine(work) {
    return (work.authors || []).map((author) => (
        author.literal || [author.given, author.family].filter(Boolean).join(' ')
    )).filter(Boolean).join('; ');
}

function sourceAvailabilityLabel(source, t) {
    if (source.available) return '';
    if (source.requires_contact) return t('literature.search.source_requires_contact');
    if (source.credential_status === 'missing') return t('literature.search.source_requires_credentials');
    if (source.kind === 'oai') return t('literature.search.source_requires_index');
    return t('literature.search.source_unavailable');
}

function SourcePicker({ sources, selected, onChange, statuses, onConfigure, t }) {
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
                        <label key={source.id} title={sourceAvailabilityLabel(source, t)} className={`literature-source-chip ${selected.has(source.id) ? 'is-selected' : ''} ${!source.available ? 'is-unavailable' : ''}`}>
                            <input type="checkbox" checked={selected.has(source.id)} disabled={!source.available} onChange={(event) => onChange(source.id, event.target.checked)} />
                            <span>{source.name}</span>
                            {status?.state === 'running' && <LoaderCircle size={12} className="spin" />}
                            {status?.state === 'completed' && <small>{status.count}</small>}
                            {status?.state === 'failed' && <CircleAlert size={12} />}
                        </label>
                    );
                })}
            </div>
            <div className="literature-source-picker__actions">
                {automated.length > 12 && (
                    <button type="button" className="literature-link-button" onClick={() => setExpanded((value) => !value)}>
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {expanded ? t('literature.search.show_less_sources') : t('literature.search.show_all_sources')}
                    </button>
                )}
                {automated.some((source) => !source.available) && (
                    <button type="button" className="btn-gnosi btn-gnosi-secondary literature-source-picker__configure-button" onClick={onConfigure}>
                        <Settings size={14} /> {t('literature.search.configure_sources')}
                    </button>
                )}
            </div>
        </div>
    );
}

function LanguageFilter({ value, onChange, t }) {
    const selected = new Set(Array.isArray(value) ? value : []);
    const summary = selected.size
        ? LANGUAGE_OPTIONS.filter(([code]) => selected.has(code)).map(([, label]) => label).join(', ')
        : t('literature.search.any');
    return (
        <div className="literature-language-filter">
            <span>{t('literature.search.language')}</span>
            <details>
                <summary>{summary}</summary>
                <div>{LANGUAGE_OPTIONS.map(([code, label]) => <label key={code}><input type="checkbox" checked={selected.has(code)} onChange={(event) => { const next = new Set(selected); if (event.target.checked) next.add(code); else next.delete(code); onChange(Array.from(next)); }} /> {label}</label>)}</div>
            </details>
        </div>
    );
}

function aiText(value, language) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map((item) => aiText(item, language)).filter(Boolean).join(' · ');
    if (value && typeof value === 'object') {
        const locale = language?.split('-')[0];
        return aiText(value[locale] || value.en || Object.values(value).find((item) => typeof item === 'string') || '', language);
    }
    return '';
}

function AiProposal({ proposal, language, onClose, onUseQuery, onSearch, onUseSourceQuery, t }) {
    const result = proposal?.result || {};
    const [editableQuery, setEditableQuery] = useState(() => result.boolean_query || result.translated_query || '');
    const concepts = Object.entries(result.concepts || {}).filter(([, value]) => aiText(value, language));
    const synonyms = Object.entries(result.synonyms || {}).filter(([, value]) => aiText(value, language));
    const cautions = Array.isArray(result.cautions) ? result.cautions : (result.cautions ? [result.cautions] : result.warnings || []);
    const isTranslation = proposal.operation === 'translate_query';

    return (
        <section className="literature-ai-proposal" aria-label={isTranslation ? t('literature.ai.translation_proposal') : t('literature.ai.proposal')}>
            <header><Bot size={16} /><strong>{isTranslation ? t('literature.ai.translation_proposal') : t('literature.ai.proposal')}</strong><span>{proposal.audit?.model}</span><button type="button" onClick={onClose} aria-label={t('common.close')}><X size={14} /></button></header>
            {concepts.length > 0 && <dl className="literature-ai-proposal__concepts">{concepts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{aiText(value, language)}</dd></div>)}</dl>}
            {synonyms.length > 0 && <div className="literature-ai-proposal__synonyms"><strong>{t('literature.ai.synonyms')}</strong>{synonyms.map(([label, value]) => <p key={label}><span>{label}</span>{aiText(value, language)}</p>)}</div>}
            {editableQuery && <label className="literature-ai-proposal__query"><span>{isTranslation ? t('literature.ai.translated_query') : t('literature.ai.boolean_query')}</span><textarea rows={3} value={editableQuery} onChange={(event) => setEditableQuery(event.target.value)} /></label>}
            {cautions.length > 0 && <ul className="literature-ai-proposal__cautions">{cautions.map((caution, index) => <li key={index}>{aiText(caution, language)}</li>)}</ul>}
            {editableQuery && (isTranslation ? <button type="button" className="btn-gnosi-secondary" onClick={() => onUseSourceQuery(editableQuery)}>{t('literature.ai.use_source_query', { source: result.source_id })}</button> : <div className="literature-ai-proposal__actions"><button type="button" className="btn-gnosi-secondary" onClick={() => onUseQuery(editableQuery)}>{t('literature.ai.use_query')}</button><button type="button" className="btn-gnosi btn-gnosi-primary" onClick={() => onSearch(editableQuery)}><Search size={14} /> {t('literature.ai.search_with_query')}</button></div>)}
            <details className="literature-ai-proposal__technical"><summary>{t('literature.ai.technical_details')}</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
            <small>{t('literature.ai.human_control')}</small>
        </section>
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
                    {work.semantic_rank && <span>{t('literature.result.semantic_rank', { rank: work.semantic_rank, original: work.original_rank })}</span>}
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

function CandidateCard({ candidate, busy, seedSelected, onSeedChange, onDecide, onResolve, onFullText, t }) {
    const [reason, setReason] = useState('');
    const [notes, setNotes] = useState('');
    const [fullTextStatus, setFullTextStatus] = useState(candidate.full_text || 'not_requested');
    const [resourceId, setResourceId] = useState(candidate.resource_id || '');
    const [locationUrl, setLocationUrl] = useState(candidate.full_text_evidence?.location_url || '');
    const [fullTextNotes, setFullTextNotes] = useState(candidate.full_text_evidence?.notes || '');
    const terminal = ['included', 'excluded'].includes(candidate.phase);
    const openLocations = (candidate.work?.locations || []).filter((location) => location.is_oa === true || candidate.work?.open_access?.is_oa === true);

    const submitDecision = (decision) => {
        if (decision === 'exclude' && !reason.trim()) return;
        onDecide(candidate, decision, reason, notes);
    };
    const submitResolution = (decision) => {
        if (decision === 'exclude' && !reason.trim()) return;
        onResolve(candidate, decision, reason, notes);
    };
    const selectedLocation = openLocations.find((location) => [location.url, location.landing_page_url, location.pdf_url].includes(locationUrl));

    return (
        <article>
            <div className="literature-candidate-main">
                <div className="literature-result__badges"><label className="literature-seed-toggle"><input type="checkbox" checked={seedSelected} onChange={(event) => onSeedChange(candidate.id, event.target.checked)} /> {t('literature.review.snowball_seed')}</label><span>{t(`literature.review.phase.${candidate.phase}`)}</span>{candidate.blind_pending && <span><Users size={11} /> {t('literature.review.blind_pending')}</span>}{candidate.conflict && <span className="is-warning">{t('literature.review.conflict')}</span>}<span>{t(`literature.review.full_text_status.${candidate.full_text || 'not_requested'}`)}</span></div>
                <h3>{candidate.title}</h3>
                <p>{candidate.work?.abstract || t('literature.preview.no_abstract')}</p>
                {!terminal && <div className="literature-decision-fields"><label><span>{t('literature.review.exclusion_reason')}</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('literature.review.exclusion_reason_placeholder')} /></label><label><span>{t('literature.review.decision_notes')}</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div>}
            </div>
            {!terminal && <div className="literature-candidate-actions">{candidate.conflict ? <><button type="button" disabled={busy === candidate.id} onClick={() => submitResolution('include')}><Check size={14} /> {t('literature.review.resolve_include')}</button><button type="button" disabled={busy === candidate.id || !reason.trim()} className="is-danger" onClick={() => submitResolution('exclude')}><X size={14} /> {t('literature.review.resolve_exclude')}</button></> : <><button type="button" disabled={busy === candidate.id} onClick={() => submitDecision('include')}><Check size={14} /> {t('literature.review.include')}</button><button type="button" disabled={busy === candidate.id} onClick={() => submitDecision('uncertain')}>{t('literature.review.uncertain')}</button><button type="button" disabled={busy === candidate.id || !reason.trim()} className="is-danger" onClick={() => submitDecision('exclude')}><X size={14} /> {t('literature.review.exclude')}</button></>}</div>}
            <details className="literature-full-text" open={['full_text_requested', 'full_text_assessed'].includes(candidate.phase)}>
                <summary>{t('literature.review.full_text_workflow')}</summary>
                <div><label><span>{t('literature.review.full_text_status_label')}</span><select value={fullTextStatus} onChange={(event) => setFullTextStatus(event.target.value)}>{['not_requested', 'requested', 'available_oa', 'attached', 'unavailable', 'assessed'].map((status) => <option key={status} value={status}>{t(`literature.review.full_text_status.${status}`)}</option>)}</select></label>{fullTextStatus === 'available_oa' && <label><span>{t('literature.review.verified_location')}</span><select value={locationUrl} onChange={(event) => setLocationUrl(event.target.value)}><option value="">{t('literature.review.select_location')}</option>{openLocations.flatMap((location, index) => [location.pdf_url, location.landing_page_url || location.url].filter(Boolean).map((url) => <option key={`${url}-${index}`} value={url}>{location.license || url}</option>))}</select></label>}{fullTextStatus === 'attached' && <label><span>{t('literature.review.resource_id')}</span><input value={resourceId} onChange={(event) => setResourceId(event.target.value)} /></label>}<label><span>{t('literature.review.full_text_notes')}</span><textarea rows={2} value={fullTextNotes} onChange={(event) => setFullTextNotes(event.target.value)} /></label><button type="button" className="btn-gnosi-secondary" disabled={busy === `full-text:${candidate.id}` || (fullTextStatus === 'available_oa' && !locationUrl) || (fullTextStatus === 'attached' && !resourceId.trim())} onClick={() => onFullText(candidate, { status: fullTextStatus, location_url: locationUrl, license: selectedLocation?.license || '', resource_id: resourceId, notes: fullTextNotes })}>{t('literature.review.save_full_text')}</button></div>
            </details>
        </article>
    );
}

function ReviewWorkspace({ selectedWorks, currentSearch, t }) {
    const [reviews, setReviews] = useState([]);
    const [selectedReviewId, setSelectedReviewId] = useState('');
    const [detail, setDetail] = useState(null);
    const [question, setQuestion] = useState('');
    const [protocol, setProtocol] = useState('');
    const [includeCriteria, setIncludeCriteria] = useState('');
    const [excludeCriteria, setExcludeCriteria] = useState('');
    const [mode, setMode] = useState('single');
    const [reviewers, setReviewers] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [aiInsight, setAiInsight] = useState(null);
    const [scheduleEnabled, setScheduleEnabled] = useState(false);
    const [scheduleDays, setScheduleDays] = useState(7);
    const [snowballDirection, setSnowballDirection] = useState('both');
    const [snowballSeedIds, setSnowballSeedIds] = useState(new Set());
    const [snowballResult, setSnowballResult] = useState(null);
    const [snowballSelectedIds, setSnowballSelectedIds] = useState(new Set());

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
            setSnowballSeedIds((current) => {
                const available = new Set((response.data?.candidates || []).map((candidate) => candidate.id));
                return new Set([...current].filter((candidateId) => available.has(candidateId)));
            });
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
                protocol,
                criteria: {
                    include: includeCriteria.split('\n').map((value) => value.trim()).filter(Boolean),
                    exclude: excludeCriteria.split('\n').map((value) => value.trim()).filter(Boolean),
                },
                configuration: {},
            });
            setQuestion('');
            setProtocol('');
            setIncludeCriteria('');
            setExcludeCriteria('');
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

    const decide = async (candidate, decision, reason, notes) => {
        setBusy(candidate.id);
        try {
            await axios.post(`/api/vault/literature/reviews/${encodeURIComponent(selectedReviewId)}/candidates/${encodeURIComponent(candidate.id)}/decisions`, { phase: candidate.phase, decision, reason, notes });
            await loadDetail(selectedReviewId);
        } catch (requestError) {
            console.error('Could not save the screening decision:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.decision_error'));
        } finally { setBusy(''); }
    };

    const resolve = async (candidate, decision, reason, notes) => {
        setBusy(candidate.id);
        try {
            await axios.post(`/api/vault/literature/reviews/${encodeURIComponent(selectedReviewId)}/candidates/${encodeURIComponent(candidate.id)}/consensus`, { decision, reason: reason || t('literature.review.consensus_reason'), notes });
            await loadDetail(selectedReviewId);
        } catch (requestError) {
            console.error('Could not resolve the screening conflict:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.decision_error'));
        } finally { setBusy(''); }
    };

    const updateFullText = async (candidate, payload) => {
        setBusy(`full-text:${candidate.id}`);
        try {
            await axios.put(`/api/vault/literature/reviews/${encodeURIComponent(selectedReviewId)}/candidates/${encodeURIComponent(candidate.id)}/full-text`, payload);
            await loadDetail(selectedReviewId);
            toast.success(t('literature.review.full_text_saved'));
        } catch (requestError) {
            console.error('Could not update the full-text workflow:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.full_text_error'));
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
                strategy: { query: currentSearch.query, filters: currentSearch.filters, source_ids: currentSearch.source_ids, source_queries: currentSearch.source_queries || {} },
                exact_queries: currentSearch.exact_queries || {},
                source_snapshot: currentSearch.source_snapshots || [], errors: currentSearch.errors || [],
                counts: { search_id: currentSearch.id, ...(currentSearch.counts || {}), results: currentSearch.result_count || 0 }, ai_audit: { operations: currentSearch.ai_audits || [] }, export_format: '', notes: '',
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

    const runSnowball = async () => {
        const seeds = (detail?.candidates || []).filter((candidate) => snowballSeedIds.has(candidate.id)).map((candidate) => candidate.work);
        if (!seeds.length) return;
        setBusy('snowball');
        try {
            const response = await axios.post(`/api/vault/literature/reviews/${encodeURIComponent(selectedReviewId)}/snowball`, { seeds, direction: snowballDirection, limit_per_seed: 25 });
            setSnowballResult(response.data);
            setSnowballSelectedIds(new Set());
        } catch (requestError) {
            console.error('Citation expansion failed:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.snowball_error'));
        } finally { setBusy(''); }
    };

    const addSnowballCandidates = async () => {
        const works = (snowballResult?.works || []).filter((work) => snowballSelectedIds.has(work.id));
        if (!works.length) return;
        setBusy('snowball-add');
        try {
            await axios.post(`/api/vault/literature/reviews/${encodeURIComponent(selectedReviewId)}/candidates`, { works, activity_id: snowballResult.activity_id || '' });
            await loadDetail(selectedReviewId);
            setSnowballResult(null);
            setSnowballSelectedIds(new Set());
            toast.success(t('literature.review.candidates_added'));
        } catch (requestError) {
            console.error('Could not add citation candidates:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.review.candidates_error'));
        } finally { setBusy(''); }
    };

    const saveSchedule = async () => {
        if (!selectedReviewId) return;
        const existingStrategy = detail?.review?.configuration?.schedule?.strategy || {};
        const strategy = currentSearch?.id ? {
            query: currentSearch.query, filters: currentSearch.filters, source_ids: currentSearch.source_ids,
            source_queries: currentSearch.source_queries || {},
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
                <label><span>{t('literature.review.protocol')}</span><textarea value={protocol} onChange={(event) => setProtocol(event.target.value)} rows={4} placeholder={t('literature.review.protocol_placeholder')} /></label>
                <label><span>{t('literature.review.include_criteria')}</span><textarea value={includeCriteria} onChange={(event) => setIncludeCriteria(event.target.value)} rows={3} placeholder={t('literature.review.criteria_placeholder')} /></label>
                <label><span>{t('literature.review.exclude_criteria')}</span><textarea value={excludeCriteria} onChange={(event) => setExcludeCriteria(event.target.value)} rows={3} placeholder={t('literature.review.criteria_placeholder')} /></label>
                <label><span>{t('literature.review.mode')}</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="single">{t('literature.review.single')}</option><option value="dual_blind">{t('literature.review.dual_blind')}</option></select></label>
                {mode === 'dual_blind' && <label><span>{t('literature.review.reviewers')}</span><input value={reviewers} onChange={(event) => setReviewers(event.target.value)} placeholder={t('literature.review.reviewers_placeholder')} /></label>}
                <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!question.trim() || busy === 'create'} onClick={() => void createReview()}><Plus size={15} /> {t('literature.review.create')}</button>
                <div className="literature-review-list__items">{reviews.map((review) => <button type="button" key={review.id} className={selectedReviewId === review.id ? 'is-active' : ''} onClick={() => setSelectedReviewId(review.id)}><strong>{review.title}</strong><span>{review.reviewer_mode === 'dual_blind' ? t('literature.review.dual_blind') : t('literature.review.single')} · {review.status}</span></button>)}</div>
            </aside>
            <section className="literature-review-detail">
                {!detail ? <div className="literature-empty"><BookOpenCheck size={34} /><h2>{t('literature.review.select_title')}</h2><p>{t('literature.review.select_help')}</p></div> : <>
                    <header><div><span>{t('literature.review.eyebrow')}</span><h2>{detail.review.title}</h2><p>{detail.review.question}</p></div><div className="literature-review-detail__actions"><button type="button" className="btn-gnosi-secondary" disabled={!selectedWorks.length || busy === 'candidates'} onClick={() => void addSelected()}><Plus size={14} /> {t('literature.review.add_selected', { count: selectedWorks.length })}</button><button type="button" className="btn-gnosi-secondary" disabled={!currentSearch?.id || busy === 'strategy'} onClick={() => void saveStrategy()}><Archive size={14} /> {t('literature.review.save_strategy')}</button><button type="button" className="btn-gnosi-secondary" disabled={!detail.candidates.length || busy.startsWith('ai:')} onClick={() => void runReviewAi('screen')}><Bot size={14} /> {t('literature.review.screen_suggestions')}</button><button type="button" className="btn-gnosi-secondary" disabled={!detail.candidates.length || busy.startsWith('ai:')} onClick={() => void runReviewAi('synthesize')}><Sparkles size={14} /> {t('literature.review.synthesize')}</button><div className="literature-snowball-action"><select value={snowballDirection} onChange={(event) => setSnowballDirection(event.target.value)} aria-label={t('literature.review.snowball_direction')}><option value="both">{t('literature.review.snowball_both')}</option><option value="backward">{t('literature.review.snowball_backward')}</option><option value="forward">{t('literature.review.snowball_forward')}</option></select><button type="button" className="btn-gnosi-secondary" disabled={!snowballSeedIds.size || busy === 'snowball'} onClick={() => void runSnowball()}><RefreshCw size={14} /> {t('literature.review.snowball')}</button></div><div className="literature-export-menu"><Download size={14} /><button type="button" onClick={() => void exportReview('csv')}>CSV</button><button type="button" onClick={() => void exportReview('json')}>JSON</button><button type="button" onClick={() => void exportReview('markdown')}>Markdown</button><button type="button" onClick={() => void exportReview('prisma-svg')}>PRISMA SVG</button></div></div></header>
                    {aiInsight && <div className="literature-ai-proposal"><header><Bot size={16} /><strong>{t(`literature.review.ai_${aiInsight.operation}`)}</strong><span>{aiInsight.audit?.model}</span><button type="button" onClick={() => setAiInsight(null)} aria-label={t('common.close')}><X size={14} /></button></header><pre>{JSON.stringify(aiInsight.result, null, 2)}</pre><small>{t('literature.ai.human_control')}</small></div>}
                    <details className="literature-review-protocol"><summary>{t('literature.review.protocol_and_criteria')}</summary><h3>{t('literature.review.protocol')}</h3><p>{detail.review.protocol || t('literature.review.not_recorded')}</p><h3>{t('literature.review.include_criteria')}</h3><ul>{(detail.review.criteria?.include || []).map((criterion) => <li key={criterion}>{criterion}</li>)}</ul><h3>{t('literature.review.exclude_criteria')}</h3><ul>{(detail.review.criteria?.exclude || []).map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></details>
                    <details className="literature-review-protocol"><summary>{t('literature.review.audit_trail', { count: detail.activities?.length || 0 })}</summary>{(detail.activities || []).length === 0 ? <p>{t('literature.review.no_activities')}</p> : (detail.activities || []).map((activity) => <article key={activity.id}><header><strong>{activity.activity_type}</strong><time>{activity.occurred_at ? new Date(activity.occurred_at).toLocaleString() : ''}</time></header><small>{t('literature.review.activity_version', { version: activity.version || 1 })}</small>{Object.keys(activity.exact_queries || {}).length > 0 && <pre>{JSON.stringify(activity.exact_queries, null, 2)}</pre>}{activity.errors?.length > 0 && <p className="is-error">{t('literature.review.activity_errors', { count: activity.errors.length })}</p>}</article>)}</details>
                    <div className="literature-review-schedule"><label><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} /> {t('literature.review.schedule_updates')}</label><label>{t('literature.review.every_days')} <input type="number" min="1" max="365" value={scheduleDays} onChange={(event) => setScheduleDays(Math.max(1, Math.min(365, Number(event.target.value) || 1)))} /></label><button type="button" className="btn-gnosi-secondary" disabled={busy === 'schedule'} onClick={() => void saveSchedule()}>{t('common.save')}</button><small>{t('literature.review.schedule_help')}</small></div>
                    <div className="literature-review-phases">{['identified', 'title_abstract', 'full_text_requested', 'full_text_assessed', 'included', 'excluded'].map((phase) => <span key={phase}><strong>{detail.candidates.filter((candidate) => candidate.phase === phase).length}</strong>{t(`literature.review.phase.${phase}`)}</span>)}</div>
                    {detail.prisma && <div className="literature-prisma-summary"><span><strong>{detail.prisma.identified}</strong>{t('literature.review.prisma_identified')}</span><span><strong>{detail.prisma.duplicates_removed}</strong>{t('literature.review.prisma_duplicates')}</span><span><strong>{detail.prisma.screened}</strong>{t('literature.review.prisma_screened')}</span><span><strong>{detail.prisma.included}</strong>{t('literature.review.prisma_included')}</span></div>}
                    {snowballResult && <section className="literature-snowball-results"><header><div><strong>{t('literature.review.snowball_results')}</strong><small>{snowballResult.provider} · {t('literature.search.result_count', { count: snowballResult.works?.length || 0 })}</small></div><button type="button" className="literature-icon-button" onClick={() => setSnowballResult(null)} aria-label={t('common.close')}><X size={14} /></button></header><div>{(snowballResult.works || []).map((work) => <label key={work.id}><input type="checkbox" checked={snowballSelectedIds.has(work.id)} onChange={(event) => setSnowballSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(work.id); else next.delete(work.id); return next; })} /><span><strong>{work.title}</strong><small>{authorLine(work)} {work.year ? `· ${work.year}` : ''}</small></span></label>)}</div><button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!snowballSelectedIds.size || busy === 'snowball-add'} onClick={() => void addSnowballCandidates()}><Plus size={14} /> {t('literature.review.add_snowball_selected', { count: snowballSelectedIds.size })}</button><small>{t('literature.review.snowball_human_add')}</small></section>}
                    {snowballSeedIds.size > 0 && <small className="literature-seed-count">{t('literature.review.snowball_seed_count', { count: snowballSeedIds.size, max: 20 })}</small>}
                    <div className="literature-candidates">{detail.candidates.length === 0 ? <div className="literature-empty compact"><Archive size={28} /><p>{t('literature.review.no_candidates')}</p></div> : detail.candidates.map((candidate) => <CandidateCard key={`${candidate.id}:${candidate.phase}:${candidate.full_text}:${candidate.resource_id || ''}:${candidate.full_text_evidence?.location_url || ''}:${candidate.full_text_evidence?.notes || ''}`} candidate={candidate} busy={busy} seedSelected={snowballSeedIds.has(candidate.id)} onSeedChange={(candidateId, checked) => setSnowballSeedIds((current) => { const next = new Set(current); if (checked && next.size < 20) next.add(candidateId); else if (!checked) next.delete(candidateId); return next; })} onDecide={(...args) => void decide(...args)} onResolve={(...args) => void resolve(...args)} onFullText={(...args) => void updateFullText(...args)} t={t} />)}</div>
                </>}
            </section>
        </div>
    );
}

export default function LiteraturePage() {
    const { t, i18n = { language: 'en' } } = useTranslation();
    const { isEnabled } = usePlugins();
    const [tab, setTab] = useState('search');
    const [configuration, setConfiguration] = useState({ sources: [] });
    const [aiAgentId, setAiAgentId] = useState('');
    const [query, setQuery] = useState('');
    const [sourceQueries, setSourceQueries] = useState({});
    const [filters, setFilters] = useState(EMPTY_FILTERS);
    const [selectedSources, setSelectedSources] = useState(new Set());
    const [searchResult, setSearchResult] = useState(null);
    const [searchHistory, setSearchHistory] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [resultOffset, setResultOffset] = useState(0);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [selectedWorkMap, setSelectedWorkMap] = useState(new Map());
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [showFilters, setShowFilters] = useState(false);
    const [aiProposal, setAiProposal] = useState(null);
    const [aiAudits, setAiAudits] = useState([]);
    const [rerankAudit, setRerankAudit] = useState(null);
    const [manualValue, setManualValue] = useState('');
    const [manualKind, setManualKind] = useState('auto');
    const [manualWork, setManualWork] = useState(null);
    const queryInputRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const pollRef = useRef(null);
    const eventSourceRef = useRef(null);
    const eventCursorRef = useRef(0);
    const resultOffsetRef = useRef(0);

    useKeyboardScroll(scrollContainerRef, { modalOpen: Boolean(preview || aiProposal) });

    const loadConfiguration = useCallback(async () => {
        try {
            const response = await axios.get('/api/vault/literature/configuration');
            const next = response.data || { sources: [] };
            setConfiguration(next);
            setAiAgentId((current) => current || next.ai_agent_id || next.ai_agents?.[0]?.id || '');
            setSelectedSources((current) => current.size ? current : new Set((next.sources || []).filter((source) => source.enabled && source.available && source.automated && !source.hidden).map((source) => source.id)));
        } catch (requestError) {
            console.error('Could not load literature search configuration:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.search.load_error'));
        }
    }, [t]);

    const loadSearchHistory = useCallback(async () => {
        try {
            const response = await axios.get('/api/vault/literature/searches', { params: { limit: 50 } });
            setSearchHistory(response.data?.searches || []);
        } catch (requestError) {
            console.error('Could not load literature search history:', requestError);
        }
    }, []);

    useEffect(() => { void loadConfiguration(); void loadSearchHistory(); }, [loadConfiguration, loadSearchHistory]);

    const stopProgress = useCallback(() => {
        if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
        }
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
    }, []);

    useEffect(() => () => stopProgress(), [stopProgress]);

    const refreshSearch = useCallback(async (searchId, offset = resultOffsetRef.current) => {
        try {
            const response = await axios.get(`/api/vault/literature/searches/${encodeURIComponent(searchId)}`, { params: { offset, limit: SEARCH_PAGE_SIZE } });
            setSearchResult(response.data);
            if (TERMINAL_SEARCH_STATES.has(response.data?.state)) {
                stopProgress();
                void loadSearchHistory();
            }
            return response.data;
        } catch (requestError) {
            console.error('Could not refresh the literature search:', requestError);
            return null;
        }
    }, [loadSearchHistory, stopProgress]);

    const startPolling = useCallback((searchId) => {
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = window.setInterval(() => void refreshSearch(searchId), 1_500);
    }, [refreshSearch]);

    const followSearch = useCallback((searchId) => {
        stopProgress();
        if (typeof window.EventSource !== 'function') {
            startPolling(searchId);
            return;
        }
        const stream = new window.EventSource(`/api/vault/literature/searches/${encodeURIComponent(searchId)}/events?after=${eventCursorRef.current}`);
        eventSourceRef.current = stream;
        SEARCH_EVENTS.forEach((eventName) => stream.addEventListener(eventName, (event) => {
            const sequence = Number(event.lastEventId || 0);
            if (sequence > eventCursorRef.current) eventCursorRef.current = sequence;
            void refreshSearch(searchId);
        }));
        stream.onerror = () => {
            if (eventSourceRef.current === stream) {
                stream.close();
                eventSourceRef.current = null;
                startPolling(searchId);
            }
        };
    }, [refreshSearch, startPolling, stopProgress]);

    const openSearch = useCallback(async (searchId, offset = 0) => {
        stopProgress();
        resultOffsetRef.current = offset;
        setResultOffset(offset);
        setSelectedIds(new Set());
        setSelectedWorkMap(new Map());
        setRerankAudit(null);
        eventCursorRef.current = 0;
        const loaded = await refreshSearch(searchId, offset);
        if (loaded) {
            setQuery(loaded.query || '');
            const loadedFilters = loaded.filters || {};
            const legacyLanguages = String(loadedFilters.language || '').split(/[,;\s]+/).filter(Boolean);
            setFilters({ ...EMPTY_FILTERS, ...loadedFilters, languages: Array.isArray(loadedFilters.languages) ? loadedFilters.languages : legacyLanguages });
            setSelectedSources(new Set(loaded.source_ids || []));
            setSourceQueries(loaded.source_queries || {});
            setAiAudits(loaded.ai_audits || []);
            if (!TERMINAL_SEARCH_STATES.has(loaded.state)) followSearch(searchId);
        }
    }, [followSearch, refreshSearch, stopProgress]);

    const executeSearch = async (searchQuery) => {
        const normalizedQuery = String(searchQuery || '').trim();
        if (!normalizedQuery || !selectedSources.size) return;
        setBusy('search'); setError(''); setSelectedIds(new Set()); setSelectedWorkMap(new Map()); setAiProposal(null); setRerankAudit(null);
        stopProgress();
        resultOffsetRef.current = 0;
        setResultOffset(0);
        eventCursorRef.current = 0;
        try {
            const response = await axios.post('/api/vault/literature/searches', { query: normalizedQuery, filters, source_ids: Array.from(selectedSources), source_queries: sourceQueries, ai_audits: aiAudits, limit_per_source: 25 });
            setSearchResult(response.data);
            const refreshed = await refreshSearch(response.data.id, 0);
            if (!TERMINAL_SEARCH_STATES.has(refreshed?.state)) followSearch(response.data.id);
        } catch (requestError) {
            console.error('Could not start the literature search:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.search.start_error'));
        } finally { setBusy(''); }
    };

    const startSearch = async (event) => {
        event.preventDefault();
        await executeSearch(query);
    };

    const cancelSearch = async () => {
        if (!searchResult?.id || TERMINAL_SEARCH_STATES.has(searchResult.state)) return;
        setBusy('cancel');
        try {
            await axios.delete(`/api/vault/literature/searches/${encodeURIComponent(searchResult.id)}`);
            await refreshSearch(searchResult.id);
        } catch (requestError) {
            console.error('Could not cancel the literature search:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.search.cancel_error'));
        } finally { setBusy(''); }
    };

    const changePage = async (nextOffset) => {
        if (!searchResult?.id) return;
        const bounded = Math.max(0, nextOffset);
        resultOffsetRef.current = bounded;
        setResultOffset(bounded);
        await refreshSearch(searchResult.id, bounded);
    };

    const runAiQuery = async () => {
        if (!query.trim()) {
            queryInputRef.current?.focus();
            toast.error(t('literature.ai.enter_question'));
            return;
        }
        setBusy('ai');
        try {
            const response = await axios.post('/api/vault/literature/ai', { operation: 'query_strategy', agent_id: aiAgentId, payload: { question: query, framework: 'AUTO', languages: ['ca', 'es', 'en', 'fr'] } });
            setAiProposal(response.data);
            setAiAudits((current) => [...current, { operation: response.data?.operation, ...(response.data?.audit || {}) }].slice(-50));
        } catch (requestError) {
            console.error('Literature AI query assistance failed:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.ai.error'));
        } finally { setBusy(''); }
    };

    const runAiTranslation = async (sourceId) => {
        if (!query.trim()) return;
        setBusy(`translate:${sourceId}`);
        try {
            const response = await axios.post('/api/vault/literature/ai', { operation: 'translate_query', agent_id: aiAgentId, payload: { query, source_id: sourceId } });
            setAiProposal(response.data);
            setAiAudits((current) => [...current, { operation: response.data?.operation, ...(response.data?.audit || {}) }].slice(-50));
        } catch (requestError) {
            console.error('Literature source query translation failed:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.ai.error'));
        } finally { setBusy(''); }
    };

    const changeAiAgent = async (agentId) => {
        setAiAgentId(agentId);
        try {
            await axios.put('/api/vault/literature/configuration', { ai_agent_id: agentId });
            setConfiguration((current) => ({ ...current, ai_agent_id: agentId }));
        } catch (requestError) {
            console.error('Could not save the literature AI agent:', requestError);
            toast.error(t('literature.ai.agent_save_error'));
        }
    };

    const rerankResults = async () => {
        if (!results.length || !searchResult?.query) return;
        setBusy('rerank');
        try {
            const response = await axios.post('/api/vault/literature/ai', { operation: 'rerank', search_id: searchResult.id, payload: { mode: 'local', query: searchResult.query, works: results } });
            const ranks = new Map((response.data?.result?.ranking || []).map((item) => [item.id, item]));
            const auditEntry = { operation: response.data?.operation, ...(response.data?.audit || {}) };
            setAiAudits((current) => [...current, auditEntry].slice(-50));
            setSearchResult((current) => ({
                ...current,
                ai_audits: [...(current?.ai_audits || []), auditEntry].slice(-50),
                results: [...(current?.results || [])].map((work) => ({ ...work, semantic_rank: ranks.get(work.id)?.semantic_rank, original_rank: ranks.get(work.id)?.original_rank })).sort((left, right) => (left.semantic_rank || Number.MAX_SAFE_INTEGER) - (right.semantic_rank || Number.MAX_SAFE_INTEGER)),
            }));
            setRerankAudit(response.data?.audit || null);
        } catch (requestError) {
            console.error('Local literature reranking failed:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.ai.rerank_error'));
        } finally { setBusy(''); }
    };

    const captureManualWork = async (event) => {
        event.preventDefault();
        if (!manualValue.trim()) return;
        setBusy('manual');
        setError('');
        try {
            const response = await axios.post('/api/vault/literature/manual-capture', { value: manualValue.trim(), kind: manualKind });
            setManualWork(response.data?.work || null);
        } catch (requestError) {
            console.error('Could not capture the manually discovered work:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.manual.error'));
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
            const manualMembership = [...(response.data?.imported || []), ...(response.data?.existing || [])].find((item) => item.work_id === manualWork?.id);
            if (manualMembership) {
                setManualWork((current) => current ? { ...current, in_resources: true, resource_id: manualMembership.resource_id } : current);
                setPreview((current) => current?.id === manualMembership.work_id ? { ...current, in_resources: true, resource_id: manualMembership.resource_id } : current);
            }
            if (searchResult?.id) await refreshSearch(searchResult.id);
        } catch (requestError) {
            console.error('Could not import academic works:', requestError);
            setError(requestError?.response?.data?.detail || t('literature.import.error'));
        } finally { setBusy(''); }
    };

    const results = searchResult?.results || [];
    const selectedWorks = useMemo(() => Array.from(selectedWorkMap.values()), [selectedWorkMap]);
    const toggleWork = useCallback((work, checked) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (checked) next.add(work.id); else next.delete(work.id);
            return next;
        });
        setSelectedWorkMap((current) => {
            const next = new Map(current);
            if (checked) next.set(work.id, work); else next.delete(work.id);
            return next;
        });
    }, []);

    const openResourcesSettings = () => {
        try {
            window.sessionStorage.setItem('gnosi:configure-plugin', 'resources');
        } catch {
            // Settings can still be opened when session storage is unavailable.
        }
        window.dispatchEvent(new CustomEvent('open-settings', {
            detail: { tab: 'plugins', pluginId: 'resources' },
        }));
    };

    if (!isEnabled('resources')) {
        return <main className="literature-page"><div className="literature-empty"><LibraryBig size={36} /><h1>{t('literature.disabled.title')}</h1><p>{t('literature.disabled.help')}</p></div></main>;
    }

    return (
        <main className="literature-page">
            <AppHeader icon={LibraryBig} title={t('literature.title')}>
                <nav className="literature-page__tabs" aria-label={t('literature.tabs_label')}><button type="button" className={tab === 'search' ? 'is-active' : ''} onClick={() => setTab('search')}><Search size={15} /> {t('literature.tabs.search')}</button><button type="button" className={tab === 'reviews' ? 'is-active' : ''} onClick={() => setTab('reviews')}><BookOpenCheck size={15} /> {t('literature.tabs.reviews')}</button></nav>
            </AppHeader>
            <div className="literature-page__scroll" ref={scrollContainerRef}>
                <div className="literature-page__content">
                    {tab === 'reviews' ? <ReviewWorkspace selectedWorks={selectedWorks} currentSearch={searchResult} t={t} /> : <>
                        <section className="literature-search-panel">
                            <form onSubmit={startSearch}>
                                <div className="literature-search-box"><Search size={19} /><input ref={queryInputRef} value={query} onChange={(event) => { setQuery(event.target.value); setSourceQueries({}); setAiProposal(null); setAiAudits([]); }} placeholder={t('literature.search.placeholder')} aria-label={t('literature.search.query')} />{configuration.ai_agents?.length > 0 && <select className="literature-ai-agent" value={aiAgentId} onChange={(event) => void changeAiAgent(event.target.value)} aria-label={t('literature.ai.agent')} title={t('literature.ai.agent')}><option value="">{t('literature.ai.default_agent')}</option>{configuration.ai_agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.model ? ` · ${agent.model}` : ''}</option>)}</select>}<button type="button" className="literature-ai-button" aria-busy={busy === 'ai'} disabled={busy === 'ai'} onClick={() => void runAiQuery()} title={t('literature.ai.build_query')}>{busy === 'ai' ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />} {busy === 'ai' ? t('literature.ai.generating') : t('literature.ai.assist')}</button><button type="submit" className="btn-gnosi btn-gnosi-primary" disabled={!query.trim() || !selectedSources.size || busy === 'search'}>{busy === 'search' ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />} {t('literature.search.submit')}</button></div>
                                <div className="literature-search-toolbar"><button type="button" className="literature-link-button" onClick={() => setShowFilters((value) => !value)}><Filter size={14} /> {t('literature.search.filters')} {showFilters ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button><button type="button" className="literature-link-button" onClick={() => setShowHistory((value) => !value)}><Clock3 size={14} /> {t('literature.search.history')}</button>{results.length > 1 && <button type="button" className="literature-link-button" disabled={busy === 'rerank'} onClick={() => void rerankResults()}><Sparkles size={14} /> {t('literature.ai.rerank')}</button>}{rerankAudit && <span className="literature-search-state">{t('literature.ai.reranked_by', { model: rerankAudit.model })}</span>}{searchResult && <span className={`literature-search-state is-${searchResult.state}`}>{t(`literature.search.state.${searchResult.state}`)} · {t('literature.search.result_count', { count: searchResult.result_count || 0 })}</span>}{searchResult && !TERMINAL_SEARCH_STATES.has(searchResult.state) && <button type="button" className="literature-link-button is-danger" disabled={busy === 'cancel'} onClick={() => void cancelSearch()}><X size={14} /> {t('literature.search.cancel')}</button>}</div>
                                {showFilters && <div className="literature-filters"><label><span>{t('literature.search.date_from')}</span><input type="date" value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} /></label><label><span>{t('literature.search.date_to')}</span><input type="date" value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} /></label><LanguageFilter value={filters.languages} onChange={(languages) => setFilters((current) => ({ ...current, languages }))} t={t} /><label><span>{t('literature.search.document_type')}</span><select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}><option value="">{t('literature.search.any')}</option><option value="journal-article">{t('literature.search.article')}</option><option value="book">{t('literature.search.book')}</option><option value="thesis">{t('literature.search.thesis')}</option><option value="preprint">{t('literature.search.preprint')}</option></select></label><label className="is-check"><input type="checkbox" checked={filters.open_access === true} onChange={(event) => setFilters((current) => ({ ...current, open_access: event.target.checked ? true : null }))} /> {t('literature.search.open_access_only')}</label><label className="is-check"><input type="checkbox" checked={filters.full_text === true} onChange={(event) => setFilters((current) => ({ ...current, full_text: event.target.checked ? true : null }))} /> {t('literature.search.full_text_only')}</label><label className="is-check"><input type="checkbox" checked={filters.peer_reviewed === true} onChange={(event) => setFilters((current) => ({ ...current, peer_reviewed: event.target.checked ? true : null }))} /> {t('literature.search.peer_reviewed_only')}</label></div>}
                                <SourcePicker sources={configuration.sources || []} selected={selectedSources} statuses={searchResult?.source_status} onConfigure={openResourcesSettings} onChange={(sourceId, checked) => setSelectedSources((current) => { const next = new Set(current); if (checked) next.add(sourceId); else next.delete(sourceId); return next; })} t={t} />
                                <details className="literature-source-queries"><summary>{t('literature.search.source_queries')}</summary><p>{t('literature.search.source_queries_help')}</p>{(configuration.sources || []).filter((source) => selectedSources.has(source.id)).map((source) => <label key={source.id}><span>{source.name}</span><textarea rows={2} value={sourceQueries[source.id] || ''} onChange={(event) => setSourceQueries((current) => ({ ...current, [source.id]: event.target.value }))} placeholder={query || t('literature.search.query')} /><button type="button" className="btn-gnosi-secondary" disabled={!query.trim() || busy === `translate:${source.id}`} onClick={() => void runAiTranslation(source.id)}><Sparkles size={14} /> {t('literature.ai.translate_source')}</button></label>)}</details>
                            </form>
                            {showHistory && <div className="literature-search-history"><header><strong>{t('literature.search.history')}</strong><button type="button" className="literature-icon-button" onClick={() => void loadSearchHistory()} aria-label={t('literature.search.refresh_history')}><RefreshCw size={14} /></button></header>{searchHistory.length === 0 ? <p>{t('literature.search.no_history')}</p> : searchHistory.map((item) => <button type="button" key={item.id} className={searchResult?.id === item.id ? 'is-active' : ''} onClick={() => void openSearch(item.id)}><span>{item.query}</span><small>{t(`literature.search.state.${item.state}`)} · {t('literature.search.result_count', { count: item.result_count || 0 })}</small></button>)}</div>}
                            {aiProposal && <AiProposal proposal={aiProposal} language={i18n.language} onClose={() => setAiProposal(null)} onUseQuery={(nextQuery) => { setQuery(nextQuery); setSourceQueries({}); setAiProposal(null); queryInputRef.current?.focus(); }} onSearch={(nextQuery) => { setQuery(nextQuery); setSourceQueries({}); void executeSearch(nextQuery); }} onUseSourceQuery={(nextQuery) => setSourceQueries((current) => ({ ...current, [aiProposal.result?.source_id]: nextQuery }))} t={t} />}
                            <details className="literature-manual-capture"><summary>{t('literature.manual.title')}</summary><p>{t('literature.manual.help')}</p><form onSubmit={captureManualWork}><select value={manualKind} onChange={(event) => setManualKind(event.target.value)} aria-label={t('literature.manual.kind')}>{['auto', 'doi', 'pmid', 'arxiv', 'isbn', 'url'].map((kind) => <option key={kind} value={kind}>{t(`literature.manual.kind_${kind}`)}</option>)}</select><input value={manualValue} onChange={(event) => setManualValue(event.target.value)} placeholder={t('literature.manual.placeholder')} aria-label={t('literature.manual.value')} /><button type="submit" className="btn-gnosi-secondary" disabled={!manualValue.trim() || busy === 'manual'}>{busy === 'manual' ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />} {t('literature.manual.preview')}</button></form>{manualWork && <article><div><strong>{manualWork.title}</strong><small>{authorLine(manualWork)} {manualWork.year ? `· ${manualWork.year}` : ''}</small></div><div><button type="button" className="btn-gnosi-secondary" onClick={() => setPreview(manualWork)}><Eye size={14} /> {t('literature.result.view')}</button><button type="button" className="btn-gnosi btn-gnosi-primary" disabled={manualWork.in_resources} onClick={() => void importWorks([manualWork])}><FilePlus2 size={14} /> {manualWork.in_resources ? t('literature.result.already_added') : t('literature.result.add')}</button></div></article>}</details>
                        </section>
                        {error && <div className="literature-alert" role="alert"><CircleAlert size={16} /> {error}</div>}
                        {searchResult?.errors?.length > 0 && <details className="literature-source-errors"><summary>{t('literature.search.partial_errors', { count: searchResult.errors.length })}</summary>{searchResult.errors.map((item, index) => <p key={`${item.source_id}-${index}`}><strong>{item.source_id}</strong> {item.message}</p>)}</details>}
                        {searchResult && Object.keys(searchResult.exact_queries || {}).length > 0 && <details className="literature-query-audit"><summary>{t('literature.search.audit_title')}</summary><div className="literature-query-audit__counts"><span>{t('literature.search.audit_raw', { count: searchResult.counts?.raw_occurrences || 0 })}</span><span>{t('literature.search.audit_unique', { count: searchResult.counts?.unique_works || 0 })}</span><span>{t('literature.search.audit_duplicates', { count: searchResult.counts?.duplicates_removed || 0 })}</span><span>{t('literature.search.audit_possible', { count: searchResult.counts?.possible_duplicate_pairs || 0 })}</span><span>{t('literature.search.audit_ai', { count: searchResult.ai_audits?.length || 0 })}</span></div>{Object.entries(searchResult.exact_queries || {}).map(([sourceId, audit]) => <article key={sourceId}><header><strong>{audit.source_name || sourceId}</strong><small>v{audit.connector_version || 1}</small></header><code>{typeof audit.provider_syntax === 'string' ? audit.provider_syntax : JSON.stringify(audit.provider_syntax)}</code><details><summary>{t('literature.search.audit_requests', { count: audit.requests?.length || 0 })}</summary><pre>{JSON.stringify(audit.requests || [], null, 2)}</pre></details></article>)}{searchResult.ai_audits?.length > 0 && <article><header><strong>{t('literature.search.audit_ai_operations')}</strong></header><pre>{JSON.stringify(searchResult.ai_audits, null, 2)}</pre></article>}</details>}
                        {selectedWorks.length > 0 && <div className="literature-bulk-bar"><strong>{t('literature.bulk.selected', { count: selectedWorks.length })}</strong><button type="button" className="btn-gnosi-secondary" disabled={busy === 'import'} onClick={() => void importWorks(selectedWorks)}><FilePlus2 size={14} /> {t('literature.bulk.add_resources')}</button><button type="button" className="btn-gnosi btn-gnosi-primary" disabled={busy === 'notebook'} onClick={() => void importWorks(selectedWorks, true)}><NotebookTabs size={14} /> {t('literature.bulk.send_notebook')}</button><button type="button" className="btn-gnosi-secondary" onClick={() => setTab('reviews')}><BookOpenCheck size={14} /> {t('literature.bulk.add_review')}</button></div>}
                        <section className="literature-results" aria-live="polite">{!searchResult ? <div className="literature-empty"><LibraryBig size={38} /><h2>{t('literature.empty.title')}</h2><p>{t('literature.empty.help')}</p></div> : results.length === 0 && searchResult.state === 'completed' ? <div className="literature-empty"><Search size={34} /><h2>{t('literature.empty.no_results')}</h2><p>{t('literature.empty.no_results_help')}</p></div> : results.map((work) => <ResultCard key={work.id} work={work} selected={selectedIds.has(work.id)} onSelect={(checked) => toggleWork(work, checked)} onPreview={() => setPreview(work)} onImport={() => void importWorks([work])} t={t} />)}</section>
                        {searchResult && searchResult.result_count > SEARCH_PAGE_SIZE && <nav className="literature-pagination" aria-label={t('literature.search.pagination')}><button type="button" className="btn-gnosi-secondary" disabled={resultOffset === 0} onClick={() => void changePage(resultOffset - SEARCH_PAGE_SIZE)}><ArrowLeft size={14} /> {t('common.previous')}</button><span>{t('literature.search.page_range', { from: resultOffset + 1, to: Math.min(resultOffset + SEARCH_PAGE_SIZE, searchResult.result_count), total: searchResult.result_count })}</span><button type="button" className="btn-gnosi-secondary" disabled={resultOffset + SEARCH_PAGE_SIZE >= searchResult.result_count} onClick={() => void changePage(resultOffset + SEARCH_PAGE_SIZE)}>{t('common.next')} <ChevronRight size={14} /></button></nav>}
                        <WorkPreview work={preview} onClose={() => setPreview(null)} onImport={(work) => void importWorks([work])} t={t} />
                    </>}
                </div>
            </div>
        </main>
    );
}
