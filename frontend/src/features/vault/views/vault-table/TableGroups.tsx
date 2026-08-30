import type { VirtualItem } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type React from 'react';
import type { RowDescriptor } from './types';
import type { TableController } from './useTableController';

export function createGroupRenderers(model: TableController) {
  const {
    focusGroupHeaderByOffset,
    onExitTopRef,
    expandedGroups,
    toggleGroup,
    pendingEnterGroupDescRef,
    focusFirstRowOfGroup,
    rowVirtualizer,
    dynamicColumns,
    t,
    aggregations,
    calculateAggregation,
    showModifiedColumn,
  } = model;
  const handleGroupHeaderKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, d: Extract<RowDescriptor, { kind: 'group-header'; }> & { descriptorIndex: number; }) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault(); e.stopPropagation();
        if (!focusGroupHeaderByOffset(d.descriptorIndex, -1)) {
          onExitTopRef.current?.();
        }
        break;
      case 'ArrowDown':
        e.preventDefault(); e.stopPropagation();
        focusGroupHeaderByOffset(d.descriptorIndex, 1);
        break;
      case 'ArrowRight':
      case 'Enter': {
        e.preventDefault(); e.stopPropagation();
        const wasCollapsed = !expandedGroups.has(d.groupKey);
        toggleGroup(d.groupKey);
        if (wasCollapsed) {
          pendingEnterGroupDescRef.current = d.descriptorIndex;
        } else {
          focusFirstRowOfGroup(d.descriptorIndex);
        }
        break;
      }
      case 'Escape':
        e.preventDefault(); e.stopPropagation();
        e.currentTarget.blur();
        break;
      default: break;
    }
  };
  const renderGroupHeader = (d: Extract<RowDescriptor, { kind: 'group-header'; }>, virtualItem: VirtualItem) => {
    const collapsed = !expandedGroups.has(d.groupKey);
    return (
      <tr
        key={`group-${d.groupKey}-${String(virtualItem.index)}`}
        data-index={virtualItem.index}
        ref={rowVirtualizer.measureElement}
        className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)]"
      >
        <td colSpan={dynamicColumns.length + 3} className="p-0 bg-[var(--bg-primary)]">
          <div className="sticky left-0 z-10 inline-flex items-center w-max max-w-[calc(100vw-2rem)]">
            <button
              type="button"
              tabIndex={0}
              onClick={() => { toggleGroup(d.groupKey); }}
              onKeyDown={(e) => { handleGroupHeaderKeyDown(e, { ...d, descriptorIndex: virtualItem.index }); }}
              className="flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors w-full outline-none focus-visible:ring-1 focus-visible:ring-[var(--gnosi-primary)]"
              title={collapsed ? t('common.expand', "Expand") : t('common.collapse', "Collapse")}
            >
              {collapsed
                ? <ChevronRight size={15} className="text-[var(--text-tertiary)] shrink-0" />
                : <ChevronDown size={15} className="text-[var(--text-tertiary)] shrink-0" />}
              {d.colorHex && <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.colorHex }} />}
              <span className="text-xs font-bold text-[var(--text-primary)] truncate">{d.label}</span>
              <span className="text-[10px] font-semibold text-[var(--text-tertiary)] bg-[var(--bg-primary)] px-1.5 py-0.5 rounded-full border border-[var(--border-primary)]/60 shrink-0">{d.count}</span>
            </button>
          </div>
        </td>
      </tr>
    );
  };
  const renderGroupFooter = (d: Extract<RowDescriptor, { kind: 'group-footer'; }>, virtualItem: VirtualItem) => {
    const aggCell = (field: string, type: string) => {
      const func = aggregations[field];
      if (!func || func === 'none') return null;
      const val = calculateAggregation(field, type, d.notes);
      return (
        <span className="inline-flex items-center gap-1">
          <span className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">{t(`table.${func}`, func)}</span>
          <span className="text-[var(--text-primary)] font-bold">{val}</span>
        </span>
      );
    };
    return (
      <tr
        key={`gfoot-${d.groupKey}-${String(virtualItem.index)}`}
        data-index={virtualItem.index}
        ref={rowVirtualizer.measureElement}
        className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)] text-[11px] text-[var(--text-secondary)]"
      >
        <td className="w-10 sticky left-0 bg-[var(--bg-secondary)] z-20 border-r border-[var(--border-primary)]"></td>
        <td className="py-1.5 px-4 sticky left-10 bg-[var(--bg-secondary)] z-20 border-r border-[var(--border-primary)] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.02)]">
          {aggCell('title', 'title')}
        </td>
        {dynamicColumns.map(([key, type]) => (
          <td key={key} className="py-1.5 px-4 border-r border-[var(--border-primary)]">
            {aggCell(key, type)}
          </td>
        ))}
        {showModifiedColumn && (
          <td className="py-1.5 px-4 border-l border-[var(--border-primary)]">
            {aggCell('last_modified', 'date')}
          </td>
        )}
      </tr>
    );
  };
  return { renderGroupHeader, renderGroupFooter };
}
