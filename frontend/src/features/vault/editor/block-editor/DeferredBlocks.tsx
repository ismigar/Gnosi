import { lazy, Suspense, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// Register schemas synchronously, but load optional view implementations only
// when a document actually renders one. Plain notes need none of these modules.
export const InlineDatabase = lazy(() => import('./InlineDatabase').then(module => ({ default: module.InlineDatabase })));
export const DbViewEmbed = lazy(() => import('../../views/DbViewEmbed').then(module => ({ default: module.DbViewEmbed })));
export const EmbedRenderer = lazy(() => import('../EmbedRenderer').then(module => ({ default: module.EmbedRenderer })));

export function DeferredBlock({ children }: { readonly children: ReactNode }) {
    const { t } = useTranslation();
    return <Suspense fallback={<span role="status" aria-busy="true">{t('common.loading')}</span>}>{children}</Suspense>;
}
