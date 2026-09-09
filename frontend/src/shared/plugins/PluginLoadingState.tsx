import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {PluginsState} from './usePlugins';

interface Props {
    readonly state: Pick<PluginsState, 'loadError' | 'reload'>;
    readonly fullPage?: boolean;
}

/** Keep the gate closed until the active vault's plugin state is available. */
export function PluginLoadingState({state, fullPage = false}: Props) {
    const {t} = useTranslation();
    const [retrying, setRetrying] = useState(false);
    const retry = async () => {
        if (retrying) return;
        setRetrying(true);
        try {
            await state.reload();
        } finally {
            setRetrying(false);
        }
    };

    return (
        <div
            className={fullPage
                ? 'flex h-screen items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
                : 'gnosi-route-skeleton'}
            role={state.loadError ? 'alert' : 'status'}
            aria-live="polite"
        >
            {state.loadError ? (
                <div className="flex max-w-lg flex-col items-center gap-4 px-6 text-center">
                    <p>{t('settings.plugins.llm_wiki_load_error', 'The configuration could not be loaded. Please retry.')}</p>
                    <button type="button" className="btn-gnosi btn-gnosi-primary"
                        disabled={retrying} aria-busy={retrying}
                        onClick={() => {void retry();}}>
                        {retrying ? t('common.loading', 'Loading...') : t('common.retry', 'Retry')}
                    </button>
                </div>
            ) : (
                <span className="animate-pulse text-sm">{t('common.loading', 'Loading...')}</span>
            )}
        </div>
    );
}
