import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchPublication, type PublicationBundle } from '../../../shared/api/vault-publishing';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import { useFocusModality } from '../../../shared/hooks/useFocusModality';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { publicationToken } from './publicEntry';
import { PublishedMarkdown } from './PublishedMarkdown';
import './publishing.css';

function selectedPage(): string { return new URLSearchParams(window.location.search).get('page') ?? ''; }

export default function PublishedSite() {
    const { t, i18n } = useTranslation();
    useFocusModality();
    const [bundle, setBundle] = useState<PublicationBundle | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const [pageId, setPageId] = useState(selectedPage);
    const [search, setSearch] = useState('');
    const token = publicationToken(window.location.pathname);
    useEffect(() => {
        const controller = new AbortController();
        if (!token) return () => { controller.abort(); };
        void fetchPublication(token, controller.signal).then(data => {
            if (controller.signal.aborted) return;
            setBundle(data); setError(false); setLoading(false);
        }).catch(() => {
            if (controller.signal.aborted) return;
            setBundle(null); setError(true); setLoading(false);
        });
        return () => { controller.abort(); };
    }, [token, refresh]);
    useEffect(() => {
        const handle = () => { setPageId(selectedPage()); };
        return subscribeWindowEvent('popstate', handle);
    }, []);
    const page = bundle?.pages.find(item => item.id === pageId) ?? bundle?.pages[0];
    useEffect(() => {
        if (!page) return;
        document.title = `${page.title} · ${bundle?.title ?? ''}`;
        try {
            const anchor = decodeURIComponent(window.location.hash.slice(1));
            if (anchor) document.getElementById(anchor)?.scrollIntoView();
        } catch { /* A malformed address fragment cannot change the public scope. */ }
    }, [page, bundle]);
    const navigate = (id: string, fragment = '') => {
        const url = `${window.location.pathname}?page=${encodeURIComponent(id)}${fragment ? `#${encodeURIComponent(fragment)}` : ''}`;
        window.history.pushState({}, '', url);
        setPageId(id); setSearch('');
        if (fragment) requestAnimationFrame(() => { document.getElementById(fragment)?.scrollIntoView(); });
    };
    const matching = bundle?.pages.filter(item => `${item.title}\n${item.markdown}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [];
    return <main className="gnosi-publication min-h-screen bg-[var(--bg-primary)] p-4 text-[var(--text-primary)] md:p-8">
        <div className="mx-auto max-w-6xl">
            <header className="mb-6 flex items-start justify-between gap-4 border-b border-[var(--border-primary)] pb-4">
                <div className="min-w-0 break-words"><h1 className="text-2xl font-bold">{bundle?.title ?? t('publishing.site', 'Published notes')}</h1>
                    {bundle && <p className="mt-2 text-sm text-[var(--text-tertiary)]">{t('publishing.snapshot_date', 'Snapshot: {{date}}', { date: new Date(bundle.published_at * 1000).toLocaleString(i18n.language) })}</p>}
                </div>
                <RefreshButton disabled={!token} loading={loading && !!token} onClick={() => { setLoading(true); setRefresh(value => value + 1); }} />
            </header>
            {!token || error ? <p role="alert">{t('publishing.unavailable', 'This publication is unavailable. It may have expired or been revoked.')}</p>
                : loading ? <p role="status">{t('common.loading', 'Loading...')}</p>
                    : bundle && page && <div className="grid gap-8 md:grid-cols-[16rem_minmax(0,1fr)]">
                        <nav aria-label={t('publishing.pages', 'Published pages')}>
                            <input type="search" aria-label={t('publishing.search', 'Search published notes')} placeholder={t('publishing.search', 'Search published notes')} maxLength={200} value={search} onChange={event => { setSearch(event.target.value); }} className="mb-4 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm" />
                            <ul className="space-y-1">{matching.map(item => <li key={item.id}><button type="button" onClick={() => { navigate(item.id); }} aria-current={page.id === item.id ? 'page' : undefined} className={`w-full break-words rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--bg-tertiary)] ${page.id === item.id ? 'bg-[var(--bg-secondary)] font-semibold' : ''}`}>{item.title}</button></li>)}</ul>
                            {!matching.length && <p className="text-sm text-[var(--text-tertiary)]">{t('publishing.no_results', 'No matching published notes')}</p>}
                        </nav>
                        <article className="min-w-0"><h2 className="mb-6 text-2xl font-bold">{page.title}</h2><PublishedMarkdown markdown={page.markdown} bundle={bundle} onNavigate={navigate} /></article>
                    </div>}
        </div>
    </main>;
}
