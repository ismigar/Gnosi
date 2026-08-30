import { AlertCircle } from 'lucide-react';
import { useEmbedController } from './db-view-embed/useEmbedController';
import { useEmbedNavigation } from './db-view-embed/useEmbedNavigation';
import { EmbedToolbar } from './db-view-embed/EmbedToolbar';
import { EmbedTabs } from './db-view-embed/EmbedTabs';
import { EmbedDialogs } from './db-view-embed/EmbedDialogs';
import { EmbedBody } from './db-view-embed/EmbedBody';
import type { DbViewEmbedProps } from './db-view-embed/types';
export function DbViewEmbed(props: DbViewEmbedProps) {
    const model = useEmbedController(props);
    const { embedContainerRef, isInEditor, handleShellKeyDown, registerNavApi, focusShell } = useEmbedNavigation(model);
    const { loading, error, viewType, t } = model;
    if (loading) {
        return (
            <div className={`vault-view-skeleton vault-view-skeleton--${viewType} my-4`} role="status" aria-label={t('views_header.loading_view', "Loading view...")}>
                <div className="vault-view-skeleton__toolbar">
                    <span className="vault-skeleton-block w-24" />
                    <span className="vault-skeleton-block w-32" />
                </div>
                <div className="vault-view-skeleton__cards" aria-hidden="true">
                    {[0, 1, 2].map((item) => (
                        <div key={item} className="vault-view-skeleton__card">
                            <span className="vault-skeleton-block w-2/3" />
                            <span className="vault-skeleton-block w-1/3" />
                            <span className="vault-skeleton-block w-full" />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="my-4 p-3 bg-[var(--status-error)]/5 border border-[var(--status-error)]/20 rounded-lg flex items-start gap-2.5">
                <AlertCircle size={16} className="text-[var(--status-error)] mt-0.5 shrink-0" />
                <div className="text-xs text-[var(--status-error)]">{error}</div>
            </div>
        );
    }
    return (
        <div ref={embedContainerRef} tabIndex={isInEditor ? -1 : undefined}
            onKeyDown={isInEditor ? handleShellKeyDown : undefined}
            className="mt-0 mb-4 min-w-0 w-full gnosi-view-embed-container rounded-lg outline-none focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/40">
            <EmbedToolbar model={model} />
            <EmbedTabs model={model} />
            <EmbedBody model={model} registerNavApi={registerNavApi} focusShell={focusShell} />
            <EmbedDialogs model={model} />
        </div>);
}
