import { useState, type ChangeEvent } from 'react';
import {
  AlertOctagon,
  Archive,
  ChevronDown,
  FileText,
  Inbox,
  Plus,
  Search,
  Send,
  Star,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useMailTags } from '../../hooks/useMailTags';
import { useMailViews } from '../../hooks/useMailViews';
import type {
  MailView,
  MailViewCreate,
} from '../../shared/api/mail';
import {
  SidebarNavItem,
  SidebarViewItem,
  type MailFolderCount,
  type MailNavigationItem,
} from './MailSidebarItems';
import MailViewEditor from './MailViewEditor';


export interface MailAccount {
  readonly email?: string | null;
  readonly username?: string | null;
}


export interface MailSidebarProps {
  readonly accounts?: readonly MailAccount[];
  readonly activeCategory: string | null;
  readonly activeFolder: string;
  readonly activeTagId?: string | null;
  readonly activeViewId?: string | null;
  readonly counts?: Readonly<Record<string, MailFolderCount | undefined>>;
  readonly onCompose: () => unknown;
  readonly onSearch?: (value: string) => unknown;
  readonly onSelectAccount: (account: MailAccount | null) => unknown;
  readonly onSelectCategory: (category: string) => unknown;
  readonly onSelectFolder: (folder: string) => unknown;
  readonly onSelectTag?: (tagId: string | null) => unknown;
  readonly onSelectView?: (view: MailView | null) => unknown;
  readonly selectedAccount: MailAccount | null;
}


function accountAddress(account: MailAccount): string {
  return account.email || account.username || '';
}


export default function MailSidebar({
  accounts = [],
  activeCategory,
  activeFolder,
  activeTagId,
  activeViewId,
  counts = {},
  onCompose,
  onSearch,
  onSelectAccount,
  onSelectCategory,
  onSelectFolder,
  onSelectTag,
  onSelectView,
  selectedAccount,
}: MailSidebarProps) {
  const { t } = useTranslation();
  const [showAccountSelector, setShowAccountSelector] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [editingView, setEditingView] = useState<MailView | null>(null);
  const [viewMenuId, setViewMenuId] = useState<string | null>(null);
  const [showTags, setShowTags] = useState(true);
  const { tags } = useMailTags();
  const { views, createView, updateView, deleteView } = useMailViews();

  const systemFolders: MailNavigationItem[] = [
    { icon: <Inbox size={16} />, id: 'INBOX', label: t('mail.inbox'), type: 'folder' },
    { icon: <Star size={16} />, id: 'STARRED', label: t('mail.starred'), type: 'folder' },
    { icon: <Archive size={16} />, id: 'all', label: t('mail.all_mail'), type: 'folder' },
    { icon: <Send size={16} />, id: 'SENT', label: t('mail.sent'), type: 'folder' },
    { icon: <FileText size={16} />, id: 'DRAFTS', label: t('mail.drafts'), type: 'folder' },
    { icon: <Trash2 size={16} />, id: 'TRASH', label: t('mail.trash'), type: 'folder' },
    { icon: <AlertOctagon size={16} />, id: 'SPAM', label: t('mail.spam'), type: 'folder' },
  ];

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setSearchValue(event.target.value);
    onSearch?.(event.target.value);
  };

  const handleItemClick = (item: MailNavigationItem): void => {
    if (item.type === 'folder') onSelectFolder(item.id);
    else onSelectCategory(item.id);
  };

  const handleSaveView = async (data: MailViewCreate): Promise<void> => {
    if (editingView) await updateView(editingView.id, data);
    else onSelectView?.(await createView(data));
    setShowEditor(false);
    setEditingView(null);
  };

  const handleDeleteView = async (view: MailView): Promise<void> => {
    await deleteView(view.id);
    if (activeViewId === view.id) onSelectView?.(null);
    setViewMenuId(null);
  };

  const accountLabel = selectedAccount === null
    ? t('mail.all_accounts')
    : (selectedAccount.email || 'Account');
  const accountInitial = selectedAccount === null
    ? '✦'
    : (selectedAccount.email?.at(0)?.toUpperCase() || 'G');

  return (
    <>
      <div className="flex flex-col h-full w-64 bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)] shrink-0">
        <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2 relative">
          <button
            className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
            onClick={() => {
              setShowAccountSelector((visible) => !visible);
            }}
          >
            <div className="w-5 h-5 rounded bg-[var(--gnosi-blue)] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
              {accountInitial}
            </div>
            <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
              {accountLabel}
            </span>
            <ChevronDown
              className={`text-[var(--text-secondary)] shrink-0 transition-transform ${showAccountSelector ? 'rotate-180' : ''}`}
              size={13}
            />
          </button>
          <button
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors shrink-0"
            onClick={onCompose}
            title={t('mail.compose', 'Compose')}
          >
            <Plus size={18} />
          </button>
          {showAccountSelector && (
            <div className="absolute top-14 left-2 right-2 z-[var(--z-modal-dropdown)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg py-1 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                {t('mail.mail_section')}
              </div>
              <button
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors ${selectedAccount === null
                  ? 'text-[var(--gnosi-blue)] font-semibold bg-[var(--sidebar-item-active)]'
                  : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                }`}
                onClick={() => {
                  onSelectAccount(null);
                  setShowAccountSelector(false);
                }}
              >
                <div className={`w-2 h-2 rounded-full ${selectedAccount === null ? 'bg-[var(--gnosi-blue)]' : 'bg-[var(--border-primary)]'}`} />
                {t('mail.all_accounts')}
              </button>
              {accounts.map((account) => {
                const address = accountAddress(account);
                const isSelected = selectedAccount?.email === address;
                return (
                  <button
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors ${isSelected
                      ? 'text-[var(--gnosi-blue)] font-semibold bg-[var(--sidebar-item-active)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                    }`}
                    key={address}
                    onClick={() => {
                      onSelectAccount(account);
                      setShowAccountSelector(false);
                    }}
                  >
                    <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-[var(--gnosi-blue)]' : 'bg-[var(--border-primary)]'}`} />
                    <span className="truncate">{address}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" size={13} />
            <input
              className="w-full bg-[var(--bg-secondary)] border border-transparent focus:border-[var(--border-primary)] focus:bg-[var(--bg-primary)] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-secondary)] pl-7 pr-3 py-1.5 rounded-lg outline-none transition-all"
              onChange={handleSearchChange}
              placeholder={t('mail.search')}
              type="text"
              value={searchValue}
            />
          </div>
        </div>
        <div
          className="flex-1 overflow-y-auto px-2 pb-4 space-y-4"
          onClick={() => {
            setViewMenuId(null);
          }}
        >
          <div>
            <div className="gnosi-sidebar-section-title px-3 mb-1">{t('mail.views')}</div>
            {views.map((view) => (
              <SidebarViewItem
                activeViewId={activeViewId}
                key={view.id}
                onDelete={handleDeleteView}
                onEdit={(selectedView) => {
                  setEditingView(selectedView);
                  setShowEditor(true);
                  setViewMenuId(null);
                }}
                onSelect={(selectedView) => onSelectView?.(selectedView)}
                onToggleMenu={setViewMenuId}
                view={view}
                viewMenuId={viewMenuId}
              />
            ))}
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors font-medium"
              onClick={() => {
                setEditingView(null);
                setShowEditor(true);
              }}
            >
              <Plus className="text-[var(--border-primary)]" size={14} />
              {t('mail.add_view')}
            </button>
          </div>
          <div>
            <div className="gnosi-sidebar-section-title px-3 mb-1">{t('mail.mail_section')}</div>
            {systemFolders.map((item) => (
              <SidebarNavItem
                activeCategory={activeCategory}
                activeFolder={activeFolder}
                count={counts[item.id]}
                item={item}
                key={item.id}
                onSelect={handleItemClick}
              />
            ))}
          </div>
          <div>
            <button
              className="gnosi-sidebar-section-title w-full flex items-center gap-1.5 px-3 mb-1 transition-colors"
              onClick={() => {
                setShowTags((visible) => !visible);
              }}
            >
              <span className="flex-1 text-left">{t('mail.labels', 'Labels')}</span>
              <ChevronDown className={`transition-transform ${showTags ? '' : '-rotate-90'}`} size={11} />
            </button>
            {showTags && tags.map((tag) => (
              <button
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13.5px] transition-colors text-left ${activeTagId === tag.id
                  ? 'bg-[var(--sidebar-item-active)] text-[var(--sidebar-item-active-text)] font-semibold'
                  : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-item-hover)] font-medium'
                }`}
                key={tag.id}
                onClick={() => onSelectTag?.(activeTagId === tag.id ? null : tag.id)}
              >
                <span style={{ backgroundColor: tag.color, borderRadius: '50%', display: 'inline-block', flexShrink: 0, height: 8, width: 8 }} />
                <span className="flex-1 truncate">{tag.name}</span>
              </button>
            ))}
            {showTags && tags.length === 0 && (
              <div className="px-3 py-1 text-[12px] text-[var(--text-secondary)]">
                {t('mail.no_tags', 'No tags')}
              </div>
            )}
          </div>
        </div>
      </div>
      {showEditor && (
        <MailViewEditor
          initialView={editingView}
          onCancel={() => {
            setShowEditor(false);
            setEditingView(null);
          }}
          onSave={handleSaveView}
        />
      )}
    </>
  );
}
