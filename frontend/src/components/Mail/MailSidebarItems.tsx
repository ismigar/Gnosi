import type { ReactNode } from 'react';
import { Layout, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { MailView } from '../../shared/api/mail';


export interface MailNavigationItem {
  readonly icon: ReactNode;
  readonly id: string;
  readonly label: string;
  readonly type: 'category' | 'folder';
}


export interface MailFolderCount {
  readonly total?: number | null;
  readonly unread?: number | null;
}


interface SidebarNavItemProps {
  readonly activeCategory: string | null;
  readonly activeFolder: string;
  readonly count?: MailFolderCount;
  readonly item: MailNavigationItem;
  readonly onSelect: (item: MailNavigationItem) => unknown;
}


export function SidebarNavItem({
  activeCategory,
  activeFolder,
  count,
  item,
  onSelect,
}: SidebarNavItemProps) {
  const isActive = item.type === 'folder'
    ? activeFolder === item.id
    : activeCategory === item.id;
  const noUnreadBadge = item.id === 'TRASH' || item.id === 'SPAM';
  const unread = noUnreadBadge ? 0 : (count?.unread ?? 0);
  return (
    <button
      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] transition-colors text-left ${isActive
        ? 'bg-[var(--sidebar-item-active)] text-[var(--sidebar-item-active-text)] font-semibold'
        : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-item-hover)] font-medium'
      }`}
      onClick={() => {
        onSelect(item);
      }}
    >
      <span className={isActive
        ? 'text-[var(--gnosi-blue)]'
        : 'text-[var(--text-secondary)]'}
      >
        {item.icon}
      </span>
      <span className="flex-1">{item.label}</span>
      {unread > 0 && (
        <span className="ml-auto text-[11px] font-bold bg-[var(--gnosi-blue)] text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}


interface SidebarViewItemProps {
  readonly activeViewId?: string | null;
  readonly onDelete: (view: MailView) => Promise<void>;
  readonly onEdit: (view: MailView) => void;
  readonly onSelect: (view: MailView) => unknown;
  readonly onToggleMenu: (viewId: string | null) => void;
  readonly view: MailView;
  readonly viewMenuId: string | null;
}


export function SidebarViewItem({
  activeViewId,
  onDelete,
  onEdit,
  onSelect,
  onToggleMenu,
  view,
  viewMenuId,
}: SidebarViewItemProps) {
  const { t } = useTranslation();
  const isActive = activeViewId === view.id;
  const showMenu = viewMenuId === view.id;
  return (
    <div className="relative group">
      <div className={`flex items-center rounded-lg transition-colors ${isActive
        ? 'bg-[var(--sidebar-item-active)] text-[var(--sidebar-item-active-text)] font-semibold'
        : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-item-hover)] font-medium'
      }`}>
        <button
          className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left text-[13.5px]"
          onClick={() => {
            onSelect(view);
          }}
        >
          <span className={isActive
            ? 'text-[var(--gnosi-blue)]'
            : 'text-[var(--text-secondary)]'}
          >
            <Layout size={14} />
          </span>
          <span className="flex-1 truncate">{view.name}</span>
        </button>
        <button
          className="mr-2 p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onToggleMenu(showMenu ? null : view.id);
          }}
          type="button"
        >
          <MoreHorizontal size={13} />
        </button>
      </div>
      {showMenu && (
        <div className="absolute right-1 top-8 z-50 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg py-1 w-36 animate-in fade-in zoom-in-95 duration-100">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            onClick={() => {
              onEdit(view);
            }}
          >
            <Pencil size={13} /> {t('common.edit', 'Edit')}
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-500 hover:bg-[var(--bg-secondary)] transition-colors"
            onClick={() => {
              void onDelete(view);
            }}
          >
            <Trash2 size={13} /> {t('common.delete', 'Delete')}
          </button>
        </div>
      )}
    </div>
  );
}
