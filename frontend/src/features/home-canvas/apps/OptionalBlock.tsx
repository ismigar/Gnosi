import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchSystemHealth } from '../../../shared/api/system';
import { useRequestContext } from '../../../shared/hooks/useRequestContext';
import { vaultPath } from '../../../shared/routing/vaultRouting';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import type { HomeBlockProps } from '../model';
import { AssistantBlock, BookmarksBlock, CachedBlock, ShortcutBlock } from './DeviceBlocks';
import { livePreviewItems, type LiveSource } from './live';
import { PreviewList, type PreviewRow } from './PreviewList';
import './preview.css';

function QueryState({ failed, retry }: { readonly failed: boolean; readonly retry: () => void }) {
    const { t } = useTranslation();
    if (!failed) return <p className="home-block__state" role="status">{t('common.loading')}</p>;
    return <div className="home-block__state" role="status">{t('home_canvas.block_error')} <RefreshButton onClick={retry} /></div>;
}

function LiveBlock({ kind }: { readonly kind: LiveSource }) {
    const scope = useRequestContext();
    const query = useQuery({
        queryKey: ['home-app', scope, kind],
        queryFn: ({ signal }) => livePreviewItems(kind, scope, signal),
        enabled: Boolean(scope.vaultId), staleTime: 30_000, retry: false,
    });
    if (!query.data) return <QueryState failed={query.isError} retry={() => { void query.refetch(); }} />;
    const rows = query.data.map((item): PreviewRow => {
        const id = encodeURIComponent(item.id);
        switch (kind) {
            case 'contacts': return { ...item, to: vaultPath('contacts') + '?contact=' + id };
            case 'feeds': return { ...item, to: vaultPath('reader', 'article/' + id) };
            case 'notebooks': return { ...item, to: vaultPath('notebooks', id) };
            case 'resources': return { ...item, to: vaultPath('resources') + '?search=' + id };
            case 'automations': return { ...item, to: '/dashboard?tab=schedulers&kind=system&task=' + id };
        }
    });
    return <PreviewList kind={kind} rows={rows} />;
}

function ControlBlock() {
    const { t } = useTranslation();
    const scope = useRequestContext();
    const query = useQuery({
        queryKey: ['home-app', scope, 'control'], queryFn: ({ signal }) => fetchSystemHealth(signal),
        enabled: Boolean(scope.vaultId), staleTime: 60_000, retry: false,
    });
    if (!query.data) return <QueryState failed={query.isError} retry={() => { void query.refetch(); }} />;
    const health = query.data;
    const rows = [
        { id: 'service', title: t('home_canvas.apps.control.service'), detail: t('home_canvas.apps.control.online') },
        { id: 'vault', title: t('common.vault_label'), detail: t(health.vault_configured ? 'home_canvas.apps.control.configured' : 'home_canvas.apps.control.unconfigured') },
        { id: 'access', title: t('home_canvas.apps.control.access'), detail: t(health.require_auth ? 'home_canvas.apps.control.signin' : 'home_canvas.apps.control.local') },
    ];
    return <PreviewList kind="control" rows={rows} />;
}

export default function OptionalBlock({ block }: HomeBlockProps) {
    switch (block.kind) {
        case 'contacts': case 'feeds': case 'resources': case 'notebooks': case 'automations':
            return <LiveBlock kind={block.kind} />;
        case 'mail': case 'websites': case 'planning': case 'media': case 'social':
            return <CachedBlock kind={block.kind} />;
        case 'bookmarks': return <BookmarksBlock />;
        case 'assistant': return <AssistantBlock />;
        case 'settings': return <ShortcutBlock />;
        case 'control': return <ControlBlock />;
        default: return null;
    }
}
