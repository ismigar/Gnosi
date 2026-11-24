import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchVaultHome } from '../shared/api/vault-home';
import { fetchVaultPage } from '../shared/api/vaults';
import { homePreferencesKey } from '../shared/api/home-canvas';
import { useHomePreferences } from '../shared/api/useHomePreferences';
import { knowledgeDocumentPath } from '../shared/routing/vaultRouting';
import { RefreshButton } from '../shared/ui/actions/RefreshButton';

const HomeCanvas = lazy(() => import('../features/home-canvas'));

function HomePage() {
    const { t } = useTranslation();
    const { query, scope, save } = useHomePreferences();
    const followPage = Boolean(scope.vaultId) && (query.data?.start_mode === 'page' || (!query.data && query.isError));
    const page = useQuery({
        queryKey: [...homePreferencesKey(scope), 'start-page'],
        enabled: followPage,
        gcTime: 0, staleTime: 0, retry: false,
        queryFn: async ({ signal }) => {
            const id = await fetchVaultHome(signal);
            if (!id) return null;
            const record = await fetchVaultPage(id, signal, scope);
            signal.throwIfAborted();
            return knowledgeDocumentPath(id, record);
        },
    });
    const loading = <p className="home-page__notice" role="status">{t('common.loading')}</p>;
    if (!scope.vaultId) return <p className="home-page__notice">{t('home_canvas.choose_vault')}</p>;
    if (query.isPending || (followPage && page.isFetching)) return loading;
    if (followPage && !page.isError && page.data) return <Navigate to={page.data} replace />;
    if (!query.data) return <div className="home-page__notice" role="alert">{t('home_canvas.load_error')}
        <RefreshButton onClick={() => { void query.refetch(); }} /></div>;
    return <Suspense fallback={loading}><HomeCanvas key={JSON.stringify(homePreferencesKey(scope))}
        preferences={query.data} onSave={save} onReload={async () => {
            const result = await query.refetch();
            return result.isError ? undefined : result.data;
        }} /></Suspense>;
}

export default HomePage;
