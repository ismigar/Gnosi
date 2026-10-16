import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AppWindow, FileText, Globe, GripVertical, Hash, LayoutDashboard, Network, Pencil, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconRenderer } from '../ui/previews/IconRenderer';
import type { BookmarkPage } from './BookmarkForm';
import { bookmarkGraphHref, bookmarkRouteHref } from './bookmark-routes';
import type { VaultBookmark } from './bookmarks';

interface Props {
  readonly entry: VaultBookmark;
  readonly page?: BookmarkPage;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly draggable: boolean;
  readonly onOpen: () => void;
  readonly onEdit: () => void;
}
const icons = { page: FileText, section: Hash, url: Globe, graph: Network, search: Search, route: AppWindow };

export function BookmarkRow({ entry, page, active, disabled, draggable, onOpen, onEdit }: Props) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id, disabled: !draggable });
  const Icon = entry.kind === 'page' && page?.metadata?.is_dashboard ? LayoutDashboard : icons[entry.kind];
  const className = `vault-sidebar__navigation-row flex min-w-0 flex-1 items-center gap-2 text-left rounded-md transition-colors ${active ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`;
  const content = <>{entry.kind === 'page' && page?.metadata?.icon ? <IconRenderer icon={page.metadata.icon} size={16} /> : <Icon size={16} className="shrink-0" />}<span className="min-w-0 flex-1 truncate">{entry.label}</span></>;
  return <div ref={setNodeRef} data-bookmark-id={entry.id} data-vault-page-id={entry.kind === 'page' ? entry.target : undefined} className="group relative flex items-center gap-1" style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 50 : 1 }}>
    {draggable ? <button type="button" className="vault-sidebar-icon-action cursor-grab active:cursor-grabbing" {...attributes} {...listeners} aria-label={t('bookmarks.reorder', { name: entry.label, defaultValue: `Reorder ${entry.label}` })}><GripVertical size={12} /></button> : null}
    {entry.kind === 'url' || entry.kind === 'graph' || entry.kind === 'route'
      ? <a aria-label={entry.label} className={className} href={entry.kind === 'route' ? bookmarkRouteHref(entry.target) : entry.kind === 'graph' ? bookmarkGraphHref(entry.target) : entry.target} target={entry.kind === 'url' ? '_blank' : undefined} rel="noopener noreferrer" aria-current={active ? 'page' : undefined}>{content}</a>
      : <button type="button" aria-label={entry.label} className={className} onClick={onOpen} aria-current={active ? 'page' : undefined} aria-expanded={entry.kind === 'section' || entry.kind === 'search' ? active : undefined}>{content}</button>}
    <button type="button" className="vault-sidebar-icon-action" disabled={disabled} title={t('common.edit', 'Edit')} aria-label={t('bookmarks.edit', { name: entry.label, defaultValue: `Edit ${entry.label}` })} onClick={onEdit}><Pencil size={12} /></button>
  </div>;
}
