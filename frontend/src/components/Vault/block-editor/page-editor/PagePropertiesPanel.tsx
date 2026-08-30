import { inputValue } from './valueBoundaries';
import { ChevronDown } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { PdfAnnotationsToCite } from '../../PdfAnnotationsToCite';
import { Plus } from 'lucide-react';
import React from 'react';
import { SchemaPropertyRow } from './SchemaPropertyRow';
import { Search } from 'lucide-react';
import { Settings } from 'lucide-react';
import { Trash2 } from 'lucide-react';
import { X } from 'lucide-react';
import { ZoteroExtrasSection } from '../../ZoteroExtrasSection';
import type { PageEditorController } from './usePageEditorController';
export function PagePropertiesPanel({ context }: { context: PageEditorController }) {
  const { propertiesPanelRef, propertiesHeaderRef, setIsPropertiesOpen, handlePropertiesHeaderKeyDown, t, properties, adhocProperties, isEditable, isReferenceRecord, setIsMetadataLookupOpen, isPropertiesOpen, activeProp, setActiveProp, isEditor, metadata, handleMetaChange, handleRemoveProperty, zoteroExtras, currentTableId, pdfSourceUri, pdfCitationKey, currentTable, isAddingProp, setIsAddingProp, newPropName, setNewPropName, handleAddAdhocProperty, onEditSchema } = context;
  return (<div ref={propertiesPanelRef} className="rounded-xl border border-[var(--border-primary)] focus-within:border-[var(--gnosi-primary)]/50 focus-within:ring-1 focus-within:ring-[var(--gnosi-primary)]/30 bg-[var(--bg-secondary)]/40 overflow-hidden transition-all">
    <div className="w-full h-[var(--control-height-touch)] flex items-center justify-between gap-3 px-3 hover:bg-[var(--bg-secondary)]/60 transition-colors">
      <button
        ref={propertiesHeaderRef}
        tabIndex={0}
        type="button"
        onClick={() => { setIsPropertiesOpen((prev) => !prev); }}
        onKeyDown={handlePropertiesHeaderKeyDown}
        className="flex-1 flex items-center gap-2 min-w-0 text-left focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]/40 rounded px-1.5 py-0.5 transition-all"
      >
        <Settings size={14} className="text-[var(--text-secondary)]/80" />
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]/85">
          {t('common.properties')}
        </div>
        <div className="vault-page-summary-meta text-[11px] truncate">
          {t('common.schema')} {properties.length} · {t('common.local')} {adhocProperties.length}
        </div>
        <div className="vault-page-summary-badges" aria-hidden="true">
          {properties.length > 0 && <span>{t('common.schema')} {properties.length}</span>}
          {adhocProperties.length > 0 && <span>{t('common.local')} {adhocProperties.length}</span>}
          {properties.length === 0 && adhocProperties.length === 0 && <span>0</span>}
        </div>
      </button>
      {/* Enrichment button by identifier (DOI/ISBN/arXiv/URL).
                                        Only on bibliographic sources (records of the designated
                                        references table), not on all Vault pages. */}
      {isEditable && isReferenceRecord && (
        <button
          type="button"
          onClick={() => { setIsMetadataLookupOpen(true); }}
          className="text-[11px] px-2 py-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--gnosi-primary)] transition-colors shrink-0 flex items-center gap-1"
          title={t('metadata_lookup.button_title', { defaultValue: "Fill metadata from DOI/ISBN/arXiv/URL" })}
        >
          <Search size={12} />
          {t('metadata_lookup.button', { defaultValue: "Fill" })}
        </button>
      )}
      <button
        type="button"
        onClick={() => { setIsPropertiesOpen((prev) => !prev); }}
        className="vault-summary-chevron shrink-0"
        title={t('editor.toggle_properties')}
        aria-label={t('editor.toggle_properties')}
        aria-expanded={isPropertiesOpen}
      >
        {isPropertiesOpen ? (
          <ChevronDown size={14} className="text-[var(--text-tertiary)]/80" />
        ) : (
          <ChevronRight size={14} className="text-[var(--text-tertiary)]/80" />
        )}
      </button>
    </div>
    {isPropertiesOpen && (
      <div className="p-3 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]/35">
        <div className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-0.5 items-center">
          {properties.map((prop) => <SchemaPropertyRow key={prop.name} prop={prop} context={context} />)}

          {adhocProperties.map(key => (
            <React.Fragment key={key}>
              <div
                role="button"
                tabIndex={0}
                data-prop-row={key}
                aria-pressed={activeProp === key}
                onClick={() => { setActiveProp(key); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveProp(key); } }}
                title={t('editor.property_select_hint', { defaultValue: "Select the property (↑↓ navigate · ⌘C/⌘V copy/paste)" })}
                className={`flex items-center gap-1.5 group py-1 h-8 cursor-pointer rounded-md focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]/40 ${activeProp === key ? 'bg-[var(--gnosi-primary)]/10 ring-1 ring-[var(--gnosi-primary)]/40' : ''}`}
              >
                <div className="p-1.5 rounded-md bg-[var(--bg-secondary)] text-[var(--gnosi-primary)]/40 group-hover:bg-[var(--gnosi-primary)]/10 transition-colors border border-[var(--gnosi-primary)]/10"><Settings size={14} /></div>
                <span className="text-sm text-[var(--text-secondary)] font-medium truncate italic">{key}</span>
              </div>
              <div className="flex items-center gap-1.5 group h-8">
                <input
                  disabled={!isEditor}
                  type="text"
                  value={inputValue(metadata[key])}
                  onChange={e => { handleMetaChange(key, e.target.value); }}
                  placeholder={t('editor.empty_local')}
                  className="w-full bg-transparent border-none rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)] focus:bg-[var(--bg-secondary)] transition-all placeholder:[var(--text-tertiary)]/20 font-medium h-7 disabled:cursor-not-allowed"
                />
                {/* LOCAL field (ad-hoc): always removable from its row,
                                                    even if the page belongs to a collection — "Manage
                                                    Fields" only touches the schema, not these local keys. */}
                {isEditor && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); handleRemoveProperty(key); }} className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1.5 rounded text-[var(--text-tertiary)]/40 hover:text-[var(--status-error)] hover:bg-[var(--bg-secondary)] shrink-0" title={t('editor.remove_local_property')} aria-label={t('editor.remove_local_property')}><Trash2 size={14} /></button>
                )}
              </div>
            </React.Fragment>
          ))}

          {zoteroExtras && (
            <ZoteroExtrasSection
              extras={zoteroExtras}
              readOnly={!isEditor}
              onChange={(nextDict) => { handleMetaChange('Zotero Extras', nextDict); }}
              onRemoveAll={() => { handleRemoveProperty('Zotero Extras'); }}
              tableId={currentTableId}
              // Promoting migrates pages + adds a column to the schema. The open
              // editor doesn't re-sync `metadata` (local state, stable `key`),
              // so a full reload is the only faithful way to
              // reflect it — the same convention as `onRestore` in PageHistory.
              onPromoted={() => { window.location.reload(); }}
            />
          )}

          {/* PR #249 wired-up: PDF highlights → citation quotes. */}
          {pdfSourceUri && (
            <div className="col-span-2 mt-3">
              <PdfAnnotationsToCite
                sourceUri={pdfSourceUri}
                citationKey={pdfCitationKey}
                readOnly={!isEditor}
              />
            </div>
          )}

          <div className="col-span-2 flex gap-2.5 mt-1.5">
            {!currentTable && (!isAddingProp ? (
              <button
                onClick={() => { setIsAddingProp(true); }}
                className="btn btn-gnosi-primary flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold"
              >
                <Plus size={14} /> {t('editor.add_property')}
              </button>
            ) : (
              <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                <input
                  autoFocus
                  className="bg-[var(--bg-secondary)] border border-[var(--gnosi-primary)]/30 rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/20"
                  placeholder={t('editor.property_name_placeholder')}
                  value={newPropName}
                  onChange={e => { setNewPropName(e.target.value); }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddAdhocProperty(); }}
                  onBlur={() => { if (!newPropName) setIsAddingProp(false); }}
                />
                <button onClick={handleAddAdhocProperty} className="p-1.5 bg-[var(--gnosi-primary)] text-white rounded-lg hover:brightness-110 transition-all"><Plus size={16} /></button>
                <button onClick={() => { setIsAddingProp(false); setNewPropName(""); }} className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--status-error)] transition-all"><X size={16} /></button>
              </div>
            ))}
            {currentTable && isEditor && (
              <button onClick={() => { onEditSchema?.(currentTable); }} className="btn btn-gnosi-primary flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold">
                <Settings size={14} /> {t('editor.manage_fields')}
              </button>
            )}
          </div>
        </div>
      </div>
    )}
  </div>);
}
