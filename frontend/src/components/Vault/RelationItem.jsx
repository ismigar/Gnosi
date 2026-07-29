import { useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function RelationItem({
    relationId,
    title,
    onOpen,
    onRemove,
    className = '',
}) {
    const { t } = useTranslation();
    const [isRemoving, setIsRemoving] = useState(false);
    const fullTitle = String(title || relationId || t('common.untitled', 'Untitled'));

    const stopAndOpen = (event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen?.(relationId);
    };

    const stopAndRemove = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!onRemove || isRemoving) return;
        setIsRemoving(true);
        try {
            await onRemove(relationId);
        } finally {
            setIsRemoving(false);
        }
    };

    return (
        <span
            className={`group/relation inline-flex h-6 w-44 max-w-full items-center overflow-hidden rounded-md border border-[var(--gnosi-primary)]/20 bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] ${className}`}
            title={fullTitle}
            data-relation-item={relationId}
        >
            <span className="min-w-0 flex-1 truncate px-2 text-[11px] font-medium">
                {fullTitle}
            </span>
            {onOpen && (
                <button
                    type="button"
                    onClick={stopAndOpen}
                    className="inline-flex h-full w-6 shrink-0 items-center justify-center border-l border-[var(--gnosi-primary)]/15 text-[var(--gnosi-primary)]/65 transition-colors hover:bg-[var(--gnosi-primary)]/15 hover:text-[var(--gnosi-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--gnosi-primary)]"
                    title={t('relation_item.open_new_tab', 'Open in a new tab')}
                    aria-label={t('relation_item.open_new_tab_named', 'Open {{title}} in a new tab', { title: fullTitle })}
                >
                    <ExternalLink size={11} />
                </button>
            )}
            {onRemove && (
                <button
                    type="button"
                    onClick={stopAndRemove}
                    disabled={isRemoving}
                    className="inline-flex h-full w-6 shrink-0 items-center justify-center border-l border-[var(--gnosi-primary)]/15 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--status-error)] disabled:cursor-wait disabled:opacity-40"
                    title={t('relation_item.remove', 'Remove from this record')}
                    aria-label={t('relation_item.remove_named', 'Remove {{title}} from this record', { title: fullTitle })}
                >
                    <X size={11} />
                </button>
            )}
        </span>
    );
}

export default RelationItem;
