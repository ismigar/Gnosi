import React, { useCallback } from 'react';
import { FileText, Calendar, Clock, Link as LinkIcon, CheckSquare } from 'lucide-react';
import { getFieldConfig, getFieldType, getSchemaFieldNames } from './schemaUtils';
import { FileFieldValue } from './FileFieldValue';
import { formatDate, formatNumber, resolveFieldFormat } from './formatUtils';
import { IconRenderer } from './IconRenderer';
import { isMainView } from './viewConstants';
import { useVaultViewData } from '../../hooks/useVaultViewData';
import { useLocaleSettings } from '../../hooks/useLocaleSettings';
import { useVaultSelection } from '../../hooks/useVaultSelection';
import { VaultBulkActionsBar } from './VaultBulkActionsBar';
import { useVaultSelectionShortcuts } from '../../hooks/useVaultSelectionShortcuts';

export function VaultFeed({ notes, onNoteSelect, schema = {}, idToTitle = {}, allNotes = [], activeView = {}, onDeleteSelected, onDeletePage, searchTerm = '' }) {
    const localeSettings = useLocaleSettings();

    // Propietats visibles (respecta la vista, com la galeria): la vista principal
    // mostra tots els camps; una vista personalitzada, els seus `visibleProperties`.
    // Cridem `isMainView` SENSE llista de vistes (cas degenerat): amb
    // `[activeView]` el fallback per ordre la considerava SEMPRE principal i
    // s'ignoraven els visibleProperties de les vistes custom.
    const visibleProperties = isMainView(activeView)
        ? getSchemaFieldNames(schema)
        : (activeView?.visibleProperties || getSchemaFieldNames(schema));
    // S'exclou `title` (per tipus I per clau): el títol ja és l'encapçalament de
    // la targeta; si `visibleProperties` inclou "title" sortia duplicat com a
    // propietat "TITLE" al cos.
    const dynamicColumns = visibleProperties
        .map(prop => [prop, getFieldType(schema, prop)])
        .filter(([key, type]) => type && type !== 'title' && String(key).toLowerCase() !== 'title');

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
                return <span className="tabular-nums text-[var(--text-secondary)]">{formatNumber(value, { kind: fmt.kind, decimals: fmt.decimals, currencyCode: fmt.currencyCode, locale: fmt.numberLocale })}</span>;
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
                    <div className="flex flex-wrap gap-1.5">
                        {items.map((it, idx) => (
                            <span key={idx} className="px-2 py-0.5 rounded text-xs font-medium bg-indigo-500/10 text-indigo-400">
                                {displayMap[it] || (it.length > 20 ? it.substring(0, 8) + '…' : it)}
                            </span>
                        ))}
                    </div>
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
                        <LinkIcon size={14} /> Obrir Zotero
                    </button>
                );
            default:
                return <span className="text-sm text-[var(--text-primary)]">{value}</span>;
        }
    };

    // Filtres, ordre i cerca de la vista (mateix motor que taula/galeria). Abans
    // el feed ignorava `activeView` i ordenava sempre per última modificació.
    const viewConfig = {
        filters: activeView?.filters || [],
        sorts: activeView?.sort || { field: 'last_modified', direction: 'desc' },
        search: searchTerm,
    };
    const { sortedPages: sortedNotes } = useVaultViewData({ pages: notes, schema, view: viewConfig, searchTerm });

    const { selectedIds, isSelected, toggleSelect, selectAll, clearSelection } = useVaultSelection(sortedNotes);

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
                <p>No hi ha publicacions al feed.</p>
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
            <div className="w-full max-w-2xl flex flex-col gap-8 pb-16">

                {sortedNotes.map(note => {
                    const hasCover = !!note.metadata?.cover;

                    return (
                        <div
                            key={note.id}
                            onClick={() => { if (selectedIds.size > 0) toggleSelect(note.id, {}); else onNoteSelect(note.id); }}
                            className={`relative bg-[var(--bg-primary)] rounded-2xl shadow-sm border overflow-hidden hover:shadow-md transition-all cursor-pointer group flex flex-col ${isSelected(note.id) ? 'border-[var(--gnosi-primary)] ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)] hover:border-[var(--gnosi-primary)]/50'}`}
                        >
                            <label
                                className={`absolute top-3 left-3 z-20 cursor-pointer ${isSelected(note.id) || selectedIds.size > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                                onClick={(e) => { e.stopPropagation(); toggleSelect(note.id, e); }}
                            >
                                <input
                                    type="checkbox"
                                    checked={isSelected(note.id)}
                                    onChange={(e) => toggleSelect(note.id, e)}
                                    className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer bg-[var(--bg-secondary)]/90 shadow-sm"
                                />
                            </label>
                            {/* Feed Item Header / Cover: només si el registre TÉ portada.
                                Abans es reservaven 192-256px de degradat buit per a cada
                                targeta sense cover i cada entrada ocupava ~550px: dins d'una
                                vista incrustada (caixa de 70vh) mai es veia més d'un registre. */}
                            {hasCover && (
                                <div className="w-full h-48 sm:h-64 relative bg-[var(--bg-tertiary)] flex-shrink-0">
                                    <div
                                        className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-105"
                                        style={{ backgroundImage: `url("${note.metadata.cover}")` }}
                                    />
                                </div>
                            )}

                            {/* Feed Item Body */}
                            <div className="p-6 relative bg-[var(--bg-primary)]">
                                {/* Icona: solapada sobre la portada si n'hi ha; en línia si no */}
                                {hasCover && (
                                    <div className="absolute -top-8 left-6 w-16 h-16 bg-[var(--bg-secondary)] rounded-xl shadow-sm border border-[var(--border-primary)] flex items-center justify-center text-3xl z-10 transition-transform group-hover:scale-110 overflow-hidden">
                                        {note.metadata?.icon
                                            ? <IconRenderer icon={note.metadata.icon} size={32} />
                                            : <FileText size={24} className="text-[var(--text-tertiary)]" />}
                                    </div>
                                )}

                                <div className={`${hasCover ? 'mt-8' : ''} flex flex-col gap-4`}>
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
                                                {note.title || "Sense Títol"}
                                            </h2>
                                            <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-tertiary)]">
                                                <Clock size={12} />
                                                <span>
                                                    Actualitzat el {new Date(note.last_modified).toLocaleDateString('ca-ES', {
                                                        day: 'numeric', month: 'long', year: 'numeric',
                                                        hour: '2-digit', minute: '2-digit'
                                                    })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Properties Grid: només si hi ha algun valor a pintar
                                        (si no, el separador + parrilla buida deixaven una
                                        franja morta a cada targeta) */}
                                    {(() => {
                                        const aliasMap = {
                                            "date added": "created_time",
                                            "date modified": "last_edited_time"
                                        };
                                        const normalizeKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/gi, '');
                                        const entries = dynamicColumns.map(([key, type]) => {
                                            const schemaKeyNorm = normalizeKey(key);
                                            const targetKeyNorm = aliasMap[schemaKeyNorm] ? normalizeKey(aliasMap[schemaKeyNorm]) : schemaKeyNorm;
                                            const originalMetaKey = note.metadata ? (Object.keys(note.metadata).find(k => normalizeKey(k) === targetKeyNorm) || key) : key;
                                            const val = note.metadata?.[originalMetaKey];
                                            const renderedVal = renderPropertyValue(val, type, key);
                                            return renderedVal ? { key, renderedVal } : null;
                                        }).filter(Boolean);
                                        if (entries.length === 0) return null;
                                        return (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 mt-2 pt-4 border-t border-[var(--border-primary)]">
                                                {entries.map(({ key, renderedVal }) => (
                                                    <div key={key} className="flex flex-col gap-1">
                                                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
                                                            {key}
                                                        </span>
                                                        <div>
                                                            {renderedVal}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}

                                    {/* Action footer: superposat (absolute) perquè no reservi
                                        ~50px buits per targeta quan no es fa hover */}
                                    <div className="absolute bottom-2 right-4 pointer-events-none">
                                        <span className="text-sm font-semibold text-[var(--gnosi-primary)] opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 bg-[var(--bg-primary)]/80 rounded px-1">
                                            Llegir sencer &rarr;
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
