import { Columns2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { DocumentTab } from './vaultDocumentTabsModel';


export interface SortableDocumentTabProps {
    readonly canSplit: boolean;
    readonly isActive: boolean;
    readonly isSplit: boolean;
    readonly onTabClose: (tabId: string) => void;
    readonly onTabSelect: (tabId: string) => void;
    readonly onToggleSplit: (tabId: string) => void;
    readonly tab: DocumentTab;
}


function tabClassName(isActive: boolean, isSplit: boolean): string {
    const base = 'group flex w-[184px] flex-shrink-0 cursor-pointer select-none items-center gap-2 rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ';
    if (isActive) {
        return `${base}border-[var(--gnosi-blue)] bg-[var(--bg-primary)] text-[var(--gnosi-blue)] shadow-sm`;
    }
    if (isSplit) return `${base}border-purple-400 bg-purple-50/10 text-purple-700`;
    return `${base}border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]`;
}


export function SortableDocumentTab({
    canSplit,
    isActive,
    isSplit,
    onTabClose,
    onTabSelect,
    onToggleSplit,
    tab,
}: SortableDocumentTabProps) {
    const { t } = useTranslation();
    const {
        attributes,
        isDragging,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: tab.id });
    const title = tab.title || t('common.untitled', 'Untitled');
    return <div
        {...attributes}
        {...listeners}
        className={tabClassName(isActive, isSplit)}
        onClick={() => { onTabSelect(tab.id); }}
        ref={setNodeRef}
        style={{
            opacity: isDragging ? 0.5 : 1,
            transform: CSS.Transform.toString(transform),
            transition,
            zIndex: isDragging ? 100 : 1,
        }}
        title={title}
    >
        <span className="min-w-0 flex-1 truncate" title={title}>{title}</span>
        <div className="ml-1 flex items-center">
            {!isActive && canSplit ? <button
                className={`rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 ${isSplit ? 'bg-purple-100/20 text-purple-600' : 'text-[var(--text-tertiary)] hover:bg-indigo-50/20 hover:text-indigo-600'}`}
                onClick={(event) => {
                    event.stopPropagation();
                    onToggleSplit(tab.id);
                }}
                title={isSplit
                    ? t('doc_tabs.remove_parallel', 'Remove from parallel view')
                    : t('sidebar.open_parallel', 'Open in parallel')}
                type="button"
            >
                <Columns2 size={14} />
            </button> : null}
            <button
                className="rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-red-50/10 hover:text-red-500"
                onClick={(event) => {
                    event.stopPropagation();
                    onTabClose(tab.id);
                }}
                title={t('doc_tabs.close_tab', 'Close tab')}
                type="button"
            >
                <X size={14} />
            </button>
        </div>
    </div>;
}
