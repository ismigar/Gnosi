import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Calendar, Clock, Link as LinkIcon, CheckSquare, Loader2, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
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
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';

// How many records are rendered per batch; infinite scroll adds more as
// that the sentinel enters the view. Keeping it low saves initial DOM.
const FEED_BATCH = 12;
const PILL_PREVIEW_LIMIT = 5;

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

/**
 * Feed card (Notion style): icon+title inline, ALL properties
 * inline as pills, generous formatted preview of the content, and
 * "See more" expands the measured excerpt, while the full record remains a
 * dedicated page. The card doesn't navigate on click (you can select text and
 * interact with the body); opening the page is done with the "Open" button or
 * by clicking the title.
 */
function FeedCard({ note, pills, isSelected, selectionActive, onToggleSelect, onOpen }) {
    const { t, i18n } = useTranslation();
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
    const visiblePills = showAllPills ? pills : pills.slice(0, PILL_PREVIEW_LIMIT);
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
    const openLabel = `${t('feed.open_page', "Open page")}: ${note.title || t('common.untitled', "Untitled")}`;

    const handleCardClick = useCallback((event) => {
        if (selectionActive) {
            onToggleSelect(note.id, event);
            return;
        }
        if (event.target instanceof Element && event.target.closest('a, button, input, select, textarea, [role="button"]')) {
            return;
        }
        if (window.getSelection?.()?.toString().trim()) return;
        openNote(event);
    }, [note.id, onToggleSelect, openNote, selectionActive]);

    const handleCardKeyDown = useCallback((event) => {
        if (selectionActive || event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openNote(event);
        }
    }, [openNote, selectionActive]);

    return (
        <div
            role={selectionActive ? undefined : 'link'}
            tabIndex={selectionActive ? undefined : 0}
            aria-label={selectionActive ? undefined : openLabel}
            onClick={handleCardClick}
            onKeyDown={handleCardKeyDown}
            className={`vault-feed-card relative bg-[var(--bg-primary)] rounded-2xl shadow-sm border overflow-hidden hover:shadow-md transition-all group flex flex-col cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gnosi-primary)] ${isSelected ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/40'}`}
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
                {/* Header: small date + (icon+title inline) + Open button */}
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
                        <h2
                            onClick={selectionActive ? undefined : openNote}
                            className={`vault-feed-card__title text-xl font-bold text-[var(--text-primary)] leading-tight flex items-center gap-2 min-w-0 ${selectionActive ? '' : 'cursor-pointer hover:text-[var(--gnosi-primary)]'} transition-colors`}
                            title={note.title || ''}
                        >
                            {note.metadata?.icon && (
                                <span className="shrink-0 inline-flex"><IconRenderer icon={note.metadata.icon} size={24} /></span>
                            )}
                            <span className="min-w-0">{note.title || t('common.untitled', "Untitled")}</span>
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={openNote}
                        className="vault-feed-card__open shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)] hover:border-[var(--gnosi-primary)]/50 transition-colors"
                        title={t('feed.open_page', "Open page")}
                    >
                        <ExternalLink size={13} />
                        {t('feed.open', "Open")}
                    </button>
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
                        {showAllPills && pills.length > PILL_PREVIEW_LIMIT && (
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
        </div>
    );
}

/**
 * Card list with infinite scroll. `visibleCount` records are rendered and
 * a sentinel at the end adds one more batch when it enters the viewport. A
 * dedicated component so the parent can remount it (via `key`) and reset the
 * count when the set changes, without `setState` inside an effect or mutating refs during render.
 */
function FeedList({ notes, buildPills, isSelected, selectionActive, onToggleSelect, onOpen }) {
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

    return (
        <div className="w-full max-w-3xl flex flex-col gap-8 pb-16">
            {visibleNotes.map(note => (
                <FeedCard
                    key={note.id}
                    note={note}
                    pills={buildPills(note)}
                    isSelected={isSelected(note.id)}
                    selectionActive={selectionActive}
                    onToggleSelect={onToggleSelect}
                    onOpen={onOpen}
                />
            ))}

            {/* Infinite-scroll sentinel + loading indicator */}
            {hasMore && (
                <div ref={sentinelRef} className="flex items-center justify-center py-4 text-[var(--text-tertiary)]">
                    <Loader2 size={18} className="animate-spin" />
                </div>
            )}
        </div>
    );
}

export function VaultFeed({ notes, onNoteSelect, schema = {}, idToTitle = {}, allNotes = [], activeView = {}, onDeleteSelected, onDeletePage, searchTerm = '' }) {
    const { t } = useTranslation();
    const localeSettings = useLocaleSettings();

    // The feed shows ALL properties of the record (like Notion's feed),
    // regardless of the view's `visibleProperties`: the card is the
    // entire record in post format. `title` is excluded (by type AND by
    // key): it's already the card's heading.
    const dynamicColumns = getSchemaFieldNames(schema)
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

    const renderPropertyValue = useCallback((value, type, field) => {
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
                const items = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
                const displayMap = getRelationDisplayMap(field);
                return (
                    <span className="inline-flex flex-wrap gap-1.5">
                        {items.map((it, idx) => (
                            <span key={idx} className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-500/10 text-indigo-400">
                                {displayMap[it] || (it.length > 20 ? it.substring(0, 8) + '…' : it)}
                            </span>
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
    }, [schema, localeSettings, getRelationDisplayMap, t]);

    // Property pills for a note (values without labels, schema order).
    const buildPills = useCallback((note) => {
        // Normalized keys (no spaces) so they match `schemaKeyNorm`.
        const aliasMap = { dateadded: "created_time", datemodified: "last_edited_time" };
        const normalizeKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/gi, '');
        return dynamicColumns.map(([key, type]) => {
            const schemaKeyNorm = normalizeKey(key);
            const targetKeyNorm = aliasMap[schemaKeyNorm] ? normalizeKey(aliasMap[schemaKeyNorm]) : schemaKeyNorm;
            const originalMetaKey = note.metadata ? (Object.keys(note.metadata).find(k => normalizeKey(k) === targetKeyNorm) || key) : key;
            const node = renderPropertyValue(note.metadata?.[originalMetaKey], type, key);
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

    useVaultSelectionShortcuts({
        selectedCount: selectedIds.size,
        onClearSelection: clearSelection,
        onDeleteSelection: handleBulkDelete,
    });

    if (sortedNotes.length === 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] p-10 bg-[var(--bg-primary)]">
                <FileText size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                <p>{t('feed.empty', "No posts in the feed.")}</p>
            </div>
        );
    }

    return (
        <div className="vault-feed w-full h-full pt-vault-header-top px-4 md:px-6 pb-4 md:pb-6 overflow-y-auto custom-scrollbar bg-[var(--bg-primary)] flex flex-col items-center">
            {selectedIds.size > 0 && (
                <VaultBulkActionsBar
                        selectedIds={selectedIds}
                    totalCount={sortedNotes.length}
                    onSelectAll={() => selectAll(sortedNotes.map(n => n.id))}
                    onClearSelection={clearSelection}
                    onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                    className="w-full max-w-3xl mb-4 shrink-0 bg-[var(--gnosi-primary)]/10 border border-[var(--gnosi-primary)]/20 rounded-lg px-4 py-2 flex items-center gap-3 text-sm z-30"
                />
            )}
            <FeedList
                key={resetKey}
                notes={sortedNotes}
                buildPills={buildPills}
                isSelected={isSelected}
                selectionActive={selectedIds.size > 0}
                onToggleSelect={toggleSelect}
                onOpen={onNoteSelect}
            />
        </div>
    );
}
