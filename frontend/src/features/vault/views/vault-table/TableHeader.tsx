import { ArrowDown, ArrowUp, Calendar, CheckSquare, Tag, Type } from 'lucide-react';
import { getTableFieldConfig } from './fieldConfig';
import { SortableColumnTh } from './SortableColumnTh';
import type { TableController } from './useTableController';

export function TableHeader({ model }: { model: TableController; }) {
  const {
    selectedIds,
    sortedNotes,
    selectAll,
    clearSelection,
    t,
    schema,
    openHeaderHelp,
    columnWidths,
    handleSort,
    setOpenHeaderHelp,
    activeSort,
    handleMouseDown,
    dynamicColumns,
    canReorderColumns,
    columnDragJustEndedRef,
    showModifiedColumn,
  } = model;
  return (<thead className="bg-[var(--bg-primary)] text-[var(--text-secondary)] font-semibold select-none group/table sticky top-0 z-40">
    <tr>
      <th className="w-10 px-2 sticky left-0 bg-[var(--bg-primary)] z-40 border-r border-[var(--border-primary)]">
        <div className="flex items-center justify-center">
          <label className="cursor-pointer inline-flex items-center" onClick={(e) => { e.stopPropagation(); }}>
            <input
              type="checkbox"
              checked={selectedIds.size === sortedNotes.length && sortedNotes.length > 0}
              ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < sortedNotes.length; }}
              onChange={(e) => {
                if (e.target.checked) selectAll(sortedNotes.map(n => n.id));
                else clearSelection();
              }}
              className="w-3.5 h-3.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] cursor-pointer"
            />
          </label>
        </div>
      </th>
      {(() => {
        const titleKey = Object.entries(schema).find(([, t]) => t === 'title')?.[0] || 'title';
        const titleDesc = getTableFieldConfig(schema, titleKey).description;
        const isTitleHelpOpen = !!openHeaderHelp[titleKey];
        return (
          <th
            style={{ width: columnWidths['title'] || 250 }}
            className="py-3 px-4 sticky left-10 bg-[var(--bg-secondary)] z-40 border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] hover:bg-[var(--bg-tertiary)] transition-colors group relative"
          >
            <div className="flex items-center justify-between cursor-pointer overflow-hidden text-[var(--text-secondary)]" onClick={() => { handleSort('title'); }}>
              <div className="flex items-center gap-1.5 truncate">
                <span className="truncate">{titleKey === 'title' ? t('table.note_name') : titleKey}</span>
                {titleDesc && (
                  <button
                    type="button"
                    aria-expanded={isTitleHelpOpen}
                    aria-label={t('schema.toggle_description', 'Toggle field description')}
                    title={titleDesc}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenHeaderHelp((prev) => ({ ...prev, [titleKey]: !prev[titleKey] }));
                    }}
                    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold leading-none transition-colors ${isTitleHelpOpen
                        ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)] text-white'
                        : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)]'
                      }`}
                  >
                    ?
                  </button>
                )}
              </div>
              {activeSort.field === 'title' && (
                activeSort.direction === 'asc' ? <ArrowUp size={14} className="text-indigo-500 shrink-0" /> : <ArrowDown size={14} className="text-indigo-500 shrink-0" />
              )}
            </div>
            {isTitleHelpOpen && titleDesc && (
              <div
                className="absolute left-0 top-full z-[100] mt-1 w-64 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2.5 shadow-xl text-xs font-normal text-[var(--text-secondary)] normal-case whitespace-normal leading-relaxed animate-in fade-in zoom-in-95 duration-150 cursor-default"
                onClick={(e) => { e.stopPropagation(); }}
              >
                <div className="font-semibold text-[var(--text-primary)] mb-1 flex items-center justify-between">
                  <span>{titleKey}</span>
                  <button
                    type="button"
                    onClick={() => { setOpenHeaderHelp((prev) => ({ ...prev, [titleKey]: false })); }}
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs px-1"
                  >
                    ✕
                  </button>
                </div>
                <p>{titleDesc}</p>
              </div>
            )}
            <div
              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--gnosi-primary)]/40 opacity-0 group-hover/table:opacity-100 z-30 transition-opacity"
              onMouseDown={(e) => { handleMouseDown(e, 'title'); }}
            />
          </th>
        );
      })()}
      {dynamicColumns.map(([key, type]) => {
        const fieldCfg = getTableFieldConfig(schema, key);
        const desc = fieldCfg.description;
        const isHelpOpen = !!openHeaderHelp[key];
        return (
          <SortableColumnTh
            key={key}
            id={key}
            disabled={!canReorderColumns}
            width={columnWidths[key] || 180}
            className="py-3 px-4 hover:bg-[var(--bg-tertiary)] transition-colors group relative border-r border-[var(--border-primary)]"
            handleClassName={`flex items-center gap-1.5 justify-between overflow-hidden text-[var(--text-secondary)] ${canReorderColumns ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
            onHeaderClick={() => {
              if (columnDragJustEndedRef.current) return;
              handleSort(key);
            }}
            resizeHandle={
              <div
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--gnosi-primary)]/40 opacity-0 group-hover/table:opacity-100 z-30 transition-opacity"
                onMouseDown={(e) => { handleMouseDown(e, key); }}
              />
            }
          >
            <div className="flex items-center gap-1.5 truncate">
              {type === 'checkbox' && <CheckSquare size={14} className="text-[var(--text-tertiary)] shrink-0" />}
              {type === 'date' && <Calendar size={14} className="text-[var(--text-tertiary)] shrink-0" />}
              {(type === 'status' || type === 'select') && <Type size={14} className="text-[var(--text-tertiary)] shrink-0" />}
              {(type === 'multi_select' || type === 'relation') && <Tag size={14} className="text-[var(--text-tertiary)] shrink-0" />}
              <span className="truncate">{key}</span>
              {desc && (
                <button
                  type="button"
                  aria-expanded={isHelpOpen}
                  aria-label={t('schema.toggle_description', 'Toggle field description')}
                  title={desc}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenHeaderHelp((prev) => ({ ...prev, [key]: !prev[key] }));
                  }}
                  className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold leading-none transition-colors ${isHelpOpen
                      ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)] text-white'
                      : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)]'
                    }`}
                >
                  ?
                </button>
              )}
            </div>
            {activeSort.field === key && (
              activeSort.direction === 'asc' ? <ArrowUp size={14} className="text-indigo-500 shrink-0" /> : <ArrowDown size={14} className="text-indigo-500 shrink-0" />
            )}
            {isHelpOpen && desc && (
              <div
                className="absolute left-0 top-full z-[100] mt-1 w-64 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2.5 shadow-xl text-xs font-normal text-[var(--text-secondary)] normal-case whitespace-normal leading-relaxed animate-in fade-in zoom-in-95 duration-150 cursor-default"
                onClick={(e) => { e.stopPropagation(); }}
              >
                <div className="font-semibold text-[var(--text-primary)] mb-1 flex items-center justify-between">
                  <span>{key}</span>
                  <button
                    type="button"
                    onClick={() => { setOpenHeaderHelp((prev) => ({ ...prev, [key]: false })); }}
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs px-1"
                  >
                    ✕
                  </button>
                </div>
                <p>{desc}</p>
              </div>
            )}
          </SortableColumnTh>
        );
      })}
      {showModifiedColumn && (
        <th
          style={{ width: columnWidths['last_modified'] || 150 }}
          className="py-3 px-4 hover:bg-[var(--bg-tertiary)] transition-colors group relative border-l border-[var(--border-primary)] text-[var(--text-secondary)]"
        >
          <div className="flex items-center justify-between cursor-pointer overflow-hidden" onClick={() => { handleSort('last_modified'); }}>
            <span className="truncate">{t('table.modification')}</span>
            {activeSort.field === 'last_modified' && (
              activeSort.direction === 'asc' ? <ArrowUp size={14} className="text-indigo-500 shrink-0" /> : <ArrowDown size={14} className="text-indigo-500 shrink-0" />
            )}
          </div>
          <div
            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-[var(--gnosi-primary)]/40 opacity-0 group-hover/table:opacity-100 z-30 transition-opacity"
            onMouseDown={(e) => { handleMouseDown(e, 'last_modified'); }}
          />
        </th>
      )}
    </tr>
  </thead>);
}
