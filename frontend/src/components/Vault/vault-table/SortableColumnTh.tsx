import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';

interface SortableColumnThProps {
  readonly id: string;
  readonly disabled: boolean;
  readonly width: CSSProperties['width'];
  readonly className: string;
  readonly handleClassName: string;
  readonly onHeaderClick: MouseEventHandler<HTMLDivElement>;
  readonly resizeHandle: ReactNode;
  readonly children: ReactNode;
}

// Sortable data-column header (dnd-kit, same pattern as VaultDocumentTabs).
// The drag handle is the inner label div, NOT the whole th: the resize handle
// (a sibling passed via `resizeHandle`) never starts a column reorder. When
// `disabled` (canReorderColumns false) no listeners/attributes are attached, so
// the header behaves as a plain click-to-sort cell.
export function SortableColumnTh({
  id,
  disabled,
  width,
  className,
  handleClassName,
  onHeaderClick,
  resizeHandle,
  children,
}: SortableColumnThProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  // z-index while dragging: above sibling headers but below the sticky
  // checkbox/title columns (z-40), which must keep covering it.
  return (
    <th
      ref={setNodeRef}
      style={{
        width,
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      className={`${className} ${isDragging ? 'opacity-40' : ''}`}
    >
      <div
        {...(disabled ? {} : { ...attributes, ...listeners })}
        className={handleClassName}
        onClick={onHeaderClick}
      >
        {children}
      </div>
      {resizeHandle}
    </th>
  );
}
