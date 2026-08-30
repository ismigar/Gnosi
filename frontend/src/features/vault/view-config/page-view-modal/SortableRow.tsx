import { GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ReactNode, CSSProperties } from 'react';

export function SortableRow({ id, className = '', gripSize = 14, children }: { id: string; className?: string; gripSize?: number; children: ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const style: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.9 : 1,
        zIndex: isDragging ? 50 : 1,
        position: 'relative',
    };
    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`${className} ${isDragging ? 'bg-[var(--bg-tertiary)] shadow-md ring-1 ring-[var(--gnosi-primary)]/30' : ''}`}
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing p-1 rounded text-[var(--text-tertiary)]/40 hover:text-[var(--gnosi-primary)]"
            >
                <GripVertical size={gripSize} />
            </div>
            {children}
        </div>
    );
}
