import type { TFunction } from 'i18next';
import {
    BrainCircuit,
    Code2,
    History,
    Languages,
    Lock,
    MessageSquare,
    Share2,
    Star,
    Trash2,
    Unlock,
    type LucideIcon,
} from 'lucide-react';


export interface PageActionsConfig {
    readonly canDeleteCurrentPage?: boolean;
    readonly canFavorite?: boolean;
    readonly canOpenComments?: boolean;
    readonly canOpenHistory?: boolean;
    readonly canOpenShare?: boolean;
    readonly canProcessResource?: boolean;
    readonly canToggleCodeView?: boolean;
    readonly canToggleEditLock?: boolean;
    readonly canTranslatePage?: boolean;
    readonly isCodeView?: boolean;
    readonly isEditLocked?: boolean;
    readonly isFavorite?: boolean;
    readonly onDeleteCurrentPage?: () => void;
    readonly onOpenComments?: () => void;
    readonly onOpenHistory?: () => void;
    readonly onOpenShare?: () => void;
    readonly onProcessResource?: () => void;
    readonly onToggleCodeView?: () => void;
    readonly onToggleEditLock?: () => void;
    readonly onToggleFavorite?: () => void;
    readonly onTranslatePage?: () => void;
    readonly processResourceLabel?: string;
    readonly translateLabel?: string;
}


export interface PageActionItem {
    readonly Icon: LucideIcon;
    readonly active?: boolean;
    readonly activeClassName?: string;
    readonly danger?: boolean;
    readonly fillWhenActive?: boolean;
    readonly key: string;
    readonly label: string;
    readonly onClick?: () => void;
}


interface PartitionPageActionsOptions {
    readonly compactHeader: boolean;
    readonly compactOverflowItems: readonly PageActionItem[];
    readonly containerWidth?: number;
    readonly isCompact: boolean;
    readonly items: readonly PageActionItem[];
}


export interface PartitionedPageActions {
    readonly inline: readonly PageActionItem[];
    readonly overflow: readonly PageActionItem[];
}


export function inlinePageActionBudget(width?: number): number {
    if (!width || width >= 1024) return Number.POSITIVE_INFINITY;
    if (width >= 820) return 6;
    if (width >= 640) return 4;
    if (width >= 480) return 3;
    return 1;
}


export function buildPageActionItems(
    pageActions: PageActionsConfig | null | undefined,
    t: TFunction,
): PageActionItem[] {
    if (!pageActions) return [];
    const items: Array<PageActionItem | false | undefined> = [
        pageActions.canFavorite && {
            Icon: Star,
            active: pageActions.isFavorite,
            activeClassName: 'text-amber-500 hover:bg-amber-500/10',
            fillWhenActive: true,
            key: 'favorite',
            label: pageActions.isFavorite
                ? t('shell.remove_favorite', 'Remove from favorites')
                : t('shell.add_favorite', 'Add to favorites'),
            onClick: pageActions.onToggleFavorite,
        },
        pageActions.canToggleEditLock && {
            Icon: pageActions.isEditLocked ? Lock : Unlock,
            active: pageActions.isEditLocked,
            key: 'lock',
            label: pageActions.isEditLocked
                ? t('shell.unlock_edit', 'Unlock to edit')
                : t('shell.lock_edit', 'Lock editing (read-only)'),
            onClick: pageActions.onToggleEditLock,
        },
        pageActions.canToggleCodeView && {
            Icon: Code2,
            active: pageActions.isCodeView,
            key: 'code',
            label: pageActions.isCodeView
                ? t('shell.switch_normal_view')
                : t('shell.switch_code_view'),
            onClick: pageActions.onToggleCodeView,
        },
        pageActions.canOpenHistory && {
            Icon: History,
            key: 'history',
            label: t('shell.view_history'),
            onClick: pageActions.onOpenHistory,
        },
        pageActions.canOpenComments && {
            Icon: MessageSquare,
            key: 'comments',
            label: t('shell.view_comments', 'Comments'),
            onClick: pageActions.onOpenComments,
        },
        pageActions.canOpenShare && {
            Icon: Share2,
            key: 'share',
            label: t('shell.share_page', 'Share'),
            onClick: pageActions.onOpenShare,
        },
        pageActions.canTranslatePage && {
            Icon: Languages,
            key: 'translate',
            label: pageActions.translateLabel || t('shell.translate_page', 'Translate page'),
            onClick: pageActions.onTranslatePage,
        },
        pageActions.canProcessResource && {
            Icon: BrainCircuit,
            key: 'process-resource',
            label: pageActions.processResourceLabel
                || t('table.process_resource', 'Process resource (Brain)'),
            onClick: pageActions.onProcessResource,
        },
        pageActions.canDeleteCurrentPage && {
            Icon: Trash2,
            danger: true,
            key: 'delete',
            label: t('shell.delete_current_page'),
            onClick: pageActions.onDeleteCurrentPage,
        },
    ];
    return items.filter((item): item is PageActionItem => Boolean(item));
}


export function partitionPageActions({
    compactHeader,
    compactOverflowItems,
    containerWidth,
    isCompact,
    items,
}: PartitionPageActionsOptions): PartitionedPageActions {
    if (compactHeader) return { inline: [], overflow: [...compactOverflowItems, ...items] };
    if (isCompact) {
        const favorite = items.find((item) => item.key === 'favorite');
        return {
            inline: favorite ? [favorite] : [],
            overflow: [
                ...compactOverflowItems,
                ...items.filter((item) => item.key !== 'favorite'),
            ],
        };
    }

    const primaryKeys = ['favorite', 'comments'];
    const preferred = [
        ...primaryKeys
            .map((key) => items.find((item) => item.key === key))
            .filter((item): item is PageActionItem => Boolean(item)),
        ...items.filter((item) => item.active && !primaryKeys.includes(item.key)),
    ];
    const budget = inlinePageActionBudget(containerWidth);
    const inlineLimit = Math.min(
        3,
        budget === Number.POSITIVE_INFINITY ? 3 : Math.max(1, budget - 1),
    );
    const inline = preferred.slice(0, inlineLimit);
    const inlineKeys = new Set(inline.map((item) => item.key));
    return { inline, overflow: items.filter((item) => !inlineKeys.has(item.key)) };
}


export function pageActionButtonClass(item: PageActionItem): string {
    const color = item.danger
        ? 'text-[var(--text-secondary)] hover:text-[var(--status-error)] hover:bg-[var(--status-error)]/10'
        : item.active
            ? item.activeClassName
                || 'text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 hover:bg-[var(--gnosi-primary)]/15'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]';
    return `p-1.5 rounded-md transition-colors ${color}`;
}


export function pageActionIconFill(item: PageActionItem): 'currentColor' | 'none' {
    return item.fillWhenActive && item.active ? 'currentColor' : 'none';
}
