import type { MailComposerController } from './useMailComposerController';


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
  if (!showCloseConfirm) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex animate-in items-center justify-center bg-black/30 backdrop-blur-sm fade-in duration-150">
      <div className="w-[340px] animate-in rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-6 shadow-2xl zoom-in-95 duration-150">
        <h3 className="mb-1 text-[16px] font-bold text-[var(--text-primary)]">
          {t('mail.close_confirm_title')}
        </h3>
        <p className="mb-5 text-[13px] text-[var(--text-secondary)]">
          {t('mail.close_confirm_desc')}
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => { void handleSaveAndClose(); }}
            className="w-full rounded-xl bg-[var(--gnosi-blue)] px-4 py-2.5 text-[14px] font-bold text-white transition-all hover:opacity-90"
          >
            {t('mail.close_save_draft')}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCloseConfirm(false);
              onClose();
            }}
            className="w-full rounded-xl bg-[var(--bg-secondary)] px-4 py-2.5 text-[14px] font-semibold text-[var(--status-error)] transition-all hover:bg-[var(--bg-tertiary)]"
          >
            {t('mail.close_discard')}
          </button>
          <button
            type="button"
            onClick={() => { setShowCloseConfirm(false); }}
            className="w-full rounded-xl px-4 py-2.5 text-[14px] font-semibold text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-secondary)]"
          >
            {t('mail.close_cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
