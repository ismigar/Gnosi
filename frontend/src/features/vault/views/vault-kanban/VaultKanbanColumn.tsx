import type { DragEvent, ReactNode } from 'react';

import { EMPTY_KANBAN_BUCKET, type KanbanColumnModel } from './vaultKanbanModel';


export interface VaultKanbanColumnProps {
    readonly canDrag: boolean;
    readonly column: KanbanColumnModel;
    readonly dragOverStatus: string | null;
    readonly emptyGroupLabel: string;
    readonly noRecordsLabel: string;
    readonly onDragOverStatus: (status: string | null) => void;
    readonly onDrop: (event: DragEvent<HTMLDivElement>, status: string) => void;
    readonly renderCards: () => ReactNode;
}


export function VaultKanbanColumn({
    canDrag,
    column,
    dragOverStatus,
    emptyGroupLabel,
    noRecordsLabel,
    onDragOverStatus,
    onDrop,
    renderCards,
}: VaultKanbanColumnProps) {
    const { color, label, notes, status } = column;
    return <div
        className={`flex w-80 flex-col rounded-xl border bg-[var(--bg-tertiary)]/50 p-3 shadow-sm transition-colors ${dragOverStatus === status ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/5 ring-2 ring-[var(--gnosi-primary)]/20' : 'border-[var(--border-primary)]'}`}
        onDragLeave={canDrag ? (event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                onDragOverStatus(dragOverStatus === status ? null : dragOverStatus);
            }
        } : undefined}
        onDragOver={canDrag ? (event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (dragOverStatus !== status) onDragOverStatus(status);
        } : undefined}
        onDrop={canDrag ? (event) => { onDrop(event, status); } : undefined}
    >
        <div className="mb-4 flex items-center justify-between px-1">
            <h3 className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] shadow-sm">
                {color ? <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                /> : null}
                {status === EMPTY_KANBAN_BUCKET ? emptyGroupLabel : label}
            </h3>
            <span className="rounded-md border border-[var(--border-primary)]/50 bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-tertiary)]">
                {String(notes.length)}
            </span>
        </div>
        <div className="flex flex-col gap-3">
            {renderCards()}
            {notes.length === 0 ? <div className="rounded-xl border-2 border-dashed border-[var(--border-primary)]/50 bg-[var(--bg-secondary)]/30 py-8 text-center text-[10px] text-[var(--text-tertiary)]">
                {noRecordsLabel}
            </div> : null}
        </div>
    </div>;
}
