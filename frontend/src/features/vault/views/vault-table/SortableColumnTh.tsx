import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { useColumnHeaderActions } from './useColumnHeaderActions';
import type { CSSProperties, ReactNode } from 'react';

interface SortableColumnThProps {
  readonly id: string;
  readonly ariaSort?: 'ascending' | 'descending' | 'none';
  readonly disabled: boolean;
  readonly width: CSSProperties['width'];
  readonly className: string;
  readonly handleClassName: string;
  readonly headerProps: ReturnType<ReturnType<typeof useColumnHeaderActions>>;
  readonly dragLabel: string;
  readonly resizeHandle: ReactNode;
  readonly children: ReactNode;
}

// Sortable data-column header (dnd-kit, same pattern as VaultDocumentTabs).
// Only the dedicated grip starts dragging; the label owns sorting and selection.
// The grip is separate from the resize handle: the resize handle
// (a sibling passed via `resizeHandle`) never starts a column reorder. When
// `disabled` (canReorderColumns false) no listeners/attributes are attached, so
// the header behaves as a plain click-to-sort cell.
export function SortableColumnTh({
  id,
  ariaSort,
  disabled,
  width,
  className,
  handleClassName,
  headerProps,
  dragLabel,
  resizeHandle,
  children,
}: SortableColumnThProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  // z-index while dragging: above sibling headers but below the sticky
  // checkbox/title columns (z-40), which must keep covering it.
  return (
    <th
      ref={setNodeRef}
      aria-sort={ariaSort}
      style={{
        width,
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={`${className} ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-1">
        {!disabled && <button type="button" {...attributes} {...listeners} aria-label={dragLabel}
          onClick={event => { event.stopPropagation(); }}
          className="shrink-0 cursor-grab text-[var(--text-tertiary)] hover:text-[var(--text-primary)] active:cursor-grabbing">
          <GripVertical size={12} />
        </button>}
        <div {...headerProps} className={handleClassName}>{children}</div>
      </div>
      {resizeHandle}
    </th>
  );
}
