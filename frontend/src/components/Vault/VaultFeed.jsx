import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Calendar, Clock, Link as LinkIcon, CheckSquare, Loader2 } from 'lucide-react';
import { getFieldConfig, getFieldType, getSchemaFieldNames, resolveViewSorts } from './schemaUtils';
import { FileFieldValue } from './FileFieldValue';
import { formatDate, formatNumber, resolveFieldFormat } from './formatUtils';
import { normalizeAssetUrl } from './vaultMarkdownUtils';
import { IconRenderer } from './IconRenderer';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';

// Quants registres es pinten per lot; l'scroll infinit n'afegeix més a mesura
// que el sentinella entra a la vista. Mantenir-ho baix estalvia DOM inicial.
const FEED_BATCH = 12;

// Ancestre que realment fa scroll. Cal buscar-lo perquè el `root` de
// l'IntersectionObserver pot ser el scroller de la pàgina (feed complet) O la
// caixa de 70vh de la vista incrustada (DbViewEmbed): dins d'aquesta, el propi
// contenidor del feed (`h-full overflow-auto`) creix a l'alçada del contingut i
// NO fa scroll —qui el fa és la caixa pare—, així que fixar el root al feed
// mateix trencava la càrrega. `null` = viewport si no en troba cap.
function getScrollParent(node) {
    let el = node?.parentElement;
    while (el) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
        el = el.parentElement;
    }
    return null;
}

// Neteja el text de la previsualització (`metadata.description`, l'excerpt que
// Notion importa) perquè es vegi com a text pla: treu embeds de fitxer/imatge,
// etiquetes HTML, marcadors de Markdown i entitats/nbsp. Si queda buit (p. ex.
// una description que només era un `<file …>`), no es pinta cap previsualització.
function cleanExcerpt(raw) {
    if (!raw) return '';
    let s = String(raw);
    s = s.replace(/<(file|img|iframe)\b[^>]*>/gi, ' ');   // embeds sencers
    s = s.replace(/<[^>]+>/g, ' ');                        // qualsevol altra etiqueta
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');           // imatges Markdown
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');         // enllaços Markdown → text
    s = s.replace(/[*_`#>~|]+/g, ' ');                     // marcadors d'èmfasi/estructura
    s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
         .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
    s = s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();   // nbsp + col·lapsa espais
    return s;
}

/**
 * Targeta individual del feed. Component propi perquè cada targeta gestioni el
 * seu estat d'expansió ("Veure més") sense un Set compartit al pare.
 */
function FeedCard({ note, pills, excerpt, isSelected, selectionActive, onToggleSelect, onOpen }) {
    const { t, i18n } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    // La portada s'ha de resoldre com a la resta de vistes (VaultGallery):
    // `Assets/x` → `/api/vault/assets/x` i, sobretot, amb el vault actiu al
    // query. Un `background-image` (com un `<img>` natiu) NO envia la
    // capçalera X-Vault-Id, així que sense normalitzar una portada relativa
    // donava 404 i en multivault apuntava al vault equivocat.
    const coverUrl = typeof note.metadata?.cover === 'string'
        ? normalizeAssetUrl(note.metadata.cover)
        : '';
    const hasCover = !!coverUrl;
    // El clamp es fa amb estil en línia (no depèn del plugin line-clamp de
    // Tailwind): 4 línies plegat, sencer expandit.
    const clampStyle = expanded
        ? undefined
        : { display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
    // El botó "Veure més" només té sentit si el text és prou llarg per plegar-se.
    const isLong = excerpt.length > 220;

    return (
        <div
            onClick={() => { if (selectionActive) onToggleSelect(note.id, {}); else onOpen(note.id); }}
            className={`relative bg-[var(--bg-primary)] rounded-2xl shadow-sm border overflow-hidden hover:shadow-md transition-all cursor-pointer group flex flex-col ${isSelected ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50'}`}
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

            {/* Portada: només si el registre en té. Sense portada no reservem el
                degradat buit (192-256px) que abans inflava cada targeta. */}
            {hasCover && (
                <div className="w-full h-48 sm:h-64 relative bg-[var(--bg-tertiary)] flex-shrink-0">
                    <div
                        className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
                        style={{ backgroundImage: `url("${coverUrl}")` }}
                    />
                </div>
            )}

            <div className="p-6 relative bg-[var(--bg-primary)]">
                {/* Icona solapada sobre la portada quan n'hi ha */}
                {hasCover && (
                    <div className="absolute -top-8 left-6 w-16 h-16 bg-[var(--bg-secondary)] rounded-xl shadow-sm border border-[var(--border-primary)] flex items-center justify-center text-3xl z-10 transition-transform group-hover:scale-110 overflow-hidden">
                        {note.metadata?.icon
                            ? <IconRenderer icon={note.metadata.icon} size={32} />
                            : <FileText size={24} className="text-[var(--text-tertiary)]" />}
                    </div>
                )}

                <div className={`${hasCover ? 'mt-8' : ''} flex flex-col gap-3`}>
                    {/* Capçalera: icona (en línia si no hi ha portada) + títol + data */}
                    <div className={hasCover ? '' : 'flex items-start gap-3'}>
                        {!hasCover && (
                            <div className="w-10 h-10 shrink-0 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] flex items-center justify-center overflow-hidden">
                                {note.metadata?.icon
                                    ? <IconRenderer icon={note.metadata.icon} size={22} />
                                    : <FileText size={18} className="text-[var(--text-tertiary)]" />}
                            </div>
                        )}
                        <div className="min-w-0">
                            <h2 className={`${hasCover ? 'text-2xl' : 'text-lg'} font-bold text-[var(--text-primary)] mb-1 leading-tight group-hover:text-[var(--gnosi-primary)] transition-colors`}>
                                {note.title || t('common.untitled', 'Sense títol')}
                            </h2>
                            <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-tertiary)]">
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
                        </div>
                    </div>

                    {/* Propietats com a píndoles EN LÍNIA (estil Notion): sense
                        etiqueta de camp, només el valor. Només si n'hi ha alguna. */}
                    {pills.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                            {pills.map(({ key, node }) => (
                                <React.Fragment key={key}>{node}</React.Fragment>
                            ))}
                        </div>
                    )}

                    {/* Previsualització del contingut + "Veure més" */}
                    {excerpt && (
                        <div>
                            <p
                                className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-line"
                                style={clampStyle}
                            >
                                {excerpt}
                            </p>
                            {isLong && (
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                                    className="mt-1 text-xs font-semibold text-[var(--gnosi-primary)] hover:underline"
                                >
                                    {expanded ? t('feed.see_less', 'Veure menys') : t('feed.see_more', 'Veure més')}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Indicador d'obrir la nota sencera (hover) */}
                <div className="absolute bottom-2 right-4 pointer-events-none">
                    <span className="text-sm font-semibold text-[var(--gnosi-primary)] opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 bg-[var(--bg-primary)]/80 rounded px-1">
                        {t('feed.read_full', 'Llegir sencer')} &rarr;
                    </span>
                </div>
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
        const io = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting)) {
                setVisibleCount(c => Math.min(c + FEED_BATCH, notes.length));
            }
        }, { root: getScrollParent(sentinel), rootMargin: '600px 0px' });
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
                    excerpt={cleanExcerpt(note.metadata?.description || '')}
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

    // Propietats visibles (respecta la vista, com la galeria): tota vista amb
    // `visibleProperties` configurats els respecta — TAMBÉ la principal (abans
    // forçava tots els camps i tapava la config real de les vistes importades
    // de Notion). Sense config es mostren tots els camps. Memoitzat perquè
    // buildPills en depèn i el React Compiler pugui conservar la memoització.
    // S'exclou `title` (per tipus I per clau): ja és l'encapçalament de la targeta.
    const dynamicColumns = useMemo(() => {
        const visibleProperties = activeView?.visibleProperties?.length
            ? activeView.visibleProperties
            : getSchemaFieldNames(schema);
        return visibleProperties
            .map(prop => [prop, getFieldType(schema, prop)])
            .filter(([key, type]) => type && type !== 'title' && String(key).toLowerCase() !== 'title');
    }, [activeView, schema]);

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
                return <CheckSquare size={14} className={value ? "text-indigo-500" : "text-[var(--text-tertiary)]"} />;
            case 'date': {
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return (
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-sm">
                        <Calendar size={14} className="text-[var(--text-tertiary)]" />
                        <span className="text-[var(--text-secondary)]">{formatDate(value, { dateFormat: fmt.dateFormat, type: 'date', locale: fmt.dateLocale })}</span>
                    </div>
                );
            }
            case 'number': {
                const fmt = resolveFieldFormat(getFieldConfig(schema, field), localeSettings);
                return <span className="tabular-nums text-[var(--text-secondary)] text-sm">{formatNumber(value, { kind: fmt.kind, decimals: fmt.decimals, currencyCode: fmt.currencyCode, locale: fmt.numberLocale })}</span>;
            }
            case 'status':
            case 'select':
                return (
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)]">
                        {value}
                    </span>
                );
            case 'multi_select':
            case 'relation': {
                const items = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
                const displayMap = type === 'relation' ? getRelationDisplayMap(field) : idToTitle;
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
            default:
                return <span className="text-sm text-[var(--text-primary)]">{value}</span>;
        }
    }, [schema, localeSettings, getRelationDisplayMap, idToTitle, t]);

    // Píndoles de propietat d'una nota (valors sense etiqueta, ordre de la vista).
    const buildPills = useCallback((note) => {
        const aliasMap = { "date added": "created_time", "date modified": "last_edited_time" };
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
    const viewConfig = {
        filters: activeView?.filters || [],
        sorts: resolveViewSorts(activeView, { field: 'last_modified', direction: 'desc' }),
        search: searchTerm,
    };
    const { sortedPages: sortedNotes } = useVaultViewData({ pages: notes, schema, view: viewConfig, searchTerm });

    const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(sortedNotes);

    // Clau del conjunt visible: en canviar (cerca, filtres, canvi de vista) es
    // remunta `FeedList` i el seu recompte d'scroll infinit es reinicia sol,
    // sense `setState` dins d'un effect ni mutació de refs en render.
    const resetKey = `${searchTerm}|${activeView?.id ?? ''}|${sortedNotes.length}`;

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
            <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-tertiary)] p-10 bg-[var(--bg-secondary)]">
                <FileText size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                <p>{t('feed.empty', 'No hi ha publicacions al feed.')}</p>
            </div>
        );
    }

    return (
        <div className="w-full h-full pt-vault-header-top px-4 md:px-6 pb-4 md:pb-6 overflow-y-auto custom-scrollbar bg-[var(--bg-secondary)] flex flex-col items-center">
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
