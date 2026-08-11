import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { FileText, Calendar, Clock, Link as LinkIcon, CheckSquare, Loader2, ExternalLink, ChevronDown, ChevronUp, PanelRight, X, ArrowLeft, ArrowRight } from 'lucide-react';
import { getFieldConfig, getFieldType, getSchemaFieldNames, resolveViewSorts, resolveViewFilters } from './schemaUtils';
import { normalizeOptions, optionChipStyle, autoColorFor } from './optionCatalogUtils';
import { FileFieldValue } from './FileFieldValue';
import { getImageSrc, toAssetPreviewUrl } from '../../lib/fileResource';
import { parsePeriod } from './VaultDateProperty';
import { formatDate, formatNumber, resolveFieldFormat } from './formatUtils';
import { asBool } from '../../utils/vaultFilters';
import { normalizeAssetUrl } from './vaultMarkdownUtils';
import { IconRenderer } from './IconRenderer';
import { VaultMarkdown } from './VaultMarkdown';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useTitlePreview } from './useTitlePreview';
import { toast } from '../../lib/toast';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { RelationItem } from './RelationItem';
import { isMainView } from './viewConstants';
import {
    normalizeRelationValues,
    unlinkRelationFromRecord,
} from './relationItemUtils';

// How many records are rendered per batch; infinite scroll adds more as
// that the sentinel enters the view. Keeping it low saves initial DOM.
const FEED_BATCH = 12;
const PILL_PREVIEW_LIMIT = 5;
const MOBILE_PILL_PREVIEW_LIMIT = 3;

// The `metadata.description` (body excerpt) is capped at this limit by the
// backend: if it gets close to it, the real body continues and it makes sense to offer "See more".
const EXCERPT_CAP = 480;

// Prepares the body (excerpt or full content) for VaultMarkdown: outside the
// `<file …>` embeds (not renderable here) and HTML `<br>` → real line break
// (react-markdown ignores raw HTML and it would be lost). The rest of the Markdown
// (bold, lists, Assets images, wikilinks) it renders with formatting.
// The `(?:>|$)` covers the TRUNCATED tag: the excerpt is cut off at 500 characters and a
// `<file src="…` without a closing `>` used to render as plain text in the card.
function prepareBodyMd(raw) {
    if (!raw) return '';
    let s = String(raw);
    s = s.replace(/<file\b[^>]*(?:>|$)/gi, '');
    s = s.replace(/<\/file>/gi, '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    return s.trim();
}

function highlightSearchMatch(value, searchTerm) {
    const text = String(value || '');
    const terms = String(searchTerm || '').trim().split(/\s+/).filter((term) => term.length > 1);
    if (!terms.length) return text;
    const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
    return text.split(pattern).map((part, index) => terms.some((term) => part.toLocaleLowerCase() === term.toLocaleLowerCase())
        ? <mark key={index} className="vault-feed-search-match">{part}</mark>
        : part);
}

/**
 * Feed card (Notion style): icon+title inline, ALL properties
 * inline as pills, generous formatted preview of the content, and
 * "See more" expands the measured excerpt, while the full record remains a
 * dedicated page. The card doesn't navigate on click (you can select text and
 * interact with the body); opening the page is done with the "Open" button or
 * by clicking the title.
 */
function FeedCard({ note, pills, isSelected, selectionActive, onToggleSelect, onOpen, onPreview, titlePreviewProps, searchTerm, isRead, density, pillLimit = PILL_PREVIEW_LIMIT, excerptLines = 6 }) {
    const { t, i18n } = useTranslation();
    const isCompact = useMediaQuery('(max-width: 768px)');
    const [expanded, setExpanded] = useState(false);
    const [showAllPills, setShowAllPills] = useState(false);
    const [previewOverflows, setPreviewOverflows] = useState(false);
    const previewRef = useRef(null);
    // The cover is resolved the same way as in the other views (VaultGallery): `Assets/x`
    // → `/api/vault/assets/x` with the active vault in the query. A `background-image`
    // (like a native `<img>`) does NOT send the X-Vault-Id header, so without
    // normalize, a relative cover was returning a 404 and in multivault it pointed to the
    // vault equivocat (fix #775).
    const coverUrl = typeof note.metadata?.cover === 'string'
        ? normalizeAssetUrl(note.metadata.cover)
        : '';
    const hasCover = !!coverUrl;

    const previewMd = useMemo(() => prepareBodyMd(note.metadata?.description || ''), [note]);
    const pillPreviewLimit = Math.min(pillLimit, isCompact ? MOBILE_PILL_PREVIEW_LIMIT : PILL_PREVIEW_LIMIT);
    const visiblePills = showAllPills ? pills : pills.slice(0, pillPreviewLimit);
    const hiddenPillCount = Math.max(0, pills.length - visiblePills.length);
    // The excerpt is approaching the limit → the actual body continues further.
    const looksTruncated = (note.metadata?.description || '').length >= EXCERPT_CAP;

    useEffect(() => {
        if (expanded || !previewMd || !previewRef.current) return undefined;

        const preview = previewRef.current;
        const measure = () => {
            setPreviewOverflows(preview.scrollHeight > preview.clientHeight + 1);
        };
        const frame = window.requestAnimationFrame(measure);
        const observer = typeof ResizeObserver === 'function'
            ? new ResizeObserver(measure)
            : null;
        observer?.observe(preview);

        return () => {
            window.cancelAnimationFrame(frame);
            observer?.disconnect();
        };
    }, [expanded, previewMd]);
    const handleToggleExpand = useCallback((e) => {
        e.stopPropagation();
        if (expanded) { setExpanded(false); return; }
        setExpanded(true);
    }, [expanded]);

    const openNote = useCallback((e) => { e?.stopPropagation?.(); onOpen(note.id); }, [onOpen, note.id]);
    const previewNote = useCallback((e) => { e?.stopPropagation?.(); onPreview(note.id); }, [onPreview, note.id]);
    const openLabel = `${t('feed.open_page', "Open page")}: ${note.title || t('common.untitled', "Untitled")}`;

    return (
        <article
            data-feed-note-id={note.id}
            className={`vault-feed-card ${density === 'compact' ? 'vault-feed-card--compact' : ''} ${density === 'adaptive' ? 'vault-feed-card--adaptive' : ''} ${isRead ? 'is-read' : ''} relative bg-[var(--bg-primary)] rounded-2xl shadow-sm border overflow-hidden hover:shadow-md transition-all group flex flex-col ${isSelected ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/40'}`}
        >
            {/* The label only stops propagation (not opening the card): the
                toggle is handled by the input's onChange. If the label also called
                onToggleSelect, a direct click on the checkbox would fire both
                handlers (bubbling) and the double toggle would leave the selection
                as it was. */}
            <label
                className={`absolute top-3 left-3 z-20 cursor-pointer ${isSelected || selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                onClick={(e) => e.stopPropagation()}
            >
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => onToggleSelect(note.id, e)}
                    aria-label={t('feed.select_record', {
                        title: note.title || t('common.untitled', 'Untitled'),
                    })}
                    className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer bg-[var(--bg-secondary)]/90 shadow-sm"
                />
            </label>

            {/* Cover: only if the record has one. */}
            {hasCover && (
                <div className="w-full h-48 sm:h-64 relative bg-[var(--bg-tertiary)] flex-shrink-0">
                    <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url("${coverUrl}")` }}
                    />
                </div>
            )}

            <div className="vault-feed-card__body p-6 flex flex-col gap-3">
                {/* Header: small date + icon and title. The title is the sole
                    primary navigation target; the card remains a semantic
                    article so its checkbox and disclosure buttons are never
                    nested inside a link. */}
                <div className="vault-feed-card__header flex items-start justify-between gap-3">
                    <div className="vault-feed-card__identity min-w-0">
                        <div className="vault-feed-card__date flex items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)] mb-1.5">
                            <Clock size={12} />
                            <span>
                                {t('feed.updated_at', {
                                    defaultValue: "Updated {{date}}",
                                    date: new Date(note.last_modified).toLocaleDateString(i18n.language, {
                                        day: 'numeric', month: 'short',
                                        hour: '2-digit', minute: '2-digit'
                                    }),
                                })}
                            </span>
                            <span className="sr-only">
                                {new Date(note.last_modified).toLocaleDateString(i18n.language, {
                                        day: 'numeric', month: 'long', year: 'numeric',
                                        hour: '2-digit', minute: '2-digit'
                                })}
                            </span>
                        </div>
                        <h2 className="min-w-0">
                            <button
                                type="button"
                                onClick={selectionActive ? undefined : openNote}
                                disabled={selectionActive}
                                aria-label={openLabel}
                                {...titlePreviewProps}
                                className={`vault-feed-card__title text-xl font-bold text-[var(--text-primary)] leading-tight flex items-center gap-2 min-w-0 text-left ${selectionActive ? 'cursor-default' : 'cursor-pointer hover:text-[var(--gnosi-primary)]'} transition-colors`}
                                title={note.title || ''}
                            >
                                {note.metadata?.icon && (
                                    <span className="shrink-0 inline-flex"><IconRenderer icon={note.metadata.icon} size={24} /></span>
                                )}
                                <span className="min-w-0">{highlightSearchMatch(note.title || t('common.untitled', "Untitled"), searchTerm)}</span>
                            </button>
                        </h2>
                    </div>
                    {!selectionActive && <button type="button" onClick={previewNote} className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-tertiary)]" title={t('feed.open_reading_pane', 'Open reading pane')} aria-label={t('feed.open_reading_pane', 'Open reading pane')}><PanelRight size={16} /></button>}
                </div>

                {/* ALL properties inline (Notion style): value only. */}
                {pills.length > 0 && (
                    <div className="vault-feed-card__pills flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        {visiblePills.map(({ key, node }) => (
                            <React.Fragment key={key}>{node}</React.Fragment>
                        ))}
                        {hiddenPillCount > 0 && (
                            <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); setShowAllPills(true); }}
                                className="inline-flex min-h-6 items-center rounded-full border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-2 text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)]"
                                title={t('feed.show_more_tags', { count: hiddenPillCount })}
                                aria-label={t('feed.show_more_tags', { count: hiddenPillCount })}
                            >
                                +{hiddenPillCount}
                            </button>
                        )}
                        {showAllPills && pills.length > pillPreviewLimit && (
                            <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); setShowAllPills(false); }}
                                className="inline-flex size-6 items-center justify-center rounded-full border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
                                title={t('feed.show_fewer_tags', "Show fewer tags")}
                                aria-label={t('feed.show_fewer_tags', "Show fewer tags")}
                            >
                                <ChevronUp size={12} />
                            </button>
                        )}
                    </div>
                )}

                {/* Body: formatted excerpt. Expansion reveals the saved excerpt only;
                    the full document stays in its own page to preserve feed density. */}
                {previewMd && (
                    <div
                        ref={previewRef}
                        style={expanded ? undefined : { '--feed-excerpt-lines': excerptLines }}
                        className={`vault-feed-card__preview text-sm text-[var(--text-secondary)] leading-relaxed ${expanded ? 'is-expanded' : ''}`}
                    >
                        <VaultMarkdown
                            md={previewMd}
                            onActivate={() => onOpen(note.id)}
                            imageTitle={note.title || ''}
                        />
                    </div>
                )}

                {/* "Show more / Show less" centered (like Notion's "See more").
                    Only if the excerpt is truncated (the actual body continues). */}
                {(looksTruncated || previewOverflows || expanded) && (
                    <div className="flex justify-center">
                        <button
                            type="button"
                            onClick={handleToggleExpand}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] shadow-sm transition-colors"
                        >
                            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            {expanded ? t('feed.see_less', "See less") : t('feed.see_more', "See more")}
                        </button>
                        {expanded && (
                            <button
                                type="button"
                                onClick={openNote}
                                className="ml-2 inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] shadow-sm transition-colors"
                            >
                                <ExternalLink size={13} />
                                {t('feed.read_full', 'Read in full')}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </article>
    );
}

/**
 * Card list with infinite scroll. `visibleCount` records are rendered and
 * a sentinel at the end adds one more batch when it enters the viewport. A
 * dedicated component so the parent can remount it (via `key`) and reset the
 * count when the set changes, without `setState` inside an effect or mutating refs during render.
 */
function FeedList({ notes, buildPills, isSelected, selectionActive, onToggleSelect, onOpen, onPreview, getTitleProps, searchTerm, readIds, density, groupMode, pillLimit, excerptLines }) {
    const { t, i18n } = useTranslation();
    const sentinelRef = useRef(null);
    const [visibleCount, setVisibleCount] = useState(FEED_BATCH);
    const hasMore = visibleCount < notes.length;

    useEffect(() => {
        if (!hasMore) return undefined;
        const sentinel = sentinelRef.current;
        if (!sentinel) return undefined;
        // setState goes inside the observer's callback (asynchronous), not in the body of
        // the effect: it's the "subscribe and update in the callback" pattern.
        //
        // `root: null` (viewport) A POSTA: el sentinella es fa visible a pantalla
        // equally whether the scrolling is handled by the page (embedded feed, which grows)
        // like the full-view pane. Anchor the root to the ancestor
        // scrollable was fragile: the page scroller has clientHeight 0 (layout
        // flex) and as root it never intersected → the feed stayed stuck on the 1st batch.
        const io = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting)) {
                setVisibleCount(c => Math.min(c + FEED_BATCH, notes.length));
            }
        }, { root: null, rootMargin: '600px 0px' });
        io.observe(sentinel);
        return () => io.disconnect();
    }, [hasMore, notes.length]);

    const visibleNotes = useMemo(() => notes.slice(0, visibleCount), [notes, visibleCount]);
    const dateGroup = useCallback((value) => {
        const date = new Date(value);
        const now = new Date();
        const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startWeek = new Date(startToday);
        startWeek.setDate(startToday.getDate() - ((startToday.getDay() + 6) % 7));
        const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        if (date >= startToday) return t('feed.group_today');
        if (date >= startWeek) return t('feed.group_this_week');
        if (date >= startMonth) return t('feed.group_this_month');
        return date.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
    }, [i18n.language, t]);

    return (
        <div className="w-full max-w-3xl flex flex-col gap-8 pb-16 relative">
            {visibleNotes.map((note, index) => {
                const group = groupMode === 'date' ? dateGroup(note.last_modified) : '';
                const previousGroup = index > 0 && groupMode === 'date'
                    ? dateGroup(visibleNotes[index - 1].last_modified)
                    : '';
                return (
                    <React.Fragment key={note.id}>
                        {group && group !== previousGroup && <h3 className="vault-feed-date-group">{group}</h3>}
                        <FeedCard
                            note={note}
                            pills={buildPills(note)}
                            isSelected={isSelected(note.id)}
                            selectionActive={selectionActive}
                            onToggleSelect={onToggleSelect}
                            onOpen={onOpen}
                            onPreview={onPreview}
                            titlePreviewProps={getTitleProps(note.id)}
                            searchTerm={searchTerm}
                            isRead={readIds.has(note.id)}
                            density={density}
                            pillLimit={pillLimit}
                            excerptLines={excerptLines}
                        />
                    </React.Fragment>
                );
            })}

            {/* Infinite-scroll sentinel + loading indicator */}
            {hasMore && (
                <div ref={sentinelRef} className="flex items-center justify-center py-4 text-[var(--text-tertiary)]">
                    <Loader2 size={18} className="animate-spin" />
                </div>
            )}
        </div>
    );
}

export function VaultFeed({ notes, onNoteSelect, schema = {}, idToTitle = {}, allNotes = [], activeView = {}, onDeleteSelected, onDeletePage, onApplyTemplate, templates = [], onUpdateNote, onCreateRecord, onOpenConfig, onClearSearch, onSearchChange, searchTerm = '', density = 'comfortable', groupMode = 'none', isEmbedded = false }) {
    const { t, i18n } = useTranslation();
    const localeSettings = useLocaleSettings();
    const pillLimit = Number(activeView?.pillLimit ?? activeView?.pill_limit) || 5;
    const excerptLines = Number(activeView?.excerptLines ?? activeView?.excerpt_lines) || 6;
    const feedFocus = Boolean(activeView?.feedFocus ?? activeView?.feed_focus);
    const [previewId, setPreviewId] = useState('');
    const [paneWidth, setPaneWidth] = useState(() => {
        try { return Number(localStorage.getItem('gnosi.feed.readingPaneWidth')) || 480; } catch { return 480; }
    });
    const [cleanReading, setCleanReading] = useState(false);
    const [dockReadingPane, setDockReadingPane] = useState(() => {
        try { return localStorage.getItem('gnosi.feed.dockReadingPane') === 'true'; } catch { return false; }
    });
    const configuredSummaryModel = activeView?.summaryModel || activeView?.summary_model || '';
    const [fallbackSummaryModel, setFallbackSummaryModel] = useState('');
    const summaryModel = configuredSummaryModel || fallbackSummaryModel;
    const [summaryText, setSummaryText] = useState('');
    const [summaryState, setSummaryState] = useState('idle');
    const [summaryForId, setSummaryForId] = useState('');
    const readStorageKey = `gnosi.feed.read.${activeView?.id || 'default'}`;
    const [readIds, setReadIds] = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem(readStorageKey) || '[]')); } catch { return new Set(); }
    });
    const [bulkProposal, setBulkProposal] = useState(null);
    const [isCommandOpen, setIsCommandOpen] = useState(false);
    const [bulkSaveState, setBulkSaveState] = useState('idle');
    const [pendingBulkUndo, setPendingBulkUndo] = useState(null);
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });
    useEffect(() => {
        const onKeyDown = (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setIsCommandOpen(true); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
    const markRead = useCallback((id) => {
        setReadIds((current) => {
            if (current.has(id)) return current;
            const next = new Set(current).add(id);
            try { localStorage.setItem(readStorageKey, JSON.stringify([...next].slice(-500))); } catch { /* noop */ }
            return next;
        });
    }, [readStorageKey]);
    useEffect(() => {
        if (configuredSummaryModel) return undefined;
        let cancelled = false;
        const loadSummaryModel = async () => {
            try {
                const settingsResponse = await axios.get('/api/vault/plugins/vault-summary/settings');
                if (cancelled) return;
                const configured = settingsResponse.data?.settings?.model || '';
                setFallbackSummaryModel(configured);
            } catch {
                if (!cancelled) setFallbackSummaryModel('');
            }
        };
        loadSummaryModel();
        return () => { cancelled = true; };
    }, [configuredSummaryModel]);

    // Feed cards follow the same visible-field contract as gallery and board
    // cards. This also prevents system dates that are not selected in the view
    // from being repeated below the timestamp in the card header.
    const configuredProperties = activeView?.visibleProperties
        || activeView?.visible_properties
        || activeView?.columns;
    const visibleProperties = Array.isArray(configuredProperties) && configuredProperties.length
        ? configuredProperties
        : (isMainView(activeView)
            ? getSchemaFieldNames(schema)
            : getSchemaFieldNames(schema).slice(0, 3));
    const dynamicColumns = visibleProperties
        .map(prop => (typeof prop === 'string' ? prop : prop?.fieldKey))
        .filter(Boolean)
        .map(prop => [prop, getFieldType(schema, prop)])
        .filter(([key, type]) => type && type !== 'title' && String(key).toLowerCase() !== 'title');

    const getRelationDisplayMap = useCallback((field) => {
        const config = getFieldConfig(schema, field);
        const relatedTableId = config?.relation_database_id;
        const relatedNotes = relatedTableId
            ? (allNotes || []).filter(n => {
                const nTableId = n.resolved_table_id || n.metadata?.table_id || n.metadata?.database_table_id;
                return nTableId === relatedTableId;
            })
            : [];
        return {
            ...idToTitle,
            ...Object.fromEntries(relatedNotes.map(n => [n.id, n.title || idToTitle[n.id] || n.id])),
        };
    }, [schema, allNotes, idToTitle]);

    const renderPropertyValue = useCallback((value, type, field, note, metadataKey) => {
        if (value === undefined || value === null || value === '') return null;

        switch (type) {
            case 'checkbox':
                return <CheckSquare size={14} className={asBool(value) ? "text-indigo-500" : "text-[var(--text-tertiary)]"} />;
            case 'date':
            case 'datetime': {
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return (
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-sm">
                        <Calendar size={14} className="text-[var(--text-tertiary)]" />
                        <span className="text-[var(--text-secondary)]">{formatDate(value, { dateFormat: fmt.dateFormat, type, locale: fmt.dateLocale })}</span>
                    </div>
                );
            }
            case 'period': {
                // "start/end" range in a single value: each half with the format
                // localized (before it fell back to the default and showed the raw ISO).
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                const { start, end } = parsePeriod(value);
                const fmtOne = (v) => formatDate(v, {
                    dateFormat: fmt.dateFormat,
                    type: String(v || '').includes('T') ? 'datetime' : 'date',
                    locale: fmt.dateLocale,
                });
                return (
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-sm">
                        <Calendar size={14} className="text-[var(--text-tertiary)]" />
                        <span className="text-[var(--text-secondary)]">{end ? `${fmtOne(start)} → ${fmtOne(end)}` : fmtOne(start)}</span>
                    </div>
                );
            }
            case 'number': {
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return <span className="tabular-nums text-[var(--text-secondary)] text-sm">{formatNumber(value, { kind: fmt.kind, decimals: fmt.decimals, currencyCode: fmt.currencyCode, locale: fmt.numberLocale })}</span>;
            }
            case 'status':
            case 'select': {
                // Color from the rich option catalog ({name,color}); if the option isn't
                // there, a stable automatic color based on the name (same algorithm as
                // the backend) — never the neutral chip.
                const opts = normalizeOptions(getFieldConfig(schema, field)?.options);
                const opt = opts.find(o => o.name === String(value).trim());
                const style = optionChipStyle(opt?.color || autoColorFor(value));
                return (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold border" style={style}>
                        {value}
                    </span>
                );
            }
            case 'multi_select': {
                const items = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
                const opts = normalizeOptions(getFieldConfig(schema, field)?.options);
                return (
                    <span className="inline-flex flex-wrap gap-1.5">
                        {items.map((it, idx) => {
                            const opt = opts.find(o => o.name === String(it).trim());
                            const style = optionChipStyle(opt?.color || autoColorFor(it));
                            return (
                                <span key={idx} className="px-2 py-0.5 rounded text-xs font-medium border" style={style}>
                                    {it}
                                </span>
                            );
                        })}
                    </span>
                );
            }
            case 'relation': {
                const items = normalizeRelationValues(value);
                const displayMap = getRelationDisplayMap(field);
                return (
                    <span className="inline-flex flex-wrap gap-1.5">
                        {items.map(relationId => (
                            <RelationItem
                                key={relationId}
                                relationId={relationId}
                                title={displayMap[relationId] || relationId}
                                onOpen={onNoteSelect}
                                onRemove={onUpdateNote ? () => unlinkRelationFromRecord({
                                    pageId: note.id,
                                    field,
                                    metadataKey,
                                    value,
                                    relationId,
                                    relationTitle: displayMap[relationId] || relationId,
                                    onUpdate: onUpdateNote,
                                }) : undefined}
                            />
                        ))}
                    </span>
                );
            }
            case 'url':
                return (
                    <a href={value} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-indigo-500 hover:text-indigo-600 hover:underline flex items-center gap-1 text-sm truncate max-w-sm">
                        <LinkIcon size={14} /> URL
                    </a>
                );
            case 'files':
                return <FileFieldValue value={value} field={field} variant="feed" />;
            case 'zotero':
                return (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            fetch('/api/vault/open-resource', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    zotero_uri: String(value).trim().startsWith('zotero://') ? String(value).trim() : null,
                                    file_path: String(value).trim().startsWith('zotero://') ? null : String(value).trim(),
                                }),
                            });
                        }}
                        className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-500 hover:bg-emerald-500/20"
                        title={String(value)}
                    >
                        <LinkIcon size={14} /> {t('table.open_zotero', "Open Zotero")}
                    </button>
                );
            case 'image': {
                // Thumbnail for string values (path) or composite ones {src, alt, …}.
                const src = getImageSrc(value);
                const previewUrl = toAssetPreviewUrl(src);
                if (previewUrl) return <img src={previewUrl} alt={(value && value.alt) || field} className="h-10 w-10 rounded object-cover" />;
                return src ? <span className="text-sm text-[var(--text-secondary)] truncate max-w-xs inline-block" title={src}>{src}</span> : null;
            }
            default:
                // Safety net: an OBJECT (e.g. composite image field
                // {src, alt} in a field not typed as image) as a React child
                // throws "Objects are not valid as a React child" and used to crash the WHOLE
                // feed at the boundary. We try the image path first, and text otherwise.
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    const src = getImageSrc(value);
                    const previewUrl = toAssetPreviewUrl(src);
                    if (previewUrl) return <img src={previewUrl} alt={value.alt || field} className="h-10 w-10 rounded object-cover" />;
                    return src ? <span className="text-sm text-[var(--text-secondary)] truncate max-w-xs inline-block" title={src}>{src}</span> : null;
                }
                return <span className="text-sm text-[var(--text-primary)]">{Array.isArray(value) ? value.map(v => String(v)).join(', ') : String(value)}</span>;
        }
    }, [schema, localeSettings, getRelationDisplayMap, t, onNoteSelect, onUpdateNote]);

    // Property pills for a note (values without labels, schema order).
    const buildPills = useCallback((note) => {
        // Normalized keys (no spaces) so they match `schemaKeyNorm`.
        const aliasMap = { dateadded: "created_time", datemodified: "last_edited_time" };
        const normalizeKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/gi, '');
        return dynamicColumns.map(([key, type]) => {
            const schemaKeyNorm = normalizeKey(key);
            const targetKeyNorm = aliasMap[schemaKeyNorm] ? normalizeKey(aliasMap[schemaKeyNorm]) : schemaKeyNorm;
            const originalMetaKey = note.metadata ? (Object.keys(note.metadata).find(k => normalizeKey(k) === targetKeyNorm) || key) : key;
            const node = renderPropertyValue(note.metadata?.[originalMetaKey], type, key, note, originalMetaKey);
            return node ? { key, node } : null;
        }).filter(Boolean);
    }, [dynamicColumns, renderPropertyValue]);

    // View filters, sorting, and search (same engine as table/gallery).
    // The order is resolved with `resolveViewSorts` (the `sorts` key — the one that persist
    // the Notion import and the modal — with fallback to the legacy `sort`).
    // Memoized: `resolveViewSorts`/`resolveViewFilters` return NEW arrays and
    // without useMemo, the sort/filtering was recalculated on every render.
    const viewConfig = useMemo(() => ({
        filters: resolveViewFilters(activeView),
        sorts: resolveViewSorts(activeView, { field: 'last_modified', direction: 'desc' }),
        search: searchTerm,
    }), [activeView, searchTerm]);
    const { sortedPages: sortedNotes } = useVaultViewData({ pages: notes, schema, view: viewConfig, searchTerm });

    const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(sortedNotes);
    const lastRecordStorageKey = `gnosi.feed.lastRecord.${activeView?.id || 'default'}`;
    const [lastRecordId, setLastRecordId] = useState(() => {
        try { return localStorage.getItem(lastRecordStorageKey) || ''; } catch { return ''; }
    });
    const openFeedRecord = useCallback((id) => {
        markRead(id);
        setLastRecordId(id);
        try { localStorage.setItem(lastRecordStorageKey, id); } catch { /* noop */ }
        onNoteSelect?.(id);
    }, [lastRecordStorageKey, markRead, onNoteSelect]);
    const previewIndex = sortedNotes.findIndex((note) => note.id === previewId);
    const previewNote = previewIndex >= 0 ? sortedNotes[previewIndex] : null;
    const summarizePreview = async () => {
        if (!previewNote || !summaryModel) return;
        setSummaryState('loading');
        setSummaryText('');
        setSummaryForId(previewNote.id);
        try {
            await axios.put('/api/vault/plugins/vault-summary/settings', { settings: { model: summaryModel } });
            const response = await axios.post('/api/vault/plugins/vault-summary/summarize', {
                content: `${previewNote.title || ''}\n\n${prepareBodyMd(previewNote.metadata?.description || '')}`,
                language: i18n.resolvedLanguage || i18n.language || 'en',
            });
            setSummaryText(response.data?.summary || '');
            setSummaryState('success');
        } catch (error) {
            setSummaryState('error');
            toast.error(error?.response?.data?.detail || t('feed.summary_error', 'Could not create the summary'));
        }
    };
    const movePreview = useCallback((offset) => {
        const next = sortedNotes[previewIndex + offset];
        if (next) setPreviewId(next.id);
    }, [previewIndex, setPreviewId, sortedNotes]);
    useEffect(() => {
        if (!previewNote) return undefined;
        const onKeyDown = (event) => {
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
            if (event.key === 'ArrowLeft') { event.preventDefault(); movePreview(-1); }
            if (event.key === 'ArrowRight') { event.preventDefault(); movePreview(1); }
            if (event.key === 'Escape') setPreviewId('');
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [movePreview, previewNote]);
    const returnToLastRecord = useCallback(() => {
        [...document.querySelectorAll('[data-feed-note-id]')]
            .find((element) => element.dataset.feedNoteId === lastRecordId)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [lastRecordId]);

    // Key for the visible set: when it changes (search, view change, filters, or
    // order) `FeedList` remounts and its infinite-scroll count is
    // resets on its own. The signature is STABLE with respect to the count (fix #788):
    // it's based on the logical config (filters + sort), NOT on `sortedNotes.length`
    // —including it remounted the feed and jumped it back to the start when deleting notes
    // from the feed or receiving new ones via sync/poll. The `slice` in FeedList already
    // handles the list shrinking below `visibleCount` without remounting.
    const resetKey = `${searchTerm}|${activeView?.id ?? ''}|${JSON.stringify(viewConfig.filters)}|${JSON.stringify(viewConfig.sorts)}`;

    const handleBulkDelete = useCallback(() => {
        if (selectedIds.size === 0) return;
        if (onDeleteSelected) {
            onDeleteSelected(new Set(selectedIds));
            clearSelection();
        } else if (onDeletePage) {
            const safeNotes = notes || [];
            selectedIds.forEach(id => {
                const note = safeNotes.find(n => n.id === id);
                if (note) onDeletePage(id, note.title);
            });
            clearSelection();
        }
    }, [selectedIds, onDeleteSelected, onDeletePage, notes, clearSelection]);
    const bulkSelectFields = dynamicColumns.filter(([, type]) => type === 'status' || type === 'select' || type === 'multi_select');
    const applyBulkField = useCallback(async (field, value, append = false) => {
        if (!field || !value || !onUpdateNote) return;
        const type = getFieldType(schema, field);
        const changes = [...selectedIds].map((id) => {
            const note = notes.find((item) => item.id === id);
            const current = note?.metadata?.[field];
            const nextValue = append || type === 'multi_select'
                ? [...new Set([...(Array.isArray(current) ? current : current ? [current] : []), value])]
                : value;
            return { id, field, previous: current, next: nextValue };
        });
        setBulkProposal({ field, value, changes });
    }, [notes, onUpdateNote, schema, selectedIds, setBulkProposal]);
    const confirmBulkField = useCallback(async () => {
        const changes = bulkProposal?.changes || [];
        if (!changes.length || !onUpdateNote) return;
        setBulkSaveState('saving');
        try {
            await Promise.all(changes.map((change) => onUpdateNote(change.id, { metadata: { [change.field]: change.next } })));
            setPendingBulkUndo(changes);
            setBulkSaveState('saved');
            toast.success(t('feed.bulk_saved', 'Changes saved'));
        } catch {
            setBulkSaveState('error');
            toast.error(t('feed.bulk_save_error', 'Some changes could not be saved'));
        }
        clearSelection();
        setBulkProposal(null);
    }, [bulkProposal, clearSelection, onUpdateNote, setBulkProposal, setBulkSaveState, setPendingBulkUndo, t]);
    const undoBulkField = useCallback(async () => {
        if (!pendingBulkUndo || !onUpdateNote) return;
        setBulkSaveState('saving');
        try {
            await Promise.all(pendingBulkUndo.map((change) => onUpdateNote(change.id, { metadata: { [change.field]: change.previous } })));
            setPendingBulkUndo(null);
            setBulkSaveState('saved');
            toast.success(t('feed.bulk_undone', 'Changes undone'));
        } catch {
            setBulkSaveState('error');
            toast.error(t('feed.bulk_save_error', 'Some changes could not be saved'));
        }
    }, [onUpdateNote, pendingBulkUndo, setBulkSaveState, setPendingBulkUndo, t]);
    const startPaneResize = useCallback((event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = paneWidth;
        const onMove = (moveEvent) => setPaneWidth(Math.max(320, Math.min(760, startWidth + startX - moveEvent.clientX)));
        const onUp = () => {
            try { localStorage.setItem('gnosi.feed.readingPaneWidth', String(paneWidth)); } catch { /* noop */ }
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp, { once: true });
    }, [paneWidth, setPaneWidth]);

    useVaultSelectionShortcuts({
        selectedCount: selectedIds.size,
        onClearSelection: clearSelection,
        onDeleteSelection: handleBulkDelete,
    });

    if (sortedNotes.length === 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] p-10 bg-[var(--bg-primary)]">
                <FileText size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                <p className="font-medium">{searchTerm ? t('feed.empty_search', 'No records match this search.') : t('feed.empty', 'No posts in the feed.')}</p>
                <p className="mt-1 text-sm text-center">{searchTerm ? t('feed.empty_search_hint', 'Try fewer words or clear the search.') : t('feed.empty_hint', 'Create the first record or adjust the view filters.')}</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {searchTerm && <button type="button" onClick={onClearSearch} className="btn-gnosi btn-gnosi-secondary !text-xs">{t('feed.clear_search', 'Clear search')}</button>}
                    {onOpenConfig && <button type="button" onClick={onOpenConfig} className="btn-gnosi btn-gnosi-secondary !text-xs">{t('feed.adjust_view', 'Adjust view')}</button>}
                    {onCreateRecord && <button type="button" onClick={() => onCreateRecord()} className="btn-gnosi btn-gnosi-primary !text-xs">{t('feed.create_record', 'Create record')}</button>}
                </div>
            </div>
        );
    }

    return (
        <div className={`vault-feed w-full h-full ${isEmbedded ? 'pb-4' : 'pt-vault-header-top px-4 md:px-6 pb-4 md:pb-6'} overflow-y-auto custom-scrollbar bg-[var(--bg-primary)] flex flex-col items-center ${feedFocus ? 'is-focus' : ''} ${previewNote && dockReadingPane ? 'has-docked-pane' : ''}`} style={previewNote && dockReadingPane ? { paddingRight: `calc(${paneWidth}px + 1.5rem)` } : undefined}>
            {selectedIds.size > 0 && (
                <VaultBulkActionsBar
                        selectedIds={selectedIds}
                    totalCount={sortedNotes.length}
                    onSelectAll={() => selectAll(sortedNotes.map(n => n.id))}
                    onClearSelection={clearSelection}
                    onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                    templates={templates}
                    onApplyTemplate={onApplyTemplate ? (templateId) => { onApplyTemplate(new Set(selectedIds), templateId); clearSelection(); } : null}
                    extraActions={bulkSelectFields.length > 0 && <select className="min-h-8 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 text-xs text-[var(--text-secondary)]" defaultValue="" onChange={(event) => { const [field, value] = event.target.value.split('::'); if (field && value) applyBulkField(field, value, getFieldType(schema, field) === 'multi_select'); event.target.value = ''; }} aria-label={t('feed.apply_field_to_selection', 'Apply a field to the selection')}><option value="">{t('feed.batch_update', 'Update selected…')}</option>{bulkSelectFields.flatMap(([field]) => normalizeOptions(getFieldConfig(schema, field)?.options).map((option) => <option key={`${field}-${option.name}`} value={`${field}::${option.name}`}>{field}: {option.name}</option>))}</select>}
                    className="vault-feed-selection-bar sticky top-2 w-full max-w-3xl mb-4 shrink-0 bg-[var(--gnosi-primary)]/10 border border-[var(--gnosi-primary)]/20 rounded-lg px-4 py-2 flex items-center gap-3 text-sm z-30"
                />
            )}
            {(bulkSaveState !== 'idle' || pendingBulkUndo) && <div className={`vault-feed-sync-state vault-feed-sync-state--${bulkSaveState}`} role="status">
                <span>{bulkSaveState === 'saving' ? t('feed.sync_saving', 'Saving changes…') : bulkSaveState === 'error' ? t('feed.sync_error', 'Changes need attention') : t('feed.sync_saved', 'Changes saved')}</span>
                {pendingBulkUndo && <button type="button" onClick={undoBulkField}>{t('common.undo', 'Undo')}</button>}
            </div>}
            {bulkProposal && <div className="vault-feed-bulk-proposal" role="dialog" aria-label={t('feed.confirm_bulk_update', 'Confirm batch update')}>
                <strong>{t('feed.bulk_preview_title', 'Review batch update')}</strong>
                <span>{t('feed.bulk_preview_hint', { count: bulkProposal.changes.length, field: bulkProposal.field, value: bulkProposal.value, defaultValue: '{{count}} records: {{field}} → {{value}}' })}</span>
                <div><button type="button" onClick={() => setBulkProposal(null)}>{t('common.cancel', 'Cancel')}</button><button type="button" className="btn-gnosi btn-gnosi-primary !text-xs" onClick={confirmBulkField}>{t('feed.apply_changes', 'Apply changes')}</button></div>
            </div>}
            {isCommandOpen && <div className="vault-feed-command" role="dialog" aria-label={t('feed.command_title', 'Feed command')}><button type="button" className="vault-feed-command__close" onClick={() => setIsCommandOpen(false)} aria-label={t('common.close')}><X size={16} /></button><strong>{t('feed.command_title', 'Feed command')}</strong><input autoFocus value={searchTerm} onChange={(event) => onSearchChange?.(event.target.value)} placeholder={t('feed.command_search', 'Filter records…')} /><div><button type="button" onClick={() => { onCreateRecord?.(); setIsCommandOpen(false); }}>{t('feed.create_record', 'Create record')}</button><button type="button" onClick={() => { if (sortedNotes[0]) setPreviewId(sortedNotes[0].id); setIsCommandOpen(false); }}>{t('feed.command_open_first', 'Open first result')}</button></div></div>}
            {lastRecordId && sortedNotes.some((note) => note.id === lastRecordId) && (
                <button type="button" className="vault-feed-return" onClick={returnToLastRecord}>
                    {t('feed.return_to_last_record')}
                </button>
            )}
            <FeedList
                key={resetKey}
                notes={sortedNotes}
                buildPills={buildPills}
                isSelected={isSelected}
                selectionActive={selectedIds.size > 0}
                onToggleSelect={toggleSelect}
                onOpen={openFeedRecord}
                onPreview={setPreviewId}
                getTitleProps={titlePreview.getTitleProps}
                searchTerm={searchTerm}
                readIds={readIds}
                density={density}
                groupMode={groupMode}
                pillLimit={pillLimit}
                excerptLines={excerptLines}
            />
            {titlePreview.preview}
            {previewNote && <aside className={`vault-feed-reading-pane ${cleanReading ? 'is-clean' : ''} ${dockReadingPane ? 'is-docked' : ''}`} style={{ width: `min(${paneWidth}px, 92vw)` }} aria-label={t('feed.reading_pane', 'Reading pane')}>
                <div className="vault-feed-reading-pane__resize" onPointerDown={startPaneResize} role="separator" aria-orientation="vertical" aria-label={t('feed.resize_reading_pane', 'Resize reading pane')} />
                <div className="vault-feed-reading-pane__header"><span>{t('feed.reading_pane', 'Reading pane')}</span><button type="button" onClick={() => setDockReadingPane((current) => { const next = !current; try { localStorage.setItem('gnosi.feed.dockReadingPane', String(next)); } catch { /* noop */ } return next; })} aria-pressed={dockReadingPane}>{dockReadingPane ? t('feed.undock_pane', 'Float pane') : t('feed.dock_pane', 'Dock pane')}</button><button type="button" onClick={() => setCleanReading((current) => !current)} aria-pressed={cleanReading}>{cleanReading ? t('feed.show_details', 'Show details') : t('feed.clean_reading', 'Clean reading')}</button><button type="button" onClick={() => setPreviewId('')} aria-label={t('common.close')}><X size={18} /></button></div>
                <div className="vault-feed-reading-pane__content"><div className="flex items-start justify-between gap-3"><h2>{previewNote.title || t('common.untitled', 'Untitled')}</h2><button type="button" className="btn-gnosi btn-gnosi-secondary !text-xs" onClick={summarizePreview} disabled={!summaryModel || summaryState === 'loading'}>{summaryState === 'loading' ? t('feed.summarizing', 'Summarizing…') : t('feed.summarize', 'Summarize')}</button></div>{summaryText && summaryForId === previewNote.id && <section className="vault-feed-summary" aria-label={t('feed.summary', 'AI summary')}><strong>{t('feed.summary', 'AI summary')}</strong><VaultMarkdown md={summaryText} onActivate={() => openFeedRecord(previewNote.id)} imageTitle={previewNote.title || ''} /></section>}{summaryState === 'error' && summaryForId === previewNote.id && <p className="vault-feed-reading-pane__meta">{t('feed.summary_error_hint', 'Check that the selected model is active and available.')}</p>}{!cleanReading && <p className="vault-feed-reading-pane__meta">{t('feed.reading_shortcuts', 'Use ← → to navigate · Esc to close')}</p>}{previewNote.metadata?.description ? <VaultMarkdown md={prepareBodyMd(previewNote.metadata.description)} onActivate={() => openFeedRecord(previewNote.id)} imageTitle={previewNote.title || ''} /> : <p>{t('feed.no_excerpt', 'This record has no excerpt yet.')}</p>}</div>
                <div className="vault-feed-reading-pane__footer"><button type="button" onClick={() => movePreview(-1)} disabled={previewIndex <= 0} aria-label={t('feed.previous_record', 'Previous record')}><ArrowLeft size={16} /></button><span>{previewIndex + 1} / {sortedNotes.length}</span><button type="button" onClick={() => movePreview(1)} disabled={previewIndex >= sortedNotes.length - 1} aria-label={t('feed.next_record', 'Next record')}><ArrowRight size={16} /></button><button type="button" className="btn-gnosi btn-gnosi-primary !text-xs" onClick={() => openFeedRecord(previewNote.id)}>{t('feed.open_page', 'Open page')}</button></div>
            </aside>}
        </div>
    );
}
