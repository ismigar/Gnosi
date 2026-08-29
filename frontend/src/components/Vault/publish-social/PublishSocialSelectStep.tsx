import type { Dispatch } from 'react';
import { useTranslation } from 'react-i18next';

import type {
    PublishSocialAction,
    PublishSocialState,
} from './publishSocialModel';


export interface PublishSocialSelectStepProps {
    readonly busy: boolean;
    readonly dispatch: Dispatch<PublishSocialAction>;
    readonly noteId?: string | null;
    readonly state: PublishSocialState;
}


export function PublishSocialSelectStep({
    busy,
    dispatch,
    noteId,
    state,
}: PublishSocialSelectStepProps) {
    const { t } = useTranslation();
    return <>
        {!noteId ? <div className="space-y-2">
            <input
                className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                onChange={(event) => { dispatch({
                    type: 'source-title-changed',
                    value: event.target.value,
                }); }}
                placeholder={t('social.source_title_ph', 'Title or topic (optional)')}
                type="text"
                value={state.sourceTitle}
            />
            <textarea
                className="w-full resize-y rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                onChange={(event) => { dispatch({
                    type: 'source-content-changed',
                    value: event.target.value,
                }); }}
                placeholder={t('social.source_content_ph', 'Content you want to share…')}
                rows={4}
                value={state.sourceContent}
            />
        </div> : <p className="text-xs text-[var(--text-secondary)]/80">
            {t('social.from_record', {
                defaultValue: 'Source: "{{title}}". AI will suggest a text for each network in the same language.',
                title: state.sourceTitle || '—',
            })}
        </p>}
        <div>
            <p className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">
                {t('social.pick_networks', 'Networks to publish to')}
            </p>
            <div className="grid grid-cols-2 gap-2">
                {state.networks.map((network) => {
                    const selected = state.selected.has(network.id);
                    const disabled = !network.configured;
                    return <label
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${disabled ? 'cursor-not-allowed border-[var(--border-primary)] opacity-50' : selected ? 'cursor-pointer border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10 font-semibold text-[var(--gnosi-primary)]' : 'cursor-pointer border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'}`}
                        key={network.id}
                        title={disabled
                            ? t('social.not_configured', 'Not configured — connect it in Settings')
                            : ''}
                    >
                        <input
                            checked={selected}
                            className="h-3.5 w-3.5"
                            disabled={disabled || busy}
                            onChange={() => { dispatch({
                                network: network.id,
                                type: 'toggle-network',
                            }); }}
                            type="checkbox"
                        />
                        <span>{network.icon}</span>
                        <span className="flex-1">{network.name}</span>
                        {disabled ? <span className="text-[10px] uppercase text-[var(--text-tertiary)]">
                            {t('social.off', 'Off')}
                        </span> : null}
                    </label>;
                })}
            </div>
        </div>
        <input
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
            onChange={(event) => { dispatch({
                type: 'hint-changed',
                value: event.target.value,
            }); }}
            placeholder={t('social.hint_ph', 'Instruction for the AI (optional): tone, emphasis…')}
            type="text"
            value={state.hint}
        />
    </>;
}
