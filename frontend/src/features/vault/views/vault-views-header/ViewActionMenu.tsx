import type {
    CSSProperties,
    MouseEvent,
    ReactNode,
    RefObject,
} from 'react';
import { Copy, Edit2, Lock, Settings, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { HeaderView, ViewAction, ViewActionHandler } from './types';

interface ViewActionMenuProps {
    readonly className: string;
    readonly isPrimaryView: boolean;
    readonly menuRef: RefObject<HTMLDivElement | null>;
    readonly onAction: ViewActionHandler;
    readonly onClose: () => void;
    readonly role?: 'menu';
    readonly stopPropagation?: boolean;
    readonly style?: CSSProperties;
    readonly view: HeaderView;
}

interface ActionButtonProps {
    readonly action: ViewAction;
    readonly children: ReactNode;
    readonly className?: string;
    readonly onAction: ViewActionHandler;
    readonly onClose: () => void;
    readonly role?: 'menuitem';
    readonly stopPropagation: boolean;
    readonly view: HeaderView;
}

function ActionButton({
    action,
    children,
    className = 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]',
    onAction,
    onClose,
    role,
    stopPropagation,
    view,
}: ActionButtonProps) {
    const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
        if (stopPropagation) event.stopPropagation();
        onClose();
        onAction(view, action);
    };

    return (
        <button
            role={role}
            onClick={handleClick}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left ${className}`}
        >
            {children}
        </button>
    );
}

export function ViewActionMenu({
    className,
    isPrimaryView,
    menuRef,
    onAction,
    onClose,
    role,
    stopPropagation = false,
    style,
    view,
}: ViewActionMenuProps) {
    const { t } = useTranslation();

    return (
        <div ref={menuRef} role={role} className={className} style={style}>
            {!isPrimaryView && (
                <>
                    <ActionButton
                        action="configure"
                        onAction={onAction}
                        onClose={onClose}
                        role={role ? 'menuitem' : undefined}
                        stopPropagation={stopPropagation}
                        view={view}
                    >
                        <Settings size={13} />
                        {t('views_header.configure')}
                    </ActionButton>
                    <ActionButton
                        action="rename"
                        onAction={onAction}
                        onClose={onClose}
                        role={role ? 'menuitem' : undefined}
                        stopPropagation={stopPropagation}
                        view={view}
                    >
                        <Edit2 size={13} />
                        {t('views_header.rename')}
                    </ActionButton>
                </>
            )}
            <ActionButton
                action="duplicate"
                onAction={onAction}
                onClose={onClose}
                role={role ? 'menuitem' : undefined}
                stopPropagation={stopPropagation}
                view={view}
            >
                <Copy size={13} />
                {t('views_header.duplicate')}
            </ActionButton>
            <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
            {isPrimaryView ? (
                <div className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-tertiary)]/70 cursor-not-allowed">
                    <Lock size={13} />
                    {t('views_header.main_view_locked')}
                </div>
            ) : (
                <ActionButton
                    action="delete"
                    className="text-[var(--status-error)] hover:bg-[var(--bg-tertiary)]"
                    onAction={onAction}
                    onClose={onClose}
                    role={role ? 'menuitem' : undefined}
                    stopPropagation={stopPropagation}
                    view={view}
                >
                    <Trash2 size={13} className="text-[var(--status-error)]" />
                    {t('views_header.delete')}
                </ActionButton>
            )}
        </div>
    );
}
