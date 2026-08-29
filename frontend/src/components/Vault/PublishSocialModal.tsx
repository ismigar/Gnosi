import { useRef } from 'react';
import { ArrowLeft, Loader2, Send, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { PublishSocialComposeStep } from './publish-social/PublishSocialComposeStep';
import { PublishSocialSelectStep } from './publish-social/PublishSocialSelectStep';
import type { SocialResult } from './publish-social/publishSocialModel';
import { usePublishSocialController } from './publish-social/usePublishSocialController';


export interface PublishSocialModalProps {
    readonly isOpen: boolean;
    readonly noteId?: string | null;
    readonly onClose: () => void;
    readonly onPublished?: (result: SocialResult) => void;
    readonly recordMetadata?: Readonly<Record<string, unknown>>;
}


export function PublishSocialModal(props: PublishSocialModalProps) {
    if (!props.isOpen) return null;
    return <PublishSocialDialog {...props} />;
}


function PublishSocialDialog({
    noteId = null,
    onClose,
    onPublished,
    recordMetadata = {},
}: PublishSocialModalProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const controller = usePublishSocialController({
        noteId,
        onClose,
        onPublished,
        recordMetadata,
    });
    const { busy, dispatch, state } = controller;
    useModalKeyboard({
        containerRef,
        isOpen: true,
        onClose,
        trapFocus: true,
    });

    return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 font-sans backdrop-blur-sm">
        <div
            aria-label={t('social.publish_title', 'Publish to social media')}
            aria-modal="true"
            className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl"
            ref={containerRef}
            role="dialog"
        >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-5 py-3">
                <h2 className="flex items-center gap-2 text-base font-bold text-[var(--text-primary)]">
                    <Send className="text-[var(--gnosi-primary)]" size={18} />
                    {t('social.publish_title', 'Publish to social media')}
                </h2>
                <button
                    aria-label={t('common.close', 'Close')}
                    className="gnosi-close-btn"
                    disabled={busy}
                    onClick={onClose}
                    type="button"
                >
                    <X />
                </button>
            </div>
            <div className="space-y-4 overflow-y-auto p-5">
                {state.step === 'select' ? <PublishSocialSelectStep
                    busy={busy}
                    dispatch={dispatch}
                    noteId={noteId}
                    state={state}
                /> : <PublishSocialComposeStep
                    busy={busy}
                    charLimitFor={controller.charLimitFor}
                    dispatch={dispatch}
                    iconFor={(network) => controller.networkById.get(network)?.icon ?? '🌐'}
                    nameFor={controller.nameFor}
                    onRegenerate={(network) => { void controller.regenerate(network); }}
                    overLimitNetworks={controller.overLimitNetworks}
                    selectedNetworks={controller.selectedNetworks}
                    state={state}
                />}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] px-5 py-3">
                {state.step === 'select' ? <>
                    <button
                        className="rounded-md border border-[var(--border-primary)] px-4 py-2 text-sm font-bold text-[var(--text-secondary)]/80 transition-colors hover:bg-[var(--bg-primary)] disabled:opacity-50"
                        disabled={busy}
                        onClick={onClose}
                        type="button"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        className="btn-gnosi btn-gnosi-primary flex items-center gap-2 px-5 disabled:opacity-50"
                        disabled={busy || state.selected.size === 0}
                        onClick={() => { void controller.generate(); }}
                        type="button"
                    >
                        {state.composing
                            ? <Loader2 className="animate-spin" size={14} />
                            : <Sparkles size={14} />}
                        {t('social.generate', 'Generate with AI')}
                    </button>
                </> : <>
                    <button
                        className="flex items-center gap-1 rounded-md border border-[var(--border-primary)] px-3 py-2 text-sm font-bold text-[var(--text-secondary)]/80 transition-colors hover:bg-[var(--bg-primary)] disabled:opacity-50"
                        disabled={busy}
                        onClick={() => { dispatch({ type: 'step-changed', value: 'select' }); }}
                        type="button"
                    >
                        <ArrowLeft size={14} />{t('common.back', 'Back')}
                    </button>
                    <button
                        className="btn-gnosi btn-gnosi-primary flex items-center gap-2 px-5 disabled:opacity-50"
                        disabled={busy || controller.overLimitNetworks.length > 0}
                        onClick={() => {
                            if (state.scheduleOpen) void controller.schedule();
                            else void controller.publish();
                        }}
                        type="button"
                    >
                        {state.publishing
                            ? <Loader2 className="animate-spin" size={14} />
                            : <Send size={14} />}
                        {state.scheduleOpen
                            ? t('social.schedule_submit', 'Schedule')
                            : t('social.publish_submit', 'Publish now')}
                    </button>
                </>}
            </div>
        </div>
    </div>;
}


export default PublishSocialModal;
