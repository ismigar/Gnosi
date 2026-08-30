import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeDocumentEvent } from '../../../shared/platform/browser-events';
import { optionChipStyle } from '../optionCatalogUtils';
import { CellDropdownPortal } from './CellDropdownPortal';
import { isOutsidePicker, type InlineSelectPickerProps } from './pickerTypes';

// Inline single-value picker for select/status cells in the table.
// Replaces the native <select> to allow searching, creating, and deleting options
// (Notion style). Keyboard-navigable (↑↓/Enter/Esc) sharing a single
// highlightedIndex with hover — see the canonical pattern in MultiSelectPills.
export const InlineSelectPicker = ({
  value = '',
  options = [],
  idToTitle = {},
  optionColors = {},
  onSave,
  onCreate,
  onDeleteOption,
}: InlineSelectPickerProps) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isOutsidePicker(containerRef.current, e.target)) {
        onSave(value); // closes without changing (handleCellSave does an early return if it's the same)
      }
    };
    return subscribeDocumentEvent('mousedown', handleClickOutside);
  }, [value, onSave]);

  const filtered = options.filter(opt =>
    (idToTitle[opt] ?? opt).toLowerCase().includes(search.toLowerCase())
  );
  const term = search.trim();
  const canCreate = Boolean(term && onCreate && !options.includes(term));
  const totalItems = filtered.length + (canCreate ? 1 : 0);

  // The highlight reset when the search changes happens in the input's onChange
  // (not in an effect) to avoid a cascading render.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${String(highlightedIndex)}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalItems > 0) setHighlightedIndex(i => Math.min(i + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = filtered[highlightedIndex];
      if (selected !== undefined) onSave(selected);
      else if (canCreate) onCreate?.(term);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onSave(value);
    }
  };

  return (
    <div ref={containerRef} className="w-full">
      <input
        autoFocus
        className="w-full px-2 py-0.5 text-xs border border-[var(--border-primary)] rounded bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
        placeholder={onCreate ? t('table.search_or_create_placeholder', "Search or create…") : t('table.search_placeholder', "Search…")}
        value={search}
        onChange={e => { setSearch(e.target.value); setHighlightedIndex(0); }}
        onKeyDown={handleKeyDown}
      />
      <CellDropdownPortal ref={listRef} anchorRef={containerRef} maxHeight={160}>
        {filtered.map((opt, idx) => {
          const isHighlighted = idx === highlightedIndex;
          return (
            <div
              key={opt}
              data-idx={idx}
              onMouseEnter={() => { setHighlightedIndex(idx); }}
              onMouseDown={e => { e.preventDefault(); onSave(opt); }}
              className={`flex items-center justify-between gap-2 px-2 py-1 text-xs cursor-pointer group ${isHighlighted ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]' : 'text-[var(--text-secondary)]'} ${value === opt ? 'font-semibold' : ''}`}
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
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onDeleteOption(opt); }}
                  className="shrink-0 p-0.5 rounded text-[var(--text-tertiary)]/50 opacity-0 group-hover:opacity-100 hover:text-[var(--status-error)] transition-colors"
                >
                  <Trash2 size={12} />
                </span>
              )}
            </div>
          );
        })}
        {canCreate && (
          <div
            data-idx={filtered.length}
            onMouseEnter={() => { setHighlightedIndex(filtered.length); }}
            onMouseDown={e => { e.preventDefault(); onCreate?.(term); }}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--gnosi-primary)] cursor-pointer ${highlightedIndex === filtered.length ? 'bg-[var(--gnosi-primary)]/10' : ''}`}
          >
            <Plus size={12} /> {t('table.create_option', "Create \"{{term}}\"", { term })}
          </div>
        )}
        {filtered.length === 0 && !canCreate && (
          <div className="px-2 py-1 text-xs text-[var(--text-tertiary)]/60 italic">{t('table.no_options', "No options")}</div>
        )}
      </CellDropdownPortal>
    </div>
  );
};
