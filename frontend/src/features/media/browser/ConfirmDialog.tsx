import {useTranslation} from 'react-i18next';
import {AlertCircle, type LucideIcon} from 'lucide-react';
export interface ConfirmDialogProps {
open: boolean; title?: string; message?: string; confirmLabel?: string | null; cancelLabel?: string | null;
danger?: boolean; Icon?: LucideIcon; onCancel: () => void; onConfirm: () => void;
}
export type MediaConfirmation = Omit<ConfirmDialogProps, 'open' | 'onCancel'>;
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = null,
  cancelLabel = null,
  danger = false,
  Icon = AlertCircle,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onCancel} />
      <div
        className="relative bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200"
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        tabIndex={-1}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className={`p-2 rounded-lg ${danger ? 'bg-red-500/10 text-red-500' : 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]'}`}>
            <Icon size={20} />
          </div>
          <h3 className="text-lg font-bold text-[var(--text-primary)]">{title}</h3>
        </div>
        {message && (
          <p className="text-sm text-[var(--text-secondary)] mb-5">{message}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-[var(--border-primary)] text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-all"
          >
            {cancelLabel || t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className={`px-4 py-2 rounded-lg text-white text-sm font-bold transition-all ${
              danger
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/90'
            }`}
          >
            {confirmLabel || t('media.confirm_ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
