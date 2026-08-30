import { Columns2, Copy, Edit2, Star, Trash2 } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { PageTreeItemProps } from './types';
import { useMenuDismissal } from './useMenuDismissal';
export function PageContextMenu({ page, role, menuState, setMenuState, onRenamePage, onToggleFavorite, onDuplicatePage, onOpenParallel, onDeletePage, onRename }: PageTreeItemProps & { onRename: () => void; }) {
    const { t } = useTranslation();
    const menuRef = useRef<HTMLDivElement>(null);
    const isAdmin = role === 'admin' || role === 'owner';
    const isEditor = role === 'editor' || isAdmin;
    const isFavorite = page.metadata?.favorite === true || page.metadata?.favorite === 'true';
    const isMenuOpen = menuState?.id === page.id;
    const close = useCallback(() => { if (menuState?.id === page.id) setMenuState(null); }, [menuState, page.id, setMenuState]);
    useMenuDismissal(isMenuOpen, menuRef, close);
    return (<>
        {/* Context menu dropdown (Portal) */}
        {isMenuOpen && typeof document !== 'undefined' && createPortal(
            <div
                ref={menuRef}
                className="vault-sidebar__menu fixed w-40 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100 max-h-[calc(100vh-20px)] overflow-y-auto"
                style={{ top: menuState.y, left: menuState.x }}
            >
                {onRenamePage && isEditor && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setMenuState(null);
                            onRename();
                        }}
                        className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                        <Edit2 size={14} className="text-[var(--text-secondary)]/60" />
                        <span>{t('sidebar.rename')}</span>
                    </button>
                )}
                {onToggleFavorite && (
                    <button
                        onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setMenuState(null);
                            onToggleFavorite(page.id);
                        }}
                        className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                        <Star size={14} className={isFavorite ? "text-amber-400" : "text-[var(--text-secondary)]/60"} fill={isFavorite ? "currentColor" : "none"} />
                        <span>{isFavorite ? t('sidebar.remove_favorites') : t('sidebar.add_favorites')}</span>
                    </button>
                )}
                {onDuplicatePage && isEditor && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setMenuState(null);
                            onDuplicatePage(page.id);
                        }}
                        className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                        <Copy size={14} className="text-[var(--text-secondary)]/60" />
                        <span>{t('sidebar.duplicate')}</span>
                    </button>
                )}
                {onOpenParallel && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setMenuState(null);
                            onOpenParallel(page.id);
                        }}
                        className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                        <Columns2 size={14} className="text-[var(--text-secondary)]/60" />
                        <span>{t('sidebar.open_parallel')}</span>
                    </button>
                )}
                <div className="h-px bg-[var(--border-primary)] my-1 mx-2"></div>
                {onDeletePage && isAdmin && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setMenuState(null);
                            setTimeout(() => onDeletePage(page.id, page.title), 10);
                        }}
                        className="w-full cursor-pointer text-left flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--status-error)] hover:bg-[var(--bg-secondary)] transition-colors font-medium"
                    >
                        <Trash2 size={14} className="text-[var(--status-error)]" />
                        <span>{t('sidebar.delete')}</span>
                    </button>
                )}
            </div>,
            document.body
        )}
    </>);
}
