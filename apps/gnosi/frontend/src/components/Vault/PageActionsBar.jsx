import React, { useMemo, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
    Star,
    History,
    MessageSquare,
    Share2,
    Languages,
    Lock,
    Unlock,
    Code2,
    Trash2,
    MoreHorizontal,
} from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

// Width (px) of the editor content pane → how many page-action icons stay
// inline before the rest collapse into the "…" overflow. The page title is
// `flex-1` and truncates, so inline icons never collide with a long title;
// this budget only guards narrow panes (e.g. split view) and lets the action
// set grow in the future without ever overflowing the header row. When the
// finite budget is exceeded, the last inline slot is spent on the "…" trigger.
function inlineBudget(width) {
    if (!width || width >= 1024) return Infinity; // roomy (or not yet measured): show everything
    if (width >= 820) return 6;
    if (width >= 640) return 4;
    if (width >= 480) return 3;
    return 1;
}

// Builds the ordered action list from the raw handlers/flags. Kept identical in
// order and gating to the former VaultShell "…" menu so nothing changes but the
// location. Unavailable actions are dropped (not greyed) to keep the row compact.
function buildItems(pa, t) {
    if (!pa) return [];
    return [
        pa.canFavorite && {
            key: 'favorite',
            Icon: Star,
            active: pa.isFavorite,
            fillWhenActive: true,
            // Keep the established amber convention for "favorited".
            activeClassName: 'text-amber-500 hover:bg-amber-500/10',
            label: pa.isFavorite
                ? t('shell.remove_favorite', "Remove from favorites")
                : t('shell.add_favorite', "Add to favorites"),
            onClick: pa.onToggleFavorite,
        },
        pa.canToggleEditLock && {
            key: 'lock',
            Icon: pa.isEditLocked ? Lock : Unlock,
            active: pa.isEditLocked,
            label: pa.isEditLocked
                ? t('shell.unlock_edit', "Unlock to edit")
                : t('shell.lock_edit', "Lock editing (read-only)"),
            onClick: pa.onToggleEditLock,
        },
        pa.canToggleCodeView && {
            key: 'code',
            Icon: Code2,
            active: pa.isCodeView,
            label: pa.isCodeView
                ? t('shell.switch_normal_view')
                : t('shell.switch_code_view'),
            onClick: pa.onToggleCodeView,
        },
        pa.canOpenHistory && {
            key: 'history',
            Icon: History,
            label: t('shell.view_history'),
            onClick: pa.onOpenHistory,
        },
        pa.canOpenComments && {
            key: 'comments',
            Icon: MessageSquare,
            label: t('shell.view_comments', "Comments"),
            onClick: pa.onOpenComments,
        },
        pa.canOpenShare && {
            key: 'share',
            Icon: Share2,
            label: t('shell.share_page', "Share"),
            onClick: pa.onOpenShare,
        },
        pa.canTranslatePage && {
            key: 'translate',
            Icon: Languages,
            label: pa.translateLabel || t('shell.translate_page', "Translate page"),
            onClick: pa.onTranslatePage,
        },
        pa.canDeleteCurrentPage && {
            key: 'delete',
            Icon: Trash2,
            danger: true,
            label: t('shell.delete_current_page'),
            onClick: pa.onDeleteCurrentPage,
        },
    ].filter(Boolean);
}

/**
 * Inline page-action toolbar shown to the right of the page title. Replaces the
 * former "…" dropdown in the VaultShell top bar: the actions now live next to
 * the title as icon buttons, and only spill into a compact "…" overflow when the
 * pane is too narrow to fit them all.
 *
 * @param {object|null} pageActions Handlers + flags (same shape passed to the old menu).
 * @param {number} containerWidth   Measured width of the editor content pane, in px.
 */
export function PageActionsBar({ pageActions, containerWidth }) {
    const { t } = useTranslation();
    const [overflowOpen, setOverflowOpen] = useState(false);
    const [menuPos, setMenuPos] = useState(null);
    const triggerRef = useRef(null);
    const menuRef = useRef(null);

    const items = useMemo(() => buildItems(pageActions, t), [pageActions, t]);
    const budget = inlineBudget(containerWidth);

    const { inline, overflow } = useMemo(() => {
        if (items.length <= budget) return { inline: items, overflow: [] };
        // Finite budget exceeded → reserve the last slot for the "…" trigger.
        const inlineCount = Math.max(0, budget - 1);
        return { inline: items.slice(0, inlineCount), overflow: items.slice(inlineCount) };
    }, [items, budget]);

    // Close the overflow menu on outside click.
    useEffect(() => {
        if (!overflowOpen) return undefined;
        const handler = (e) => {
            if (
                menuRef.current && !menuRef.current.contains(e.target) &&
                triggerRef.current && !triggerRef.current.contains(e.target)
            ) {
                setOverflowOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [overflowOpen]);

    // Esc closes the overflow menu.
    useModalKeyboard({ isOpen: overflowOpen, onClose: () => setOverflowOpen(false) });

    if (!items.length) return null;

    // The menu only renders while there is something to overflow (guarded
    // below), so a pane that widens past the breakpoint hides it without any
    // reconciling effect.
    const showOverflowMenu = overflowOpen && overflow.length > 0 && menuPos;

    const toggleOverflow = () => {
        if (overflowOpen) {
            setOverflowOpen(false);
            return;
        }
        // Position the menu under the trigger via a portal so it escapes the
        // title row's transient `animate-in` transform (which would otherwise
        // break a plain absolute/fixed child).
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) {
            setMenuPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
        }
        setOverflowOpen(true);
    };

    const iconBtnClass = (item) =>
        `p-1.5 rounded-md transition-colors ${
            item.danger
                ? 'text-[var(--text-secondary)] hover:text-[var(--status-error)] hover:bg-[var(--status-error)]/10'
                : item.active
                    ? (item.activeClassName || 'text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 hover:bg-[var(--gnosi-primary)]/15')
                    : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
        }`;

    const iconFill = (item) => (item.fillWhenActive && item.active ? 'currentColor' : 'none');

    return (
        <div className="flex items-center gap-0.5 shrink-0">
            {inline.map((item) => {
                const { Icon } = item;
                return (
                    <button
                        key={item.key}
                        type="button"
                        onClick={item.onClick}
                        title={item.label}
                        aria-label={item.label}
                        aria-pressed={item.active || undefined}
                        className={iconBtnClass(item)}
                    >
                        <Icon size={16} fill={iconFill(item)} />
                    </button>
                );
            })}

            {overflow.length > 0 && (
                <button
                    ref={triggerRef}
                    type="button"
                    onClick={toggleOverflow}
                    title={t('shell.page_options', "Page options")}
                    aria-label={t('shell.page_options', "Page options")}
                    aria-haspopup="menu"
                    aria-expanded={overflowOpen}
                    className={`p-1.5 rounded-md transition-colors ${
                        overflowOpen
                            ? 'text-[var(--text-primary)] bg-[var(--bg-secondary)]'
                            : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                    }`}
                >
                    <MoreHorizontal size={16} />
                </button>
            )}

            {showOverflowMenu && createPortal((
                <div
                    ref={menuRef}
                    role="menu"
                    className="fixed w-56 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[1002] py-1 animate-in fade-in zoom-in-95 duration-150"
                    style={{ top: `${menuPos.top}px`, right: `${menuPos.right}px` }}
                >
                    {overflow.map((item, idx) => {
                        const { Icon } = item;
                        const withDivider = item.danger && idx > 0;
                        return (
                            <React.Fragment key={item.key}>
                                {withDivider && <div className="border-t border-[var(--border-primary)] my-1" />}
                                <button
                                    role="menuitem"
                                    type="button"
                                    onClick={() => { setOverflowOpen(false); item.onClick?.(); }}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                                        item.danger
                                            ? 'text-red-600 hover:bg-red-500/10'
                                            : item.active
                                                ? (item.activeClassName || 'text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10')
                                                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                                    }`}
                                >
                                    <Icon size={14} fill={iconFill(item)} />
                                    <span>{item.label}</span>
                                </button>
                            </React.Fragment>
                        );
                    })}
                </div>
            ), document.body)}
        </div>
    );
}

export default PageActionsBar;
