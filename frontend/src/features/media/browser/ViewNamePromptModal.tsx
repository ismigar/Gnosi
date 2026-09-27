import {useModalKeyboard} from '../../../shared/hooks/useModalKeyboard';
import {useState, useEffect, useRef, useId} from 'react';
import {useTranslation} from 'react-i18next';
import {BookmarkPlus} from 'lucide-react';
export function ViewNamePromptModal({ open, defaultValue, onCancel, onConfirm }: {open: boolean; defaultValue?: string; onCancel: () => void; onConfirm: (value: string) => void}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue || '');
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      void Promise.resolve().then(() => { setValue(defaultValue || ''); });
      const timer = setTimeout(() => {
        if (document.activeElement === inputRef.current) inputRef.current?.select();
      }, 50);
      return () => { clearTimeout(timer); };
    }
  }, [open, defaultValue]);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onConfirm(v);
  };

  useModalKeyboard({isOpen: open, onClose: onCancel, onConfirm: submit, confirmDisabled: !value.trim(), containerRef: panelRef, trapFocus: true});
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onCancel} />
      <div
        className="relative bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-[var(--gnosi-primary)]/10 rounded-lg text-[var(--gnosi-primary)]">
            <BookmarkPlus size={20} />
          </div>
          <h3 id={titleId} className="text-lg font-bold text-[var(--text-primary)]">{t('media.save_as_view')}</h3>
        </div>
        <label htmlFor={inputId} className="block text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider mb-2">{t('media.view_name_label')}</label>
        <input
          ref={inputRef}
          type="text"
          value={value}
          id={inputId}
          data-autofocus
          onChange={(e) => { setValue(e.target.value); }}
          placeholder={t('media.view_name_placeholder')}
          className="w-full px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/30 mb-5"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-[var(--border-primary)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-all"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="px-4 py-2 rounded-lg bg-[var(--gnosi-action-bg)] text-white text-sm font-bold hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {t('media.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
