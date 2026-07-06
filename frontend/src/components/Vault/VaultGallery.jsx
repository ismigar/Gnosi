import React, { useState, useCallback } from 'react';
import { FileText, Tag, Calendar, Link as LinkIcon, Type, CheckSquare } from 'lucide-react';
import { IconRenderer } from './IconRenderer';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { VaultViewToolbar } from './VaultViewToolbar';
import { FileFieldValue } from './FileFieldValue';
import { getImageSrc, toAssetPreviewUrl, withActiveVault } from '../../lib/fileResource';
import { getFieldType, getSchemaFieldNames, getFieldConfig, resolveViewSorts } from './schemaUtils';
import { normalizeOptions, optionColorHex } from './optionCatalogUtils';
import { formatDate, formatNumber, resolveFieldFormat } from './formatUtils';
import { isMainView } from './viewConstants';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';
import { useTitlePreview } from './useTitlePreview';

export function VaultGallery({ notes, onNoteSelect, schema = {}, idToTitle = {}, allNotes = [], activeView = {}, onUpdateView, onEditSchema, onCreateRecord, onDeleteSelected, onDeletePage, searchTerm: externalSearchTerm }) {
    const localeSettings = useLocaleSettings();
    const [internalSearchTerm, setInternalSearchTerm] = useState('');
    const searchTerm = externalSearchTerm !== undefined ? externalSearchTerm : internalSearchTerm;
    const setSearchTerm = externalSearchTerm !== undefined ? () => { } : setInternalSearchTerm;

    // ---- LÒGICA DE DADES UNIFICADA (FITRES, SORT, SEARCH) ----
    // L'ordre es resol amb `resolveViewSorts` (clau `sorts` — la que persisteixen
    // l'import de Notion i el modal — amb fallback a la llegada `sort`).
    const viewConfig = {
        filters: activeView?.filters || [],
        sorts: resolveViewSorts(activeView, { field: "last_modified", direction: "desc" }),
        search: searchTerm
    };

    const { sortedPages: sortedAndFilteredNotes } = useVaultViewData({ pages: notes, schema, view: viewConfig, searchTerm });

    // Previsualització del contingut en passar el ratolí pel títol d'una targeta.
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });

    // ---- SELECCIÓ MÚLTIPLE ----
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

    // Tota vista amb `visibleProperties` configurats els respecta — TAMBÉ la
    // principal (abans forçava tots els camps i tapava la config real de les
    // vistes importades de Notion). Sense config: la principal mostra tot
    // l'esquema; una vista custom, els 3 primers camps.
    const visibleProperties = activeView?.visibleProperties?.length
        ? activeView.visibleProperties
        : (isMainView(activeView)
            ? getSchemaFieldNames(schema)
            : getSchemaFieldNames(schema).slice(0, 3));
    const dynamicColumns = visibleProperties.map(prop => [prop, getFieldType(schema, prop)]).filter(([key, type]) => type);

    // ---- AGRUPACIÓ (activeView.groupBy) ----
    // Seccions estil Notion: capçalera de grup + graella per a cada valor del
    // camp. El modal de vista ja oferia `groupBy` per a la galeria (i l'import
    // de Notion el persisteix), però la galeria l'ignorava. Mateixa semàntica
    // que el kanban: l'ordre i el color de les seccions segueixen el catàleg
    // d'opcions del camp (select/status); un valor multi (array) fa aparèixer
    // el registre a CADA grup; els registres sense valor van a l'últim grup.
    const groupBy = activeView?.groupBy || '';
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
        const sections = [...buckets.entries()]
            .filter(([, groupNotes]) => groupNotes.length > 0)
            .map(([name, groupNotes]) => ({
                name,
                color: colorMap[name] ? optionColorHex(colorMap[name]) : null,
                notes: groupNotes,
            }));
        if (ungrouped.length) sections.push({ name: 'Sense grup', color: null, notes: ungrouped });
        return sections;
    })();

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

    // Mode de previsualització de la targeta (camp `galleryPreview` de la vista):
    //   cover      → àrea superior amb la portada de la pàgina + propietats
    //   content    → àrea superior amb un fragment del text + propietats
    //   properties → sense àrea superior; títol + propietats (targeta compacta)
    //   none       → targeta mínima: només títol i icona
    const galleryPreview = activeView.galleryPreview || 'cover';
    // 'content' ja NO puja a una àrea superior tipus portada: es renderitza com a
    // targeta-document (títol a dalt + el text de la pàgina omplint el que càpiga).
    const showCoverArea = galleryPreview === 'cover';
    const showContentPreview = galleryPreview === 'content';
    // En mode 'content' la targeta l'omple el text de la pàgina, no les propietats.
    const showProperties = galleryPreview === 'cover' || galleryPreview === 'properties';

    // Camp d'on treure la portada de cada targeta. Buit = portada de la pàgina
    // (`metadata.cover`, comportament clàssic). Si s'especifica un camp, n'extraiem
    // la imatge servible (getImageSrc + toAssetPreviewUrl).
    const coverField = activeView.coverField || '';
    const getCoverUrl = (note) => {
        if (coverField) {
            return toAssetPreviewUrl(getImageSrc(note.metadata?.[coverField])) || '';
        }
        const c = note.metadata?.cover;
        if (typeof c === 'string' && c) {
            return c.startsWith('Assets/') ? withActiveVault(`/api/vault/assets/${c.substring(7)}`) : withActiveVault(c);
        }
        return '';
    };
    // Ajust de la imatge de portada: 'contain' (sencera, defecte) o 'cover' (omple).
    const coverFitClass = (activeView.imageFit || 'contain') === 'cover' ? 'bg-cover' : 'bg-contain';

    // Fragment de text per al mode "content". Tolerant amb la forma del registre
    // (excerpt/body_md/content o una descripció a metadata); neteja frontmatter,
    // imatges/enllaços i marques markdown bàsiques per a una previsualització neta.
    const getExcerpt = (note) => {
        const raw = note.excerpt || note.body_md || note.content
            || note.metadata?.description || note.metadata?.summary || '';
        if (!raw) return '';
        return String(raw)
            .replace(/^---[\s\S]*?---/, '')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/[#>*_`~]/g, '')
            .replace(/[ \t]+/g, ' ')        // espais/tabs → 1 (preserva salts de línia)
            .replace(/\n{2,}/g, '\n')       // línies en blanc múltiples → una de sola
            .split('\n').map(s => s.trim()).filter(Boolean).join('\n')
            .slice(0, 600);                 // prou text per omplir targetes grans
    };

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

    const renderPropertyValue = (value, type, field) => {
        if (value === undefined || value === null || value === '') return <span className="text-[var(--text-tertiary)] opacity-40">-</span>;

        switch (type) {
            case 'checkbox':
                return <CheckSquare size={12} className={value ? "text-[var(--gnosi-primary)]" : "text-[var(--text-tertiary)]"} />;
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
            case 'status':
            case 'select':
                return (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)] truncate max-w-full inline-block">
                        {value}
                    </span>
                );
            case 'multi_select':
            case 'relation': {
                const items = Array.isArray(value) ? value : String(value).split(',').map(s => s.trim());
                const displayMap = type === 'relation' ? getRelationDisplayMap(field) : idToTitle;
                return (
                    <div className="flex flex-wrap gap-1 max-w-full overflow-hidden h-4">
                        {items.slice(0, 2).map((it, idx) => (
                            <span key={idx} className="px-1.5 py-0 rounded-sm text-[10px] font-medium bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] whitespace-nowrap truncate max-w-full block" title={it}>
                                {displayMap[it] || (it.length > 20 ? it.substring(0, 8) + '…' : it)}
                            </span>
                        ))}
                        {items.length > 2 && <span className="text-[10px] text-[var(--text-tertiary)]">+{items.length - 2}</span>}
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
                            fetch('/api/vault/open-resource', {
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
                // Tipus imatge explícit: miniatura tant si el valor és string (ruta)
                // com compost {src, alt, …}. value-gateja amb la URL servible.
                const src = getImageSrc(value);
                const previewUrl = toAssetPreviewUrl(src);
                if (previewUrl) return <img src={previewUrl} alt={(value && value.alt) || field} className="h-9 w-9 rounded object-cover" />;
                return <span className="truncate text-xs block text-[var(--text-secondary)]" title={src}>{src}</span>;
            }
            default:
                if (value && typeof value === 'object') {
                    // Camp imatge COMPOST {src, …}: miniatura si resol, si no el src.
                    const src = getImageSrc(value);
                    const previewUrl = toAssetPreviewUrl(src);
                    if (previewUrl) return <img src={previewUrl} alt={value.alt || field} className="h-9 w-9 rounded object-cover" />;
                    return <span className="truncate text-xs block text-[var(--text-secondary)]" title={src}>{src}</span>;
                }
                return <span className="truncate text-xs block text-[var(--text-secondary)]" title={value}>{value}</span>;
        }
    };

    // Targeta individual (reutilitzada per la graella plana i per cada secció
    // de grup; l'índex només dóna estabilitat a la key dins de cada graella).
    const renderCard = (note, noteIndex) => {
        const coverUrl = getCoverUrl(note);
        const hasCover = !!coverUrl;
        const excerpt = showContentPreview ? getExcerpt(note) : '';
        return (
            <div
                key={`${note.id || 'note'}-${noteIndex}`}
                onClick={() => { if (selectedIds.size > 0) { toggleSelect(note.id, {}); } else { onNoteSelect(note.id); } }}
                className={`group relative bg-[var(--bg-primary)] rounded-xl border overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col ${(showCoverArea || showContentPreview) ? getCardHeightClass() : ''} ${isSelected(note.id) ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50'}`}
            >
                {/* Checkbox de selecció (cantonada superior esquerra). El toggle
                    viu NOMÉS a l'onChange de l'input (#722): amb toggle també a
                    l'onClick del label, el clic directe al checkbox disparava
                    tots dos pel bubbling i es quedava com estava (no-op). */}
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
                {/* Àrea superior: només mode 'cover' (portada de la pàgina).
                    El mode 'content' es renderitza dins el cos, sota el títol. */}
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

                        {/* Icona superposada a la portada */}
                        <div className="absolute -bottom-5 left-4 w-10 h-10 bg-[var(--bg-secondary)] rounded-lg shadow-sm border border-[var(--border-primary)] flex items-center justify-center z-10 group-hover:scale-110 transition-transform overflow-hidden">
                            <IconRenderer icon={note.metadata?.icon} size={24} />
                        </div>
                    </div>
                )}

                {/* Content Area */}
                <div className={`p-4 flex flex-col flex-1 min-h-0 ${showCoverArea ? 'pt-6' : ''}`}>
                    <h3 className="font-semibold text-[var(--text-primary)] text-sm mb-2 truncate group-hover:text-[var(--gnosi-primary)] transition-colors flex items-center gap-2" title={note.title}>
                        {!showCoverArea && (
                            <span className="shrink-0 inline-flex items-center justify-center w-5 h-5">
                                <IconRenderer icon={note.metadata?.icon} size={18} />
                            </span>
                        )}
                        <span className="truncate" {...titlePreview.getTitleProps(note.id)}>{note.title || "Sense Títol"}</span>
                    </h3>

                    {/* Previsualització del contingut (mode 'content'): el que
                        càpiga del text de la pàgina, sota el títol, amb fade final. */}
                    {showContentPreview && (
                        <div className="relative flex-1 min-h-0 overflow-hidden">
                            {excerpt ? (
                                <p className="text-xs leading-relaxed text-[var(--text-secondary)] whitespace-pre-line">{excerpt}</p>
                            ) : (
                                <div className="h-full flex items-center justify-center text-[var(--text-tertiary)] opacity-40">
                                    <FileText size={24} strokeWidth={1.5} />
                                </div>
                            )}
                            {excerpt && (
                                <div className="pointer-events-none absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-[var(--bg-primary)] to-transparent" />
                            )}
                        </div>
                    )}

                    {/* Properties */}
                    {showProperties && (
                    <div className="flex-1 flex flex-col gap-1.5 overflow-hidden">
                        {dynamicColumns.map(([key, type], propIndex) => {
                            const keyNorm = normalizeMetaKey(key);

                            let val = note.metadata?.[key];
                            if (val === undefined || val === null || val === '') {
                                const metaKey = Object.keys(note.metadata || {}).find(k => normalizeMetaKey(k) === keyNorm);
                                if (metaKey) val = note.metadata[metaKey];
                            }

                            if (val === undefined || val === null || val === '') return null;

                            return (
                                <div key={`${key}-${propIndex}`} className="flex items-center gap-2 text-[var(--text-secondary)] overflow-hidden min-h-[18px]">
                                    <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)] w-16 shrink-0 truncate">{key}</span>
                                    <div className="flex-1 min-w-0">
                                        {renderPropertyValue(val, type, key)}
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
        <div className="w-full h-full flex flex-col bg-[var(--bg-secondary)] overflow-hidden">
            {externalSearchTerm === undefined && (
                <VaultViewToolbar
                    search={searchTerm}
                    onSearchChange={setSearchTerm}
                    onToggleFilters={() => onEditSchema?.('filters')}
                    onToggleSorts={() => onEditSchema?.('sorts')}
                    onAddNew={onCreateRecord}
                    activeFiltersCount={Array.isArray(activeView?.filters) ? activeView.filters.length : (activeView?.filters?.conditions?.length || 0)}
                    activeSortsCount={resolveViewSorts(activeView).length}
                    isEmbedded={false}
                />
            )}

            {/* Barra d'accions en bulk */}
            {selectedIds.size > 0 && (
                <VaultBulkActionsBar
                    selectedIds={selectedIds}
                    totalCount={sortedAndFilteredNotes.length}
                    onSelectAll={() => selectAll(sortedAndFilteredNotes.map(n => n.id))}
                    onClearSelection={clearSelection}
                    onDeleteSelected={(onDeleteSelected || onDeletePage) ? handleBulkDelete : null}
                />
            )}

            <div className="flex-1 overflow-y-auto custom-scrollbar px-4 md:px-6 pb-4 md:pb-6 pt-vault-header-top">
                <div className="max-w-[1400px] mx-auto">
                    {groupedSections ? (
                        // Agrupada: una secció per valor del camp `groupBy`, amb
                        // capçalera (punt de color del catàleg + nom + recompte).
                        groupedSections.map(({ name, color, notes: groupNotes }) => (
                            <div key={name} className="mb-8">
                                <div className="flex items-center gap-2 mb-3 sticky top-0 z-10 bg-[var(--bg-secondary)] py-1">
                                    {color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
                                    <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate" title={name}>{name}</h3>
                                    <span className="text-xs text-[var(--text-tertiary)] tabular-nums">{groupNotes.length}</span>
                                </div>
                                <div className={`grid ${getGridClass()} gap-6`}>
                                    {groupNotes.map((note, noteIndex) => renderCard(note, noteIndex))}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className={`grid ${getGridClass()} gap-6`}>
                            {sortedAndFilteredNotes.map((note, noteIndex) => renderCard(note, noteIndex))}
                        </div>
                    )}

                    {sortedAndFilteredNotes.length === 0 && (
                        <div className="w-full h-64 flex flex-col items-center justify-center text-[var(--text-tertiary)]">
                            <FileText size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                            <p>No hi ha registres en aquesta vista.</p>
                        </div>
                    )}
                </div>
            </div>

            {titlePreview.preview}
        </div>
    );
}
