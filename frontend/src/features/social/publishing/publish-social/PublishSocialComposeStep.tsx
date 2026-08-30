import type { Dispatch } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
    PublishSocialAction,
    PublishSocialState,
} from './publishSocialModel';


export interface PublishSocialComposeStepProps {
    readonly busy: boolean;
    readonly charLimitFor: (network: string) => number;
    readonly dispatch: Dispatch<PublishSocialAction>;
    readonly iconFor: (network: string) => string;
    readonly nameFor: (network: string) => string;
    readonly onRegenerate: (network: string) => void;
    readonly overLimitNetworks: readonly string[];
    readonly selectedNetworks: readonly string[];
    readonly state: PublishSocialState;
}


export function PublishSocialComposeStep({
    busy,
    charLimitFor,
    dispatch,
    iconFor,
    nameFor,
    onRegenerate,
    overLimitNetworks,
    selectedNetworks,
    state,
}: PublishSocialComposeStepProps) {
    const { t } = useTranslation();
    return <div className="space-y-3">
        {selectedNetworks.filter((network) => state.proposals[network]).map((network) => {
            const limit = charLimitFor(network);
            const draft = state.drafts[network] ?? '';
            const overLimit = draft.length > limit;
            return <div
                className="overflow-hidden rounded-lg border border-[var(--border-primary)]"
                key={network}
            >
                <div className="flex items-center justify-between bg-[var(--bg-secondary)] px-3 py-1.5">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                        <span>{iconFor(network)}</span>{nameFor(network)}
                    </span>
                    <div className="flex items-center gap-2">
                        <span className={`text-[11px] tabular-nums ${overLimit ? 'font-bold text-red-500' : 'text-[var(--text-tertiary)]'}`}>
                            {String(draft.length)}/{String(limit)}
                        </span>
                        <button
                            className="p-1 text-[var(--text-tertiary)] transition-colors hover:text-[var(--gnosi-primary)] disabled:opacity-50"
                            disabled={state.regeneratingNetwork === network || busy}
                            onClick={() => { onRegenerate(network); }}
                            title={t('social.regenerate', 'Regenerate')}
                            type="button"
                        >
                            {state.regeneratingNetwork === network
                                ? <Loader2 className="animate-spin" size={14} />
                                : <RefreshCw size={14} />}
                        </button>
                    </div>
                </div>
                <textarea
                    className={`w-full resize-y bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none ${overLimit ? 'border-t border-red-500/40' : ''}`}
                    onChange={(event) => { dispatch({
                        network,
                        type: 'draft-changed',
                        value: event.target.value,
                    }); }}
                    rows={4}
                    value={draft}
                />
            </div>;
        })}
        {overLimitNetworks.length > 0 ? <p className="flex items-center gap-1 text-[11px] text-red-500">
            <AlertTriangle size={12} />
            {t(
                'social.over_limit_hint',
                'Some text exceeds the limit. Shorten it before publishing.',
            )}
        </p> : null}
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input
                checked={state.scheduleOpen}
                disabled={busy}
                onChange={(event) => { dispatch({
                    type: 'schedule-open-changed',
                    value: event.target.checked,
                }); }}
                type="checkbox"
            />
            {t('social.schedule_later', 'Schedule for later')}
        </label>
        {state.scheduleOpen ? <input
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            disabled={busy}
            onChange={(event) => { dispatch({
                type: 'scheduled-at-changed',
                value: event.target.value,
            }); }}
            type="datetime-local"
            value={state.scheduledAt}
        /> : null}
    </div>;
}
