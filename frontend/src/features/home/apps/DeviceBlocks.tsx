import { useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { recentConversations } from '../../agent/recentConversations';
import { APP_PREVIEW_LIMIT, readAppPreview, type PreviewSource } from '../../../shared/api/app-previews';
import { useAuth } from '../../../shared/auth/auth-context';
import { cachedBookmarkCollection } from '../../../shared/bookmarks/bookmark-migration';
import { bookmarkGraphHref, bookmarkRouteHref } from '../../../shared/bookmarks/bookmark-routes';
import { BUILTIN_COMMAND_TITLES, COMMAND_PLUGINS, commandHotkey, useHotkeyBindings } from '../../../shared/commands/hotkeys';
import { useRequestContext } from '../../../shared/hooks/useRequestContext';
import { emitAppEvent, subscribeAppEvent } from '../../../shared/platform/app-events';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { usePlugins } from '../../../shared/plugins/usePlugins';
import { knowledgeDocumentPath, vaultPath } from '../../../shared/routing/vaultRouting';
import { PreviewDate, PreviewList, type PreviewRow } from './PreviewList';

function useDeviceUpdates() {
    const [, update] = useReducer((value: number) => value + 1, 0);
    useEffect(() => {
        const stopStorage = subscribeWindowEvent('storage', update);
        const stopFocus = subscribeWindowEvent('focus', update);
        const stopAssistant = subscribeAppEvent('gnosi:assistant-closed', update);
        return () => { stopStorage(); stopFocus(); stopAssistant(); };
    }, []);
}

export function CachedBlock({ kind }: { readonly kind: PreviewSource }) {
    const { t } = useTranslation();
    const scope = useRequestContext();
    useDeviceUpdates();
    const { requireAuth, gnosiMode, user } = useAuth();
    const { getPluginSettings } = usePlugins();
    const role = user?.workspaces.find(workspace => workspace.id === scope.workspaceId)?.role;
    const canViewSites = (!requireAuth && gnosiMode === 'personal') || ['editor', 'admin', 'owner'].includes(role ?? '');
    if (kind === 'websites' && !canViewSites) return <p className="home-block__state">{t('home_canvas.apps.websites.permission')}</p>;
    const snapshot = readAppPreview(kind, scope);
    if (kind === 'planning') {
        const settings = getPluginSettings('project-planning');
        const table = typeof settings === 'object' && settings !== null && 'project_table_id' in settings ? settings.project_table_id : undefined;
        if (!table) return <p className="home-block__state">{t('home_canvas.apps.planning.unconfigured')}</p>;
        if (snapshot?.sourceId !== table) return <p className="home-block__state">{t('home_canvas.apps.planning.first')}</p>;
    }
    if (!snapshot) return <p className="home-block__state">{t(`home_canvas.apps.${kind}.first`)}</p>;
    const rows = snapshot.items.map((item): PreviewRow => {
        if (kind === 'planning') return { ...item, to: vaultPath('planning') + '?project=' + encodeURIComponent(item.id) };
        if (kind === 'websites') return { ...item, to: vaultPath('websites') + '?site=' + encodeURIComponent(item.id) };
        return item;
    });
    return <><PreviewList kind={kind} rows={rows} />
        <p className="home-preview__as-of">{t('home_canvas.apps.last_seen')} <PreviewDate value={snapshot.observedAt} /></p></>;
}

export function AssistantBlock() {
    const { t } = useTranslation();
    const scope = useRequestContext();
    const { user } = useAuth();
    useDeviceUpdates();
    const rows = recentConversations({ vaultId: scope.vaultId, workspaceId: scope.workspaceId, userId: user?.id || 'personal' })
        .slice(0, APP_PREVIEW_LIMIT).map((session): PreviewRow => ({
            id: session.id, title: session.title, date: new Date(session.updatedAt).toISOString(),
            onOpen: () => { emitAppEvent('gnosi:open-assistant', { sessionId: session.id }); },
        }));
    return <><PreviewList kind="assistant" rows={rows} />
        <button type="button" className="home-preview__link home-preview__action" onClick={() => { emitAppEvent('gnosi:open-assistant', {}); }}>
            {t('chat.open_chat')}
        </button></>;
}

export function BookmarksBlock() {
    const { t } = useTranslation();
    const scope = useRequestContext();
    useDeviceUpdates();
    const snapshot = cachedBookmarkCollection(scope);
    if (!snapshot) return <p className="home-block__state">{t('home_canvas.apps.bookmarks.first')}</p>;
    const rows = [...snapshot.entries].sort((left, right) => right.created_at - left.created_at)
        .slice(0, APP_PREVIEW_LIMIT).map((entry): PreviewRow => {
            const row = { id: entry.id, title: entry.label, detail: entry.group };
            if (entry.kind === 'page') return { ...row, to: knowledgeDocumentPath(entry.target) };
            if (entry.kind === 'graph') return { ...row, to: bookmarkGraphHref(entry.target) };
            if (entry.kind === 'route') return { ...row, to: bookmarkRouteHref(entry.target) };
            if (entry.kind === 'url') return { ...row, externalUrl: entry.target };
            return { ...row, detail: [entry.group, entry.target].filter(Boolean).join(' · ') };
        });
    return <><PreviewList kind="bookmarks" rows={rows} /><p className="home-preview__as-of">{t('home_canvas.apps.bookmarks.saved')}</p></>;
}

export function ShortcutBlock() {
    const { t } = useTranslation();
    const bindings = useHotkeyBindings();
    const { isEnabled } = usePlugins();
    const rows = Object.entries(BUILTIN_COMMAND_TITLES).flatMap(([id, label]): PreviewRow[] => {
        const shortcut = commandHotkey(id, bindings);
        const plugin = COMMAND_PLUGINS[id];
        if (!shortcut || (plugin && !isEnabled(plugin))) return [];
        return [{ id, title: t(label), detail: shortcut }];
    });
    return <><PreviewList kind="settings" rows={rows.slice(0, APP_PREVIEW_LIMIT)} />
        <button type="button" className="home-preview__link home-preview__action" onClick={() => { emitAppEvent('open-settings', 'hotkeys'); }}>
            {t('home_canvas.apps.settings.edit')}
        </button></>;
}
