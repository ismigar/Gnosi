import {
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronRight, FileText, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconRenderer } from '../IconRenderer';
import type { SidebarPage } from './types';
interface NavItemProps { icon: LucideIcon; label: ReactNode; onClick?: () => void; isActive?: boolean; colorClass?: string; emoji?: string | null; rightElement?: ReactNode; indented?: boolean; }
interface FavoriteProps { page: SidebarPage; draggable: boolean; onPageSelect: (id: string) => unknown; }
interface SectionProps { label: string; isExpanded: boolean; onToggle: () => void; onAdd?: () => void; addLabel?: string; }
export const NavItem = ({ icon: Icon, label, onClick, isActive, colorClass = "text-[var(--text-secondary)]", emoji, rightElement, indented = false }: NavItemProps) => (
    <button
        onClick={onClick}
        className={`vault-sidebar__navigation-row group w-full flex items-center gap-2 ${indented ? 'vault-sidebar__navigation-row--tree-leaf' : 'px-3'} rounded-md transition-colors ${isActive ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
    >
        {emoji ? (
            <IconRenderer icon={emoji} size={16} />
        ) : (
            <Icon size={16} className={isActive ? 'text-gnosi' : colorClass} />
        )}
        <span className="truncate flex-1 text-left">{label}</span>
        {rightElement && <div>{rightElement}</div>}
    </button>
);

// A favorite row: the whole row is the drag handle (same pattern as the
// document tabs) — the PointerSensor distance constraint lets plain clicks
// through to select the page. Sorting is disabled outside 'manual' mode, and
// attributes/listeners are only spread while draggable so the row doesn't
// keep a phantom tab stop in the other sort modes.
export const SortableFavoriteItem = ({ page, draggable, onPageSelect }: FavoriteProps) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id, disabled: !draggable });
    return (
        <div
            ref={setNodeRef}
            data-vault-page-id={page.id}
            {...(draggable ? attributes : {})}
            {...(draggable ? listeners : {})}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                opacity: isDragging ? 0.4 : 1,
                zIndex: isDragging ? 50 : 1,
            }}
            className={`relative ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
        >
            <NavItem
                icon={FileText}
                label={page.title}
                onClick={() => onPageSelect(page.id)}
                colorClass="text-[var(--text-secondary)]/60"
                emoji={page.metadata?.icon}
                indented
            />
        </div>
    );
};

export const SectionHeader = ({ label, isExpanded, onToggle, onAdd, addLabel }: SectionProps) => (
    <div className="group relative flex items-center px-3 mt-6 mb-1">
        <button
            onClick={onToggle}
            aria-expanded={isExpanded}
            className="gnosi-sidebar-section-title flex-1 min-w-0 flex items-center gap-1 transition-colors text-left"
        >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {label}
        </button>
        {onAdd && (
            <button
                onClick={onAdd}
                className="vault-sidebar-icon-action absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] rounded transition-all"
                title={addLabel}
                aria-label={addLabel}
            >
                <Plus size={14} />
            </button>
        )}
    </div>
);
