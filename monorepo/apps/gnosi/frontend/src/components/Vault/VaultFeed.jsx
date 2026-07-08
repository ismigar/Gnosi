import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
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

// Quants registres es pinten per lot; l'scroll infinit n'afegeix més a mesura
// que el sentinella entra a la vista. Mantenir-ho baix estalvia DOM inicial.
const FEED_BATCH = 12;

// La `metadata.description` (excerpt del cos) està capada a aquest límit pel
// backend: si s'hi acosta, el cos real segueix i té sentit oferir "Veure més".
const EXCERPT_CAP = 480;

// Prepara el cos (excerpt o contingut sencer) per a VaultMarkdown: fora els
// embeds `<file …>` (no renderitzables aquí) i `<br>` HTML → salt de línia real
// (react-markdown ignora l'HTML cru i es perdria). La resta de Markdown
// (negretes, llistes, imatges d'Assets, wikilinks) es renderitza amb format.
// El `(?:>|$)` cobreix el tag TRUNCAT: l'excerpt talla a 500 caràcters i un
// `<file src="…` sense `>` final sortia com a text pla a la targeta.
function prepareBodyMd(raw) {
    if (!raw) return '';
    let s = String(raw);
    s = s.replace(/<file\b[^>]*(?:>|$)/gi, '');
    s = s.replace(/<\/file>/gi, '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    return s.trim();
}

/**
 * Targeta del feed (estil Notion): icona+títol en línia, TOTES les propietats
 * en línia com a píndoles, previsualització generosa del contingut amb format i
 * "Veure més" que carrega i desplega el contingut COMPLET de la nota. La
 * targeta no navega en clicar-la (es pot seleccionar text i interactuar amb el
 * cos); obrir la pàgina es fa amb el botó "Obrir" o clicant el títol.
 */
function FeedCard({ note, pills, isSelected, selectionActive, onToggleSelect, onOpen }) {
    const { t, i18n } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [fullContent, setFullContent] = useState(null);   // md complet (carregat en demanda)
    const [loadingContent, setLoadingContent] = useState(false);
    // La portada es resol com a la resta de vistes (VaultGallery): `Assets/x`
    // → `/api/vault/assets/x` amb el vault actiu al query. Un `background-image`
    // (com un `<img>` natiu) NO envia la capçalera X-Vault-Id, així que sense
    // normalitzar, una portada relativa donava 404 i en multivault apuntava al
    // vault equivocat (fix #775).
    const coverUrl = typeof note.metadata?.cover === 'string'
        ? normalizeAssetUrl(note.metadata.cover)
        : '';
    const hasCover = !!coverUrl;

    const previewMd = useMemo(() => prepareBodyMd(note.metadata?.description || ''), [note]);
    // L'excerpt s'acosta al límit → el cos real continua més enllà.
    const looksTruncated = (note.metadata?.description || '').length >= EXCERPT_CAP;

    const handleToggleExpand = useCallback(async (e) => {
        e.stopPropagation();
        if (expanded) { setExpanded(false); return; }
        if (fullContent == null) {
            setLoadingContent(true);
            try {
                const res = await axios.get(`/api/vault/pages/${encodeURIComponent(note.id)}`);
                const md = prepareBodyMd(res.data?.content || '');
                setFullContent(md || previewMd);
            } catch {
                setFullContent(previewMd);   // fallback: almenys l'excerpt
            } finally {
                setLoadingContent(false);
            }
        }
        setExpanded(true);
    }, [expanded, fullContent, note.id, previewMd]);

    const openNote = useCallback((e) => { e?.stopPropagation?.(); onOpen(note.id); }, [onOpen, note.id]);

    return (
        <div
            onClick={() => { if (selectionActive) onToggleSelect(note.id, {}); }}
            className={`relative bg-[var(--bg-primary)] rounded-2xl shadow-sm border overflow-hidden hover:shadow-md transition-all group flex flex-col ${selectionActive ? 'cursor-pointer' : ''} ${isSelected ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/40'}`}
        >
            {/* El label només atura la propagació (no obrir la targeta): el
                toggle el fa l'onChange de l'input. Si el label també cridés
                onToggleSelect, un clic directe al checkbox dispararia els dos
                handlers (bubbling) i el toggle doble deixaria la selecció
                com estava. */}
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

            {/* Portada: només si el registre en té. */}
            {hasCover && (
                <div className="w-full h-48 sm:h-64 relative bg-[var(--bg-tertiary)] flex-shrink-0">
                    <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url("${coverUrl}")` }}
                    />
                </div>
            )}

            <div className="p-6 flex flex-col gap-3">
                {/* Capçalera: data petita + (icona+títol en línia) + botó Obrir */}
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)] mb-1.5">
                            <Clock size={12} />
                            <span>
                                {t('feed.updated_at', {
                                    defaultValue: 'Actualitzat el {{date}}',
                                    date: new Date(note.last_modified).toLocaleDateString(i18n.language, {
                                        day: 'numeric', month: 'long', year: 'numeric',
                                        hour: '2-digit', minute: '2-digit'
                                    }),
                                })}
                            </span>
                        </div>
                        <h2
                            onClick={selectionActive ? undefined : openNote}
                            className={`text-xl font-bold text-[var(--text-primary)] leading-tight flex items-center gap-2 min-w-0 ${selectionActive ? '' : 'cursor-pointer hover:text-[var(--gnosi-primary)]'} transition-colors`}
                            title={note.title || ''}
                        >
                            {note.metadata?.icon && (
                                <span className="shrink-0 inline-flex"><IconRenderer icon={note.metadata.icon} size={24} /></span>
                            )}
                            <span className="min-w-0">{note.title || t('common.untitled', 'Sense títol')}</span>
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={openNote}
                        className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)] hover:border-[var(--gnosi-primary)]/50 transition-colors"
                        title={t('feed.open_page', 'Obrir la pàgina')}
                    >
                        <ExternalLink size={13} />
                        {t('feed.open', 'Obrir')}
                    </button>
                </div>

                {/* TOTES les propietats en línia (estil Notion): només el valor. */}
                {pills.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        {pills.map(({ key, node }) => (
                            <React.Fragment key={key}>{node}</React.Fragment>
                        ))}
                    </div>
                )}

                {/* Cos: excerpt amb format (Markdown) i, en expandir, el contingut
                    COMPLET de la nota (carregat en demanda). */}
                {(previewMd || loadingContent) && (
                    <div className="text-sm text-[var(--text-secondary)] leading-relaxed" onClick={(e) => e.stopPropagation()}>
                        <VaultMarkdown
                            md={expanded ? (fullContent ?? previewMd) : previewMd}
                            onActivate={() => onOpen(note.id)}
                            imageTitle={note.title || ''}
                        />
                    </div>
                )}

                {/* "Veure més / Veure menys" centrat (com el «Ver más» de Notion).
                    Només si l'excerpt està tallat (el cos real continua). */}
                {(looksTruncated || expanded) && (
                    <div className="flex justify-center">
                        <button
                            type="button"
                            onClick={handleToggleExpand}
                            disabled={loadingContent}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] shadow-sm transition-colors"
                        >
                            {loadingContent
                                ? <Loader2 size={13} className="animate-spin" />
                                : (expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                            {expanded ? t('feed.see_less', 'Veure menys') : t('feed.see_more', 'Veure més')}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Llista de targetes amb scroll infinit. Es pinten `visibleCount` registres i
 * un sentinella al final n'afegeix un lot més quan entra a la vista. Component
 * propi perquè el pare el pugui remuntar (via `key`) i reiniciar el recompte en
 * canviar el conjunt, sense `setState` dins d'un effect ni mutar refs en render.
 */
function FeedList({ notes, buildPills, isSelected, selectionActive, onToggleSelect, onOpen }) {
    const sentinelRef = useRef(null);
    const [visibleCount, setVisibleCount] = useState(FEED_BATCH);
    const hasMore = visibleCount < notes.length;

    useEffect(() => {
        if (!hasMore) return undefined;
        const sentinel = sentinelRef.current;
        if (!sentinel) return undefined;
        // setState va dins del callback de l'observer (asíncron), no al cos de
        // l'effect: és el patró "subscriu-te i actualitza en el callback".
        //
        // `root: null` (viewport) A POSTA: el sentinella es fa visible a pantalla
        // igualment tant si l'scroll el fa la pàgina (feed incrustat, que creix)
        // com el pane de la vista completa. Ancorar el root a l'ancestre
        // scrollable era fràgil: el scroller de pàgina té clientHeight 0 (layout
        // flex) i com a root mai no intersecava → el feed es quedava al 1r lot.
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
        <div className="w-full max-w-2xl flex flex-col gap-8 pb-16">
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

            {/* Sentinella d'scroll infinit + indicador de càrrega */}
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

    // El feed mostra TOTES les propietats del registre (com el feed de Notion),
    // independentment dels `visibleProperties` de la vista: la targeta és el
    // registre sencer en format publicació. S'exclou `title` (per tipus I per
    // clau): ja és l'encapçalament de la targeta.
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
                // Rang "inici/fi" en un sol valor: cada meitat amb el format
                // localitzat (abans queia al default i mostrava l'ISO cru).
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                const { start, end } = parsePeriod(value);
                const fmtOne = (v) => formatDate(v, { dateFormat: fmt.dateFormat, type: 'date', locale: fmt.dateLocale });
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
                // Color del catàleg d'opcions ric ({name,color}); si l'opció no
                // hi és, color automàtic estable pel nom (mateix algorisme que
                // el backend) — mai el xip neutre.
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
                        <LinkIcon size={14} /> {t('table.open_zotero', 'Obrir Zotero')}
                    </button>
                );
            case 'image': {
                // Miniatura per a valors string (ruta) o compostos {src, alt, …}.
                const src = getImageSrc(value);
                const previewUrl = toAssetPreviewUrl(src);
                if (previewUrl) return <img src={previewUrl} alt={(value && value.alt) || field} className="h-10 w-10 rounded object-cover" />;
                return src ? <span className="text-sm text-[var(--text-secondary)] truncate max-w-xs inline-block" title={src}>{src}</span> : null;
            }
            default:
                // Xarxa de seguretat: un OBJECTE (p. ex. camp imatge compost
                // {src, alt} en un camp no tipat com a image) com a fill de React
                // llança "Objects are not valid as a React child" i tombava TOT
                // el feed al boundary. Provem la via d'imatge i, si no, text.
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    const src = getImageSrc(value);
                    const previewUrl = toAssetPreviewUrl(src);
                    if (previewUrl) return <img src={previewUrl} alt={value.alt || field} className="h-10 w-10 rounded object-cover" />;
                    return src ? <span className="text-sm text-[var(--text-secondary)] truncate max-w-xs inline-block" title={src}>{src}</span> : null;
                }
                return <span className="text-sm text-[var(--text-primary)]">{Array.isArray(value) ? value.map(v => String(v)).join(', ') : String(value)}</span>;
        }
    }, [schema, localeSettings, getRelationDisplayMap, t]);

    // Píndoles de propietat d'una nota (valors sense etiqueta, ordre d'esquema).
    const buildPills = useCallback((note) => {
        // Claus normalitzades (sense espais) perquè casin amb `schemaKeyNorm`.
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

    // Filtres, ordre i cerca de la vista (mateix motor que taula/galeria).
    // L'ordre es resol amb `resolveViewSorts` (clau `sorts` — la que persisteixen
    // l'import de Notion i el modal — amb fallback a la llegada `sort`).
    // Memoitzat: `resolveViewSorts`/`resolveViewFilters` retornen arrays NOUS i
    // sense useMemo el sort/filtrat es recalculava a cada render.
    const viewConfig = useMemo(() => ({
        filters: resolveViewFilters(activeView),
        sorts: resolveViewSorts(activeView, { field: 'last_modified', direction: 'desc' }),
        search: searchTerm,
    }), [activeView, searchTerm]);
    const { sortedPages: sortedNotes } = useVaultViewData({ pages: notes, schema, view: viewConfig, searchTerm });

    const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(sortedNotes);

    // Clau del conjunt visible: en canviar (cerca, canvi de vista, filtres o
    // ordre) es remunta `FeedList` i el seu recompte d'scroll infinit es
    // reinicia sol. La signatura és ESTABLE respecte del recompte (fix #788):
    // es basa en la config lògica (filtres + ordre), NO en `sortedNotes.length`
    // —incloure-la remuntava el feed i el saltava al principi en esborrar notes
    // des del feed o rebre'n de noves per sync/poll. El `slice` de FeedList ja
    // gestiona que la llista encongeixi per sota de `visibleCount` sense remuntar.
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
                <p>{t('feed.empty', 'No hi ha publicacions al feed.')}</p>
            </div>
        );
    }

    return (
        <div className="w-full h-full pt-vault-header-top px-4 md:px-6 pb-4 md:pb-6 overflow-y-auto custom-scrollbar bg-[var(--bg-primary)] flex flex-col items-center">
            {selectedIds.size > 0 && (
                <VaultBulkActionsBar
                        selectedIds={selectedIds}
                    totalCount={sortedNotes.length}
                    onSelectAll={() => selectAll(sortedNotes.map(n => n.id))}
                    onClearSelection={clearSelection}
                    onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                    className="w-full max-w-2xl mb-4 shrink-0 bg-[var(--gnosi-primary)]/10 border border-[var(--gnosi-primary)]/20 rounded-lg px-4 py-2 flex items-center gap-3 text-sm z-30"
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
