import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Tag, Calendar, Link as LinkIcon, Type, CheckSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { IconRenderer } from './IconRenderer';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { VaultViewToolbar } from './VaultViewToolbar';
import { FileFieldValue } from './FileFieldValue';
import { getImageSrc, toAssetPreviewUrl, withActiveVault } from '../../lib/fileResource';
import { getFieldType, getSchemaFieldNames, getFieldConfig, resolveViewSorts, resolveViewFilters } from './schemaUtils';
import { normalizeOptions, optionColorHex } from './optionCatalogUtils';
import { formatDate, formatNumber, resolveFieldFormat } from './formatUtils';
import { isMainView } from './viewConstants';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';
import { useTitlePreview } from './useTitlePreview';
import { asBool } from '../../utils/vaultFilters';
import { RelationItem } from './RelationItem';
import {
    normalizeRelationValues,
    unlinkRelationFromRecord,
} from './relationItemUtils';
import { GalleryContentPreview, GalleryOpenButton } from './GalleryCardPreview';
import { AutoriaDisplay } from './AutoriaField';
import { transportFetch } from '../../shared/api/transports';

export function VaultGallery({ notes, onNoteSelect, onOpenParallel, schema = {}, idToTitle = {}, allNotes = [], activeView = {}, onEditSchema, onCreateRecord, onDeleteSelected, onDeletePage, onApplyTemplate, templates = [], onUpdateNote, searchTerm: externalSearchTerm, registerNavApi, onExitTop, onExitBottom, onFocusShell }) {
    const { t } = useTranslation();
    const localeSettings = useLocaleSettings();
    const [internalSearchTerm, setInternalSearchTerm] = useState('');
    // EXPANDED groups (default: collapsed — empty Set). Same pattern as VaultTable.
    const [expandedGroups, setExpandedGroups] = useState(() => new Set());
    const searchTerm = externalSearchTerm !== undefined ? externalSearchTerm : internalSearchTerm;
    const setSearchTerm = externalSearchTerm !== undefined ? () => { } : setInternalSearchTerm;

    // ---- UNIFIED DATA LOGIC (FILTERS, SORT, SEARCH) ----
    // The order is resolved with `resolveViewSorts` (the `sorts` key — the one that persist
    // the Notion import and the modal — with fallback to the legacy `sort`).
    // Memoized: `resolveViewSorts`/`resolveViewFilters` return NEW arrays and
    // without useMemo, the sort/filtering was recalculated on every render.
    const viewConfig = useMemo(() => ({
        filters: resolveViewFilters(activeView),
        sorts: resolveViewSorts(activeView, { field: "last_modified", direction: "desc" }),
        search: searchTerm
    }), [activeView, searchTerm]);

    const { sortedPages: sortedAndFilteredNotes } = useVaultViewData({ pages: notes, schema, view: viewConfig, searchTerm });

    // Content preview when hovering over a card's title.
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });

    // ---- MULTIPLE SELECTION ----
    const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(sortedAndFilteredNotes);

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

    // ---- KEYBOARD NAVIGATION FOR CARDS ----
    // The gallery is embedded in the editor as a view-block: when focus is on the
    // embed shell, Space/Enter "descends" into it (via `registerNavApi.focusFirstCell`,
    // that calls DbViewEmbed). Here we move focus between cards with the arrow keys
    // (geometric, robust with the responsive grid and grouped sections),
    // we open with Enter, preview with Space (Quick Look), and exit it via the
    // boundaries (↑/↓ at the ends → editor) or with Esc (→ shell). `cardRefs` is indexed
    // by the card's flat index (a counter that runs continuously across groups).
    const cardRefs = useRef([]);
    // Group headers (keyboard navigation): one ref per header, indexed
    // by group order. When focus is there, ↑/↓ moves between headers and Enter
    // expands the group and moves down to its first item.
    const groupHeaderRefs = useRef([]);

    const focusCardAt = useCallback((idx) => {
        const el = cardRefs.current[idx];
        if (!el) return false;
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'nearest' });
        return true;
    }, []);

    const focusGroupHeaderAt = useCallback((idx) => {
        const el = groupHeaderRefs.current[idx];
        if (!el) return false;
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'nearest' });
        return true;
    }, []);

    // Navigation from a group's header:
    //  ↑/↓   → previous/next header
    //  Enter → toggles collapsed state; if expanded, moves down to the group's first item
    //  →     → if expanded, moves down to the first item (without toggling)
    //  Esc   → exits to the shell/editor
    // Entry into the items is deferred to the next render (effect) because the
    // cards of a collapsed group don't exist in cardRefs until it's expanded.
    const pendingEnterGroupRef = useRef(null);
    const handleGroupHeaderKeyDown = (e, idx, groupId) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); focusGroupHeaderAt(idx + 1); break;
            case 'ArrowUp': e.preventDefault();
                if (idx > 0) focusGroupHeaderAt(idx - 1);
                else onExitTop?.();
                break;
            case 'ArrowRight':
            case 'Enter': {
                e.preventDefault();
                const expanded = expandedGroups.has(groupId);
                const next = new Set(expandedGroups);
                if (expanded) next.delete(groupId); else next.add(groupId);
                setExpandedGroups(next);
                if (!expanded) pendingEnterGroupRef.current = groupId;
                break;
            }
            case 'Escape': e.preventDefault(); (onFocusShell || onExitTop)?.(); break;
            default: break;
        }
    };

    // Exposes the API to the editor to "enter" the records (first/last card).
    // If the gallery is grouped, the first element to receive focus is the
    // first group HEADER (expand it with Enter to enter the items).
    useEffect(() => {
        if (!registerNavApi) return undefined;
        registerNavApi({
            focusFirstCell: () => {
                // Grouped: initial focus goes to the first group header.
                if (groupHeaderRefs.current.some(Boolean)) {
                    const i = groupHeaderRefs.current.findIndex(Boolean);
                    return i >= 0 ? focusGroupHeaderAt(i) : focusCardAt(cardRefs.current.findIndex(Boolean));
                }
                const i = cardRefs.current.findIndex(Boolean);
                return i >= 0 ? focusCardAt(i) : false;
            },
            focusLastCell: () => {
                for (let i = cardRefs.current.length - 1; i >= 0; i--) {
                    if (cardRefs.current[i]) return focusCardAt(i);
                }
                return false;
            },
        });
        return () => registerNavApi(null);
    }, [registerNavApi, focusCardAt, focusGroupHeaderAt]);

    const moveByArrow = (dir, fromIdx) => {
        const els = cardRefs.current;
        const from = els[fromIdx];
        if (!from) return;
        // Left/right: reading order (skips index gaps); at the ends, it exits.
        if (dir === 'left') {
            let n = fromIdx - 1; while (n >= 0 && !els[n]) n--;
            if (n >= 0) focusCardAt(n); else onExitTop?.();
            return;
        }
        if (dir === 'right') {
            let n = fromIdx + 1; while (n < els.length && !els[n]) n++;
            if (n < els.length) focusCardAt(n); else onExitBottom?.();
            return;
        }
        // Up/down: geometric — the card with the closest center in that
        // vertical direction (ties broken by horizontal distance).
        const fr = from.getBoundingClientRect();
        const fx = fr.left + fr.width / 2;
        const fy = fr.top + fr.height / 2;
        let best = -1, bestScore = Infinity;
        for (let i = 0; i < els.length; i++) {
            if (i === fromIdx || !els[i]) continue;
            const r = els[i].getBoundingClientRect();
            const dy = (r.top + r.height / 2) - fy;
            if (dir === 'down' && dy <= 1) continue;
            if (dir === 'up' && dy >= -1) continue;
            const dx = (r.left + r.width / 2) - fx;
            const score = Math.abs(dy) + Math.abs(dx) * 0.5;
            if (score < bestScore) { bestScore = score; best = i; }
        }
        if (best >= 0) focusCardAt(best);
        else if (dir === 'down') onExitBottom?.();
        else onExitTop?.();
    };

    const handleCardKeyDown = (e, flatIdx, noteId) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        switch (e.key) {
            case 'Enter':
                e.preventDefault(); onNoteSelect?.(noteId); break;
            case ' ':
            case 'Spacebar': {
                // Quick Look (like in the table): Space opens the preview.
                e.preventDefault();
                const el = cardRefs.current[flatIdx];
                if (el) titlePreview.openForKeyboard(noteId, el.getBoundingClientRect());
                break;
            }
            case 'ArrowRight': e.preventDefault(); moveByArrow('right', flatIdx); break;
            case 'ArrowLeft': e.preventDefault(); moveByArrow('left', flatIdx); break;
            case 'ArrowDown': e.preventDefault(); moveByArrow('down', flatIdx); break;
            case 'ArrowUp': e.preventDefault(); moveByArrow('up', flatIdx); break;
            case 'Escape': e.preventDefault(); (onFocusShell || onExitTop)?.(); break;
            default: break;
        }
    };

    // Every view with `visibleProperties` configured respects them — INCLUDING the
    // main one (previously it forced all fields and hid the real config of the
    // views imported from Notion). Without config: the main view shows everything
    // the schema; a custom view, the first 3 fields.
    const visibleProperties = activeView?.visibleProperties?.length
        ? activeView.visibleProperties
        : (isMainView(activeView)
            ? getSchemaFieldNames(schema)
            : getSchemaFieldNames(schema).slice(0, 3));
    // Excludes `title` (like the kanban): the card header already shows it and
    // the previous filter (`type` truthy) was a no-op — getFieldType never returns
    // falsy — so the title used to appear duplicated as a property row.
    const dynamicColumns = visibleProperties.map(prop => [prop, getFieldType(schema, prop)]).filter(([, type]) => type && type !== 'title');

    // ---- GROUPING (activeView.groupBy) ----
    // Notion-style sections: group header + grid for each value of the
    // field. The view modal already offered `groupBy` for the gallery (and the import
    // Notion persists it), but the gallery ignored it. Same semantics
    // as the kanban: the order and color of the sections follow the catalog
    // of field options (select/status); a multi value (array) makes
    // the record appear in EVERY group; records without a value go to the last group.
    const groupBy = activeView?.groupBy || '';
    // Collapse/expand of a group (local state). Default: COLLAPSED. It resets
    // when changing view or grouping field (keys become meaningless again).
    const toggleGroup = useCallback((groupKey) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupKey)) next.delete(groupKey); else next.add(groupKey);
            return next;
        });
    }, []);
    useEffect(() => { setExpandedGroups(new Set()); }, [activeView?.id, groupBy]);
    const normalizeMetaKey = (k) => String(k).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/gi, '');
    const getGroupVal = (note) => {
        let val = note.metadata?.[groupBy];
        if (val === undefined || val === null || val === '') {
            const keyNorm = normalizeMetaKey(groupBy);
            const metaKey = Object.keys(note.metadata || {}).find(k => normalizeMetaKey(k) === keyNorm);
            if (metaKey) val = note.metadata[metaKey];
        }
        return val;
    };
    const groupedSections = (() => {
        if (!groupBy) return null;
        const groupConfig = getFieldConfig(schema, groupBy);
        const groupOptions = Array.isArray(groupConfig?.options) ? normalizeOptions(groupConfig.options) : [];
        const colorMap = {};
        groupOptions.forEach(o => { colorMap[o.name] = o.color; });

        const valuesOf = (note) => {
            const raw = getGroupVal(note);
            if (Array.isArray(raw)) return raw.map(v => String(v)).filter(Boolean);
            return (raw === undefined || raw === null || String(raw).trim() === '') ? [] : [String(raw)];
        };
        const buckets = new Map();
        groupOptions.forEach(o => buckets.set(o.name, []));
        const ungrouped = [];
        sortedAndFilteredNotes.forEach(note => {
            const vals = valuesOf(note);
            if (!vals.length) { ungrouped.push(note); return; }
            vals.forEach(v => {
                if (!buckets.has(v)) buckets.set(v, []);
                buckets.get(v).push(note);
            });
        });
        // `id` distinct from the displayed name: the empty-group section carries a
        // sentinel key so that a real "No group" value doesn't collide with
        // it (duplicate React keys and cross-reconciliation).
        let sections = [...buckets.entries()]
            .filter(([, groupNotes]) => groupNotes.length > 0)
            .map(([name, groupNotes]) => ({
                id: `g:${name}`,
                name,
                color: colorMap[name] ? optionColorHex(colorMap[name]) : null,
                notes: groupNotes,
            }));
        // Group order: 'catalog' (default, option catalog order);
        // 'alpha' alphabetical by name; 'count' by number of records. Direction
        // asc/desc. The "No group" group always goes last.
        const gs = activeView?.groupSort || activeView?.group_sort || 'catalog';
        const gsd = (activeView?.groupSortDir || activeView?.group_sort_dir || 'asc') === 'desc' ? -1 : 1;
        if (gs === 'alpha') {
            sections.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }) * gsd);
        } else if (gs === 'count') {
            sections.sort((a, b) => (a.notes.length - b.notes.length || String(a.name).localeCompare(String(b.name))) * gsd);
        } else if (gsd === -1) {
            sections.reverse();
        }
        if (ungrouped.length) sections.push({ id: '__gnosi_ungrouped__', name: 'Sense grup', color: null, notes: ungrouped });
        return sections;
    })();

    // After expanding a group (Enter), place focus on its first item.
    // Declared AFTER `groupedSections` because the effect references it in its
    // deps: if placed earlier, evaluating the deps array during render
    // throws a TDZ (ReferenceError) and trips the VaultViewErrorBoundary.
    useEffect(() => {
        const gid = pendingEnterGroupRef.current;
        if (!gid || !groupedSections) return;
        // Calculates the actual index in cardRefs of the expanded group's first item:
        // sums the notes of the groups expanded BEFORE this one.
        let idx = 0;
        for (const sec of groupedSections) {
            if (sec.id === gid) break;
            if (expandedGroups.has(sec.id)) idx += sec.notes.length;
        }
        pendingEnterGroupRef.current = null;
        const raf = requestAnimationFrame(() => focusCardAt(idx));
        return () => cancelAnimationFrame(raf);
    }, [expandedGroups, groupedSections, focusCardAt]);

    // Apply card size configuration
    const cardSize = activeView.cardSize || 'medium';
    const getGridClass = () => {
        switch (cardSize) {
            case 'small':
                return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8';
            case 'large':
                return 'grid-cols-1 sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3';
            case 'medium':
            default:
                return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5';
        }
    };

    const getCardHeightClass = () => {
        switch (cardSize) {
            case 'small':
                return 'h-40';
            case 'large':
                return 'h-80';
            case 'medium':
            default:
                return 'h-64';
        }
    };

    const getCoverHeightClass = () => {
        switch (cardSize) {
            case 'small':
                return 'h-16';
            case 'large':
                return 'h-48';
            case 'medium':
            default:
                return 'h-32';
        }
    };

    // Card preview mode (the view's `galleryPreview` field):
    //   cover      → top area with the page cover + properties
    //   content    → top area with a text excerpt + properties
    //   properties → no top area; title + properties (compact card)
    //   none       → minimal card: title and icon only
    const galleryPreview = activeView.galleryPreview || 'cover';
    // 'content' no longer promotes to a cover-like top area: it's rendered as a
    // document-card (title on top + the page text filling whatever space is available).
    const showCoverArea = galleryPreview === 'cover';
    const showContentPreview = galleryPreview === 'content';
    // In 'content' mode the card is filled by the page text, not the properties.
    const showProperties = galleryPreview === 'cover' || galleryPreview === 'properties';

    // Field to pull each card's cover from. Empty = the page's cover
    // (`metadata.cover`, classic behavior). If a field is specified, we extract
    // the servable image (getImageSrc + toAssetPreviewUrl).
    const coverField = activeView.coverField || '';
    const getCoverUrl = (note) => {
        if (coverField) {
            // TOLERANT key resolution (exact or normalized), like the rest
            // of the component (getGroupVal, property row): a metadata with the
            // key in another box/accent left the cover with an empty gradient
            // while the property row did show the thumbnail.
            let raw = note.metadata?.[coverField];
            if (raw === undefined || raw === null || raw === '') {
                const keyNorm = normalizeMetaKey(coverField);
                const metaKey = Object.keys(note.metadata || {}).find(k => normalizeMetaKey(k) === keyNorm);
                if (metaKey) raw = note.metadata[metaKey];
            }
            return toAssetPreviewUrl(getImageSrc(raw)) || '';
        }
        const c = note.metadata?.cover;
        if (typeof c === 'string' && c) {
            return c.startsWith('Assets/') ? withActiveVault(`/api/vault/assets/${c.substring(7)}`) : withActiveVault(c);
        }
        return '';
    };
    // Cover image fit: 'contain' (whole image, default) or 'cover' (fills).
    const coverFitClass = (activeView.imageFit || 'contain') === 'cover' ? 'bg-cover' : 'bg-contain';

    const getRelationDisplayMap = (field) => {
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
    };

    const renderPropertyValue = (value, type, field, note, metadataKey) => {
        if (value === undefined || value === null || value === '') return <span className="text-[var(--text-tertiary)] opacity-40">-</span>;

        switch (type) {
            case 'checkbox':
                return <CheckSquare size={12} className={asBool(value) ? "text-[var(--gnosi-primary)]" : "text-[var(--text-tertiary)]"} />;
            case 'date': {
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return (
                    <div className="flex items-center gap-1 whitespace-nowrap text-[10px] text-[var(--text-secondary)]">
                        <Calendar size={12} className="text-[var(--text-tertiary)]" />
                        <span>{formatDate(value, { dateFormat: fmt.dateFormat, type: 'date', locale: fmt.dateLocale })}</span>
                    </div>
                );
            }
            case 'number': {
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return <span className="tabular-nums">{formatNumber(value, { kind: fmt.kind, decimals: fmt.decimals, currencyCode: fmt.currencyCode, locale: fmt.numberLocale })}</span>;
            }
            case 'autoria':
                return <AutoriaDisplay value={value} />;
            case 'status':
            case 'select':
                return (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)] truncate max-w-full inline-block">
                        {value}
                    </span>
                );
            case 'multi_select': {
                // String() + filter(Boolean) like in the kanban: without this, "a, " or an
                // array with empty values would paint empty pills and inflate the "+N".
                const items = normalizeRelationValues(value);
                return (
                    <div className="flex flex-wrap gap-1 max-w-full overflow-hidden h-4">
                        {items.slice(0, 2).map((it, idx) => (
                            <span key={idx} className="px-1.5 py-0 rounded-sm text-[10px] font-medium bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] whitespace-nowrap truncate max-w-full block" title={it}>
                                {idToTitle[it] || (it.length > 20 ? it.substring(0, 8) + '…' : it)}
                            </span>
                        ))}
                        {items.length > 2 && <span className="text-[10px] text-[var(--text-tertiary)]">+{items.length - 2}</span>}
                    </div>
                );
            }
            case 'relation': {
                const items = normalizeRelationValues(value);
                const displayMap = getRelationDisplayMap(field);
                return (
                    <div className="flex flex-wrap gap-1 max-w-full">
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
                    </div>
                );
            }
            case 'url':
                return (
                    <a href={value} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-[var(--gnosi-primary)] hover:underline flex items-center gap-1 truncate text-xs">
                        <LinkIcon size={12} /> URL
                    </a>
                );
            case 'files':
                return <FileFieldValue value={value} field={field} variant="gallery" />;
            case 'zotero':
                return (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            transportFetch('/api/vault/open-resource', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    zotero_uri: String(value).trim().startsWith('zotero://') ? String(value).trim() : null,
                                    file_path: String(value).trim().startsWith('zotero://') ? null : String(value).trim(),
                                }),
                            });
                        }}
                        className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-500 hover:bg-emerald-500/20"
                        title={String(value)}
                    >
                        <LinkIcon size={12} /> Zotero
                    </button>
                );
            case 'image': {
                // Explicit image type: thumbnail whether the value is a string (path)
                // or a composite {src, alt, …}. The value is resolved into a servable URL.
                const src = getImageSrc(value);
                const previewUrl = toAssetPreviewUrl(src);
                if (previewUrl) return <img src={previewUrl} alt={(value && value.alt) || field} className="h-9 w-9 rounded object-cover" />;
                return <span className="truncate text-xs block text-[var(--text-secondary)]" title={src}>{src}</span>;
            }
            default:
                if (value && typeof value === 'object') {
                    // COMPOSITE image field {src, …}: thumbnail if it resolves, otherwise the src.
                    const src = getImageSrc(value);
                    const previewUrl = toAssetPreviewUrl(src);
                    if (previewUrl) return <img src={previewUrl} alt={value.alt || field} className="h-9 w-9 rounded object-cover" />;
                    return <span className="truncate text-xs block text-[var(--text-secondary)]" title={src}>{src}</span>;
                }
                // A boolean (Notion field untyped in the schema) is not a valid title.
                return <span className="truncate text-xs block text-[var(--text-secondary)]" title={typeof value === 'boolean' ? undefined : value}>{value}</span>;
        }
    };

    // Individual card (reused for the flat grid and for each group section;
    // the index only gives stability to the key within each grid).
    const renderCard = (note, flatIndex) => {
        const coverUrl = getCoverUrl(note);
        const hasCover = !!coverUrl;
        const showEmbeddedPreview = showContentPreview || showProperties;
        return (
            <div
                key={`${note.id || 'note'}-${flatIndex}`}
                ref={(el) => { cardRefs.current[flatIndex] = el; }}
                tabIndex={-1}
                onKeyDown={(e) => handleCardKeyDown(e, flatIndex, note.id)}
                onClick={() => { if (selectedIds.size > 0) { toggleSelect(note.id, {}); } else { onNoteSelect(note.id); } }}
                className={`group relative bg-[var(--bg-primary)] rounded-xl border overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)] focus:border-[var(--gnosi-primary)] ${showEmbeddedPreview ? getCardHeightClass() : ''} ${isSelected(note.id) ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50'}`}
            >
                {showEmbeddedPreview && <GalleryOpenButton pageId={note.id} />}
                {/* Selection checkbox (top-left corner). The toggle lives ONLY in the
                    input's onChange (#722): with the toggle also on the label's onClick,
                    a direct click on the checkbox fired both via bubbling and it stayed
                    as it was (no-op). */}
                <label
                    className={`absolute top-2 left-2 z-20 cursor-pointer ${isSelected(note.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <input
                        type="checkbox"
                        checked={isSelected(note.id)}
                        onChange={(e) => toggleSelect(note.id, e)}
                        className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer bg-[var(--bg-secondary)]/90 shadow-sm"
                    />
                </label>
                {/* Top area: only in 'cover' mode (page cover).
                    'content' mode is rendered inside the body, below the title. */}
                {showCoverArea && (
                    <div className={`${getCoverHeightClass()} relative shrink-0 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]`}>
                        {hasCover ? (
                            <div
                                className={`absolute inset-0 ${coverFitClass} bg-center bg-no-repeat`}
                                style={{ backgroundImage: `url("${coverUrl}")` }}
                            />
                        ) : (
                            <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-tertiary)] to-[var(--gnosi-primary)]/10" />
                        )}

                        {/* Icon overlaid on the cover */}
                        <div className="absolute -bottom-5 left-4 w-10 h-10 bg-[var(--bg-secondary)] rounded-lg shadow-sm border border-[var(--border-primary)] flex items-center justify-center z-10 group-hover:scale-110 transition-transform overflow-hidden">
                            <IconRenderer icon={note.metadata?.icon} size={24} />
                        </div>
                    </div>
                )}

                {/* Content Area */}
                <div className={`p-4 flex flex-col flex-1 min-h-0 ${showCoverArea ? 'pt-6' : ''}`}>
                    <h3 className={`font-semibold text-[var(--text-primary)] text-sm mb-2 truncate group-hover:text-[var(--gnosi-primary)] transition-colors flex items-center gap-2 ${showEmbeddedPreview && !showCoverArea ? 'pr-8' : ''}`} title={note.title}>
                        {!showCoverArea && (
                            <span className="shrink-0 inline-flex items-center justify-center w-5 h-5">
                                <IconRenderer icon={note.metadata?.icon} size={18} />
                            </span>
                        )}
                        <span className="truncate" {...titlePreview.getTitleProps(note.id)}>{note.title || t('common.untitled', "Untitled")}</span>
                    </h3>

                    {/* Content preview (mode 'content'): a scrollable, interactive
                        Markdown surface with the same wikilink behavior as a page. */}
                    {showContentPreview && (
                        <div className="relative flex-1 min-h-0">
                            <GalleryContentPreview
                                note={note}
                                idToTitle={idToTitle}
                                onNoteSelect={onNoteSelect}
                                onOpenParallel={onOpenParallel}
                            />
                        </div>
                    )}

                    {/* Properties */}
                    {showProperties && (
                    <div
                        onClick={(event) => event.stopPropagation()}
                        className="flex-1 flex flex-col gap-1.5 overflow-y-auto overflow-x-hidden overscroll-contain pr-1 custom-scrollbar cursor-auto"
                    >
                        {dynamicColumns.map(([key, type], propIndex) => {
                            const keyNorm = normalizeMetaKey(key);

                            let metadataKey = key;
                            let val = note.metadata?.[key];
                            if (val === undefined || val === null || val === '') {
                                const matchedKey = Object.keys(note.metadata || {}).find(k => normalizeMetaKey(k) === keyNorm);
                                if (matchedKey) {
                                    metadataKey = matchedKey;
                                    val = note.metadata[matchedKey];
                                }
                            }

                            if (val === undefined || val === null || val === '') return null;

                            return (
                                <div key={`${key}-${propIndex}`} className="flex items-center gap-2 text-[var(--text-secondary)] overflow-hidden min-h-[18px]">
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)] w-16 shrink-0 truncate">{key}</span>
                                    <div className="flex-1 min-w-0">
                                        {renderPropertyValue(val, type, key, note, metadataKey)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="w-full h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden">
            {externalSearchTerm === undefined && (
                <VaultViewToolbar
                    search={searchTerm}
                    onSearchChange={setSearchTerm}
                    onToggleFilters={() => onEditSchema?.('filters')}
                    onToggleSorts={() => onEditSchema?.('sorts')}
                    onAddNew={onCreateRecord}
                    activeFiltersCount={resolveViewFilters(activeView).length}
                    activeSortsCount={resolveViewSorts(activeView).length}
                    isEmbedded={false}
                />
            )}

            {/* Bulk actions bar */}
            {selectedIds.size > 0 && (
                <VaultBulkActionsBar
                    selectedIds={selectedIds}
                    totalCount={sortedAndFilteredNotes.length}
                    onSelectAll={() => selectAll(sortedAndFilteredNotes.map(n => n.id))}
                    onClearSelection={clearSelection}
                    onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                    templates={templates}
                    onApplyTemplate={onApplyTemplate ? (templateId) => { onApplyTemplate(new Set(selectedIds), templateId); clearSelection(); } : null}
                />
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 md:px-6 pb-4 md:pb-6 pt-vault-header-top">
                <div className="max-w-[1400px] mx-auto">
                    {groupedSections ? (
                        // Grouped: one section per value of the `groupBy` field, with a
                        // header (catalog color dot + name + count). `flat` is a counter
                        // that runs continuously across sections so each card gets a unique
                        // flat index (keyboard nav).
                        // COLLAPSIBLE groups: collapsed by default; the chevron expands/collapses.
                        (() => {
                            // Clear header refs from previous runs
                            // (groups can change due to sort/filter).
                            groupHeaderRefs.current.length = 0;
                            let flat = 0;            // flat card index (expanded only)
                            return groupedSections.map(({ id, name, color, notes: groupNotes }) => {
                                const expanded = expandedGroups.has(id);
                                const headerIdx = groupHeaderRefs.current.push(null) - 1;
                                return (
                                    <div key={id} className="mb-8">
                                        <div className="flex items-center gap-2 mb-3 sticky top-0 z-10 bg-[var(--bg-secondary)] py-1">
                                            <button
                                                type="button"
                                                ref={(el) => { groupHeaderRefs.current[headerIdx] = el; }}
                                                tabIndex={-1}
                                                onClick={() => toggleGroup(id)}
                                                onKeyDown={(e) => handleGroupHeaderKeyDown(e, headerIdx, id)}
                                                className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity outline-none focus-visible:ring-1 focus-visible:ring-[var(--gnosi-primary)] rounded px-1"
                                                title={expanded ? t('common.collapse', "Collapse") : t('common.expand', "Expand")}
                                            >
                                                {expanded
                                                    ? <ChevronDown size={15} className="text-[var(--text-tertiary)] shrink-0" />
                                                    : <ChevronRight size={15} className="text-[var(--text-tertiary)] shrink-0" />}
                                                {color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
                                                <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate" title={name}>{name}</h3>
                                                <span className="text-xs text-[var(--text-tertiary)] tabular-nums">{groupNotes.length}</span>
                                            </button>
                                        </div>
                                        {expanded && (
                                            <div className={`grid ${getGridClass()} gap-6`}>
                                                {groupNotes.map((note) => renderCard(note, flat++))}
                                            </div>
                                        )}
                                    </div>
                                );
                            });
                        })()
                    ) : (
                        <div className={`grid ${getGridClass()} gap-6`}>
                            {sortedAndFilteredNotes.map((note, i) => renderCard(note, i))}
                        </div>
                    )}

                    {sortedAndFilteredNotes.length === 0 && (
                        <div className="w-full h-64 flex flex-col items-center justify-center text-[var(--text-tertiary)]">
                            <FileText size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                            <p>{t('view.no_records_in_view', "No records in this view.")}</p>
                        </div>
                    )}
                </div>
            </div>

            {titlePreview.preview}
        </div>
    );
}
