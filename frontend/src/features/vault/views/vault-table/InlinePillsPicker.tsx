import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeDocumentEvent } from '../../../../shared/platform/browser-events';
import { RelationItem } from '../../properties/RelationItem';
import { optionChipStyle } from '../../../../shared/records/model/optionCatalogUtils';
import { CellDropdownPortal } from './CellDropdownPortal';
import { isOutsidePicker, type InlinePillsPickerProps } from './pickerTypes';

export const InlinePillsPicker = ({
  value = [],
  options = [],
  idToTitle = {},
  optionColors = {},
  onSave,
  onCreate,
  onDeleteOption,
  relationItems = false,
  onOpenRelation,
  onRemoveRelation,
}: InlinePillsPickerProps) => {
  const { t } = useTranslation();
  const [localValues, setLocalValues] = useState(value);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // The dropdown lives in a portal (outside containerRef): it doesn't
      // count it as "outside".
      if (isOutsidePicker(containerRef.current, e.target)) {
        onSave(localValues);
      }
    };
    return subscribeDocumentEvent('mousedown', handleClickOutside);
  }, [localValues, onSave]);

  const toggle = (val: string) => {
    setLocalValues(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  };

  const filtered = options.filter(opt =>
    (idToTitle[opt] ?? opt).toLowerCase().includes(search.toLowerCase()) &&
    !localValues.includes(opt)
  );
  const term = search.trim();
  const canCreate = Boolean(term && onCreate && !options.includes(term));

  const handleCreate = () => {
    if (!canCreate || !onCreate) return;
    onCreate(term);              // persists the option to the schema
    setLocalValues(prev => [...prev, term]); // and selects it in this record
    setSearch('');
  };

  const handleDelete = (val: string) => {
    if (!onDeleteOption) return;
    onDeleteOption(val);         // removes the option from the field's catalog
    setLocalValues(prev => prev.filter(v => v !== val)); // and of this record
  };

  return (
    <div ref={containerRef} className="w-full">
      <div className="flex flex-wrap gap-1 mb-1 min-h-[20px]">
        {localValues.map(val => relationItems ? (
          <RelationItem
            key={val}
            relationId={val}
            title={idToTitle[val] || val}
            onOpen={onOpenRelation}
            onRemove={onRemoveRelation ? async () => {
              const removed = await onRemoveRelation(val);
              if (removed !== false) {
                setLocalValues(prev => prev.filter(item => item !== val));
              }
            } : undefined}
          />
        ) : (
          <span key={val} className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] border border-[var(--gnosi-primary)]/20 whitespace-nowrap">
            {idToTitle[val] || (val.length > 16 ? val.substring(0, 8) + '…' : val)}
            <X size={9} className="cursor-pointer hover:text-red-500 shrink-0" onMouseDown={e => { e.preventDefault(); toggle(val); }} />
          </span>
        ))}
      </div>
      <input
        autoFocus
        className="w-full px-2 py-0.5 text-xs border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
        placeholder={onCreate ? t('table.search_or_create_placeholder', "Search or create…") : t('table.search_placeholder', "Search…")}
        value={search}
        onChange={e => { setSearch(e.target.value); }}
        onKeyDown={e => {
          if (e.key === 'Escape') onSave(localValues);
          if (e.key === 'Enter') { e.preventDefault(); handleCreate(); }
        }}
      />
      {(filtered.length > 0 || canCreate) && (
        <CellDropdownPortal anchorRef={containerRef} maxHeight={128}>
          {filtered.map(opt => (
            <div
              key={opt}
              className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--gnosi-primary)]/10 hover:text-[var(--gnosi-primary)] cursor-pointer group"
              onMouseDown={e => { e.preventDefault(); toggle(opt); }}
            >
              <span className="flex items-center gap-1.5 truncate">
                {optionColors[opt] && (
                  <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: optionChipStyle(optionColors[opt])?.color }} />
                )}
                {idToTitle[opt] || opt}
              </span>
              {onDeleteOption && (
                <span
                  role="button"
                  title={t('table.delete_option_tooltip', "Delete the field's option")}
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); handleDelete(opt); }}
                  className="shrink-0 p-0.5 rounded text-[var(--text-tertiary)]/50 opacity-0 group-hover:opacity-100 hover:text-[var(--status-error)] transition-colors"
                >
                  <Trash2 size={12} />
                </span>
              )}
            </div>
          ))}
          {canCreate && (
            <div
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 cursor-pointer"
              onMouseDown={e => { e.preventDefault(); handleCreate(); }}
            >
              <Plus size={12} /> {t('table.create_option', "Create \"{{term}}\"", { term })}
            </div>
          )}
        </CellDropdownPortal>
      )}
    </div>
  );
};
