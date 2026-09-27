import { useId, useRef } from 'react';
import type { MailComposerController } from './useMailComposerController';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';


interface MailComposerDialogsProps {
  readonly controller: MailComposerController;
}


export function MailComposerDialogs({ controller }: MailComposerDialogsProps) {
  const {
    handleSaveAndClose,
    onClose,
    setShowCloseConfirm,
    showCloseConfirm,
    t,
  } = controller;
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalKeyboard({ isOpen: showCloseConfirm, onClose: () => { setShowCloseConfirm(false); }, containerRef: panelRef, trapFocus: true });
  if (!showCloseConfirm) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex animate-in items-center justify-center bg-black/30 backdrop-blur-sm fade-in duration-150">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-[340px] max-w-[calc(100vw-2rem)] animate-in rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-6 shadow-2xl zoom-in-95 duration-150">
        <h3 id={titleId} className="mb-1 text-[16px] font-bold text-[var(--text-primary)]">
          {t('mail.close_confirm_title')}
        </h3>
        <p className="mb-5 text-[13px] text-[var(--text-secondary)]">
          {t('mail.close_confirm_desc')}
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => { void handleSaveAndClose(); }}
            className="w-full rounded-xl bg-[var(--gnosi-action-bg)] px-4 py-2.5 text-[14px] font-bold text-white transition-all hover:opacity-90"
          >
            {t('mail.close_save_draft')}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCloseConfirm(false);
              onClose();
            }}
            className="w-full rounded-xl bg-[var(--bg-secondary)] px-4 py-2.5 text-[14px] font-semibold text-[var(--status-error-text)] transition-all hover:bg-[var(--bg-tertiary)]"
          >
            {t('mail.close_discard')}
          </button>
          <button
            type="button"
            onClick={() => { setShowCloseConfirm(false); }}
            data-autofocus
            className="w-full rounded-xl px-4 py-2.5 text-[14px] font-semibold text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-secondary)]"
          >
            {t('mail.close_cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
