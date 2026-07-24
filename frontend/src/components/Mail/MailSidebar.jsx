import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveVaultName } from '../../hooks/useActiveVaultName';
import {
    Inbox, Send, FileText, Trash2,
    ChevronDown, Plus, Star,
    Archive, Search, AlertOctagon,
    MoreHorizontal, Pencil, Trash2 as DeleteIcon, Layout, Tag,
} from 'lucide-react';
import { useMailViews } from '../../hooks/useMailViews';
import { useMailTags } from '../../hooks/useMailTags';
import MailViewEditor from './MailViewEditor';

export default function MailSidebar({
    selectedAccount,
    onSelectAccount,
    accounts = [],
    activeFolder,
    activeCategory,
    activeViewId,
    activeTagId,
    onSelectFolder,
    onSelectCategory,
    onSelectView,
    onSelectTag,
    onCompose,
    onSearch,
    counts = {},
}) {
    const { t } = useTranslation();
    const activeVaultName = useActiveVaultName();
    const [showAccountSelector, setShowAccountSelector] = useState(false);
    const [searchValue, setSearchValue] = useState('');
    const [showEditor, setShowEditor] = useState(false);
    const [editingView, setEditingView] = useState(null);
    const [viewMenuId, setViewMenuId] = useState(null);
    const [showTags, setShowTags] = useState(true);

    const { tags, createTag, deleteTag } = useMailTags();

    const { views, createView, updateView, deleteView } = useMailViews();

    const handleSearchChange = (e) => {
        setSearchValue(e.target.value);
        onSearch?.(e.target.value);
    };

    const systemFolders = [
        { id: 'INBOX',   label: t('mail.inbox'),    icon: <Inbox size={16} />,        type: 'folder' },
        { id: 'STARRED', label: t('mail.starred'),  icon: <Star size={16} />,         type: 'folder' },
        { id: 'all',     label: t('mail.all_mail'), icon: <Archive size={16} />,      type: 'folder' },
        { id: 'SENT',    label: t('mail.sent'),     icon: <Send size={16} />,         type: 'folder' },
        { id: 'DRAFTS',  label: t('mail.drafts'),   icon: <FileText size={16} />,     type: 'folder' },
        { id: 'TRASH',   label: t('mail.trash'),    icon: <Trash2 size={16} />,       type: 'folder' },
        { id: 'SPAM',    label: t('mail.spam'),     icon: <AlertOctagon size={16} />, type: 'folder' },
    ];

    const handleItemClick = (item) => {
        if (item.type === 'folder') onSelectFolder(item.id);
        else if (item.type === 'category') onSelectCategory(item.id);
    };

    const handleSaveView = async (data) => {
        if (editingView) {
            await updateView(editingView.id, data);
        } else {
            const created = await createView(data);
            onSelectView?.(created);
        }
        setShowEditor(false);
        setEditingView(null);
    };

    const handleDeleteView = async (view) => {
        await deleteView(view.id);
        if (activeViewId === view.id) onSelectView?.(null);
        setViewMenuId(null);
    };

    const accountLabel = selectedAccount === null
        ? t('mail.all_accounts')
        : (selectedAccount?.email || 'Account');
    const accountInitial = selectedAccount === null ? '✦' : (selectedAccount?.email?.[0]?.toUpperCase() || 'G');

    const NavItem = ({ item }) => {
        const isActive = item.type === 'folder'
            ? activeFolder === item.id
            : activeCategory === item.id;
        const c = counts[item.id] || {};
        const noUnreadBadge = item.id === 'TRASH' || item.id === 'SPAM';
        const unread = noUnreadBadge ? 0 : (c.unread || 0);
        return (
            <button
                onClick={() => handleItemClick(item)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] transition-colors text-left
                    ${isActive
                        ? 'bg-[var(--sidebar-item-active)] text-[var(--sidebar-item-active-text)] font-semibold'
                        : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-item-hover)] font-medium'
                    }`}
            >
                <span className={isActive ? 'text-[var(--gnosi-blue)]' : 'text-[var(--text-secondary)]'}>
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
    };

    const ViewItem = ({ view }) => {
        const isActive = activeViewId === view.id;
        const showMenu = viewMenuId === view.id;
        return (
            <div className="relative group">
                <button
                    onClick={() => onSelectView?.(view)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] transition-colors text-left
                        ${isActive
                            ? 'bg-[var(--sidebar-item-active)] text-[var(--sidebar-item-active-text)] font-semibold'
                            : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-item-hover)] font-medium'
                        }`}
                >
                    <span className={isActive ? 'text-[var(--gnosi-blue)]' : 'text-[var(--text-secondary)]'}>
                        <Layout size={14} />
                    </span>
                    <span className="flex-1 truncate">{view.name}</span>
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setViewMenuId(showMenu ? null : view.id); }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition-opacity"
                    >
                        <MoreHorizontal size={13} />
                    </button>
                </button>

                {showMenu && (
                    <div className="absolute right-1 top-8 z-50 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg py-1 w-36 animate-in fade-in zoom-in-95 duration-100">
                        <button
                            onClick={() => { setEditingView(view); setShowEditor(true); setViewMenuId(null); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            <Pencil size={13} /> {t('common.edit', "Edit")}
                        </button>
                        <button
                            onClick={() => handleDeleteView(view)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-red-500 hover:bg-[var(--bg-secondary)] transition-colors"
                        >
                            <DeleteIcon size={13} /> {t('common.delete', "Delete")}
                        </button>
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            <div className="flex flex-col h-full w-64 bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)] shrink-0">
                {/* Vault badge */}
                <div className="px-3 pt-3 pb-0">
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-xs font-medium text-[var(--text-secondary)]">
                        <span className="text-[var(--gnosi-blue)] font-bold">G</span>
                        <span className="truncate">Vault: {activeVaultName || '…'}</span>
                    </div>
                </div>

                {/* Account selector + compose */}
                <div className="px-3 pt-2 pb-2 flex items-center justify-between gap-2 relative">
                    <button
                        onClick={() => setShowAccountSelector(v => !v)}
                        className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                        <div className="w-5 h-5 rounded bg-[var(--gnosi-blue)] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                            {accountInitial}
                        </div>
                        <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                            {accountLabel}
                        </span>
                        <ChevronDown
                            size={13}
                            className={`text-[var(--text-secondary)] shrink-0 transition-transform ${showAccountSelector ? 'rotate-180' : ''}`}
                        />
                    </button>

                    <button
                        onClick={onCompose}
                        title={t('mail.compose', "Compose")}
                        className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors shrink-0"
                    >
                        <Plus size={18} />
                    </button>

                    {showAccountSelector && (
                        <div className="absolute top-14 left-2 right-2 z-[var(--z-modal-dropdown)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-lg py-1 animate-in fade-in zoom-in-95 duration-150">
                            <div className="px-3 py-1.5 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                                {t('mail.mail_section')}
                            </div>
                            <button
                                onClick={() => { onSelectAccount(null); setShowAccountSelector(false); }}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors
                                    ${selectedAccount === null
                                        ? 'text-[var(--gnosi-blue)] font-semibold bg-[var(--sidebar-item-active)]'
                                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'}`}
                            >
                                <div className={`w-2 h-2 rounded-full ${selectedAccount === null ? 'bg-[var(--gnosi-blue)]' : 'bg-[var(--border-primary)]'}`} />
                                {t('mail.all_accounts')}
                            </button>
                            {accounts.map(acc => {
                                const isSelected = selectedAccount?.email === (acc.email || acc.username);
                                return (
                                    <button
                                        key={acc.email || acc.username}
                                        onClick={() => { onSelectAccount(acc); setShowAccountSelector(false); }}
                                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors
                                            ${isSelected
                                                ? 'text-[var(--gnosi-blue)] font-semibold bg-[var(--sidebar-item-active)]'
                                                : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'}`}
                                    >
                                        <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-[var(--gnosi-blue)]' : 'bg-[var(--border-primary)]'}`} />
                                        <span className="truncate">{acc.email || acc.username}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Search */}
                <div className="px-3 pb-3">
                    <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                        <input
                            type="text"
                            value={searchValue}
                            onChange={handleSearchChange}
                            placeholder={t('mail.search')}
                            className="w-full bg-[var(--bg-secondary)] border border-transparent focus:border-[var(--border-primary)] focus:bg-[var(--bg-primary)] text-[13px] text-[var(--text-primary)] placeholder-[var(--text-secondary)] pl-7 pr-3 py-1.5 rounded-lg outline-none transition-all"
                        />
                    </div>
                </div>

                {/* Nav */}
                <div
                    className="flex-1 overflow-y-auto px-2 pb-4 space-y-4"
                    onClick={() => setViewMenuId(null)}
                >
                    {/* Custom views */}
                    <div>
                        <div className="px-3 mb-1 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                            {t('mail.views')}
                        </div>
                        {views.map(view => <ViewItem key={view.id} view={view} />)}
                        <button
                            onClick={() => { setEditingView(null); setShowEditor(true); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors font-medium"
                        >
                            <Plus size={14} className="text-[var(--border-primary)]" />
                            {t('mail.add_view')}
                        </button>
                    </div>

                    {/* System folders */}
                    <div>
                        <div className="px-3 mb-1 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                            {t('mail.mail_section')}
                        </div>
                        {systemFolders.map(item => <NavItem key={item.id} item={item} />)}
                    </div>

                    {/* Etiquetes */}
                    <div>
                        <button
                            onClick={() => setShowTags(v => !v)}
                            className="w-full flex items-center gap-1.5 px-3 mb-1 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider hover:text-[var(--text-primary)] transition-colors"
                        >
                            <span className="flex-1 text-left">{t('mail.labels', "Labels")}</span>
                            <ChevronDown size={11} className={`transition-transform ${showTags ? '' : '-rotate-90'}`} />
                        </button>
                        {showTags && (
                            <>
                                {tags.map(tag => (
                                    <button
                                        key={tag.id}
                                        onClick={() => onSelectTag?.(activeTagId === tag.id ? null : tag.id)}
                                        className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13.5px] transition-colors text-left
                                            ${activeTagId === tag.id
                                                ? 'bg-[var(--sidebar-item-active)] text-[var(--sidebar-item-active-text)] font-semibold'
                                                : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-item-hover)] font-medium'}`}
                                    >
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: tag.color, display: 'inline-block', flexShrink: 0 }} />
                                        <span className="flex-1 truncate">{tag.name}</span>
                                    </button>
                                ))}
                                {tags.length === 0 && (
                                    <div className="px-3 py-1 text-[12px] text-[var(--text-secondary)]">{t('mail.no_tags', "No tags")}</div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {showEditor && (
                <MailViewEditor
                    initialView={editingView}
                    onSave={handleSaveView}
                    onCancel={() => { setShowEditor(false); setEditingView(null); }}
                />
            )}
        </>
    );
}
