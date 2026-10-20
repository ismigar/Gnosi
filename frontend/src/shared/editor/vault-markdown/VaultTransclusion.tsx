import { useEffect, useMemo, useState, type MouseEvent, type ReactNode, type Ref } from 'react';
import { ExternalLink, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GnosiApiError } from '../../api/errors';
import { currentRequestContext } from '../../api/request-context';
import { fetchVaultPage, resolveVaultTitle } from '../../api/vaults';
import { useRequestContext } from '../../hooks/useRequestContext';
import { subscribeAppEvent } from '../../platform/app-events';
import { pageReferenceTitle, readablePageTitle } from '../../records/pageReferenceTitle';
import { RefreshButton } from '../../ui/actions/RefreshButton';
import { extractSectionMarkdown, resolveTransclusionLocally, transclusionGuard, transclusionKey } from './transclusionModel';

export interface TransclusionContent {
    readonly markdown: string;
    readonly pageId: string;
    readonly ancestry: readonly string[];
}

export interface VaultTransclusionProps {
    readonly target: string;
    readonly alias?: string;
    readonly section?: string;
    readonly idToTitle: Readonly<Record<string, string>>;
    readonly sourcePageId?: string | null;
    readonly ancestry: readonly string[];
    readonly vaultId?: string | null;
    readonly onOpenInCurrentTab?: (pageId: string) => unknown;
    readonly onOpenInNewTab?: (pageId: string) => unknown;
    readonly onOpenParallel?: (pageId: string) => unknown;
    readonly containerRef?: Ref<HTMLDivElement>;
    readonly renderContent: (content: TransclusionContent) => ReactNode;
}

type TransclusionStatus = 'loaded' | 'missing' | 'section' | 'error' | 'cycle' | 'depth';
interface LoadedTransclusion {
    readonly key: string;
    readonly status: TransclusionStatus;
    readonly pageId: string;
    readonly markdown?: string;
    readonly title?: string;
}

/** Read-only source view; each descendant carries a bounded, branch-local path. */
export function VaultTransclusion({
    target, alias = '', section = '', idToTitle, sourcePageId, ancestry, vaultId,
    onOpenInCurrentTab, onOpenInNewTab, onOpenParallel, containerRef, renderContent,
}: VaultTransclusionProps) {
    const { t } = useTranslation();
    const [revision, setRevision] = useState(0);
    const [loaded, setLoaded] = useState<LoadedTransclusion | null>(null);
    const { userEmail, userId, workspaceId, vaultId: activeVaultId } = useRequestContext();
    const context = useMemo(() => ({ userEmail, userId, workspaceId, vaultId: vaultId ?? activeVaultId }),
        [userEmail, userId, workspaceId, activeVaultId, vaultId]);
    const activeScope = JSON.stringify({ userEmail, userId, vaultId: activeVaultId, workspaceId });
    const ancestryKey = JSON.stringify(ancestry);
    const localId = resolveTransclusionLocally(target, idToTitle, section ? sourcePageId : undefined);
    const key = JSON.stringify([activeScope, context, target, section, localId, ancestryKey, revision]);
    const current = loaded?.key === key ? loaded : null;
    const resolvedId = current?.pageId || localId;
    const localGuard = localId ? transclusionGuard(ancestry, localId, section) : null;
    const status = localGuard ?? current?.status;
    const loading = !status;

    useEffect(() => {
        const refresh = () => { setRevision(value => value + 1); };
        const stopSaved = subscribeAppEvent('gnosi:invalidatePreview', ({ pageId }) => {
            if (!pageId || !resolvedId || pageId === resolvedId) refresh();
        });
        const stopDeleted = subscribeAppEvent('gnosi:page-deleted', ({ pageId }) => {
            if (pageId === resolvedId) refresh();
        });
        const stopVault = subscribeAppEvent('gnosi:vault-changed', refresh);
        return () => { stopSaved(); stopDeleted(); stopVault(); };
    }, [resolvedId]);

    useEffect(() => {
        if (localGuard) return;
        const controller = new AbortController();
        const isCurrent = () => !controller.signal.aborted && JSON.stringify(currentRequestContext()) === activeScope;
        const load = async (): Promise<void> => {
            let pageId = localId;
            try {
                if (!pageId && target) {
                    pageId = (await resolveVaultTitle(target, controller.signal, context)).id || null;
                }
                if (!isCurrent()) return;
                if (!pageId) { setLoaded({ key, status: 'missing', pageId: '' }); return; }
                const guard = transclusionGuard(ancestry, pageId, section);
                if (guard) { setLoaded({ key, status: guard, pageId }); return; }
                const page = await fetchVaultPage(pageId, controller.signal, context);
                if (!isCurrent()) return;
                const markdown = extractSectionMarkdown(page.content, section);
                setLoaded({
                    key,
                    status: markdown === null ? 'section' : 'loaded',
                    pageId,
                    markdown: markdown ?? undefined,
                    title: typeof page.title === 'string' ? page.title : (typeof page.metadata.title === 'string' ? page.metadata.title : ''),
                });
            } catch (error: unknown) {
                if (!isCurrent()) return;
                setLoaded({ key, status: error instanceof GnosiApiError && error.status === 404 ? 'missing' : 'error', pageId: pageId || '' });
            }
        };
        void load();
        return () => { controller.abort(); };
    }, [activeScope, ancestry, context, key, localGuard, localId, section, target]);

    const displayTitle = alias ? readablePageTitle(alias, idToTitle)
        : pageReferenceTitle(resolvedId || target, idToTitle, current?.title, t('editor.transclusion'));
    const openTarget = (event: MouseEvent<HTMLButtonElement>): void => {
        event.stopPropagation();
        if (!resolvedId) return;
        const open = event.shiftKey ? onOpenParallel
            : event.metaKey || event.ctrlKey ? (onOpenInNewTab ?? onOpenParallel) : onOpenInCurrentTab;
        (open ?? onOpenInCurrentTab ?? onOpenParallel)?.(resolvedId);
    };
    const message = status === 'cycle' ? t('editor.transclusion_cycle', 'This embed refers back to a note already shown here.')
        : status === 'depth' ? t('editor.transclusion_depth', 'Open this note to continue reading its nested embeds.')
            : status === 'missing' ? t('editor.note_not_found')
                : status === 'section' ? t('editor.section_not_found')
                    : status === 'error' ? t('editor.preview_load_error') : '';

    return <div
        ref={containerRef}
        contentEditable={false}
        className="my-4 min-w-0 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-4"
        data-transclusion-target={target}
        aria-busy={loading}
    >
        <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--gnosi-primary)]"><Maximize2 size={13} />{t('editor.transclusion')}</span>
            <RefreshButton loading={loading} onClick={event => { event.stopPropagation(); setRevision(value => value + 1); }} />
        </div>
        <button type="button" className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] hover:underline" disabled={!resolvedId} onClick={openTarget} title={t('editor.open_embedded_note')}>
            {displayTitle}{section ? ` #${section}` : ''}<ExternalLink size={14} />
        </button>
        {loading ? <div className="text-sm text-[var(--text-tertiary)]" role="status">{t('common.loading', 'Loading...')}</div> : null}
        {message ? <div className="text-sm text-[var(--text-tertiary)]" role="status">{message}</div> : null}
        {status === 'loaded' && current ? <div className="min-w-0 break-words text-sm leading-relaxed text-[var(--text-primary)]">
            {current.markdown?.trim() ? renderContent({
                markdown: current.markdown,
                pageId: current.pageId,
                ancestry: [...ancestry, transclusionKey(current.pageId, section)],
            }) : t('editor.no_content')}
        </div> : null}
    </div>;
}
