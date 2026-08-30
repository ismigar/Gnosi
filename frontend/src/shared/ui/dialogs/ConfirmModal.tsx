import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, X, Check } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

export interface ConfirmModalProps {
    readonly acknowledgementLabel?: ReactNode;
    readonly autofocusConfirm?: boolean;
    readonly cancelText?: ReactNode;
    readonly children?: ReactNode;
    readonly confirmOnEnter?: boolean;
    readonly confirmText?: ReactNode;
    readonly isDestructive?: boolean;
    readonly isOpen: boolean;
    readonly message?: ReactNode;
    readonly onClose: () => void;
    readonly onConfirm: () => unknown;
    readonly requireAcknowledgement?: boolean;
    readonly title?: ReactNode;
}

export const ConfirmModal = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText,
    cancelText,
    isDestructive = true,
    confirmOnEnter = true,
    autofocusConfirm = true,
    requireAcknowledgement = false,
    acknowledgementLabel,
    children,
}: ConfirmModalProps) => {
    const { t } = useTranslation();
    // Localized fallbacks: callers may omit these props; default to i18n instead
    // of hardcoded Catalan so the dialog is never partially untranslated. `??`
    // (not `||`) so an explicit empty string from a caller is respected.
    const resolvedTitle = title ?? t('common.confirm_action', "Confirm action");
    const resolvedMessage = message ?? t('common.confirm_action_msg', "Are you sure you want to proceed with this action?");
    const resolvedConfirmText = confirmText ?? t('common.confirm', "Confirm");
    const resolvedCancelText = cancelText ?? t('common.cancel', "Cancel");
    const modalRef = useRef<HTMLDivElement | null>(null);
    const titleId = useId();
    const messageId = useId();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isAcknowledged, setIsAcknowledged] = useState(false);

    const handleConfirm = useCallback(async () => {
        if (isSubmitting) return;
        try {
            setIsSubmitting(true);
            await onConfirm();
        } catch (err) {
            console.error('[ConfirmModal] Error in onConfirm:', err);
        } finally {
            setIsSubmitting(false);
        }
    }, [isSubmitting, onConfirm]);

    // Rich keyboard logic (Esc, Enter→confirm, Tab focus-trap, restoration
    // of focus on close): now centralized in the canonical hook. Esc does not abort an
    // ongoing destructive operation (isSubmitting guard), same as the backdrop.
    useModalKeyboard({
        isOpen,
        onClose: () => {
            if (!isSubmitting) onClose();
        },
        onConfirm: confirmOnEnter ? handleConfirm : null,
        confirmDisabled: isSubmitting || (requireAcknowledgement && !isAcknowledged),
        containerRef: modalRef,
        trapFocus: true,
    });

    useEffect(() => {
        if (isOpen) return undefined;
        const resetId = setTimeout(() => {
            setIsSubmitting(false);
            setIsAcknowledged(false);
        }, 0);
        return () => {
            clearTimeout(resetId);
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const handleBackdropClick = () => {
        if (isSubmitting) return; // never abort an in-flight destructive op
        onClose();
    };

    return (
        <div
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex: 'var(--z-confirm-modal)' }}
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={messageId}
        >
            <div className="absolute inset-0 bg-[var(--bg-primary)]/40 backdrop-blur-sm transition-opacity" />

            <div
                ref={modalRef}
                onClick={(event) => {
                    event.stopPropagation();
                }}
                className="relative bg-[var(--bg-primary)] rounded-2xl shadow-xl w-full max-w-sm overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200 p-6 border border-[var(--border-primary)]"
            >
                <div className="flex justify-between items-start mb-4">
                    <div className={`p-3 rounded-full flex-shrink-0 ${isDestructive ? 'bg-[var(--bg-secondary)] text-[var(--status-error)]' : 'bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)]'}`}>
                        {isDestructive ? <AlertCircle size={24} /> : <Check size={24} />}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="gnosi-close-btn"
                        aria-label={t('common.close', "Close")}
                    >
                        <X />
                    </button>
                </div>

                <div>
                    <h3 id={titleId} className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                        {resolvedTitle}
                    </h3>
                    <div id={messageId} className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
                        {resolvedMessage}
                    </div>
                </div>

                {children}

                {requireAcknowledgement && (
                    <label className="flex items-start gap-2 mb-4 text-sm text-[var(--text-secondary)] cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isAcknowledged}
                            onChange={(event) => {
                                setIsAcknowledged(event.target.checked);
                            }}
                            disabled={isSubmitting}
                            className="mt-0.5"
                        />
                        <span>{acknowledgementLabel ?? t('common.confirm_acknowledgement', 'I have reviewed this action and want to continue.')}</span>
                    </label>
                )}

                <div className="flex items-center justify-end gap-3 mt-2">
                    <button
                        {...(!autofocusConfirm ? { 'data-autofocus': 'true' } : {})}
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="px-4 py-2 font-medium text-[var(--text-secondary)] border border-[var(--border-primary)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors focus:ring-2 focus:ring-[var(--border-primary)] outline-none"
                    >
                        {resolvedCancelText}
                    </button>
                    <button
                        {...(autofocusConfirm ? { 'data-autofocus': 'true' } : {})}
                        type="button"
                        onClick={() => {
                            void handleConfirm();
                        }}
                        disabled={isSubmitting || (requireAcknowledgement && !isAcknowledged)}
                        className={`px-4 py-2 font-medium rounded-lg text-white shadow-sm transition-colors focus:ring-2 focus:ring-offset-1 outline-none ${isDestructive
                            ? 'bg-[var(--status-error)] hover:opacity-90 focus:ring-[var(--status-error)]/50'
                            : 'bg-[var(--gnosi-blue)] hover:opacity-90 focus:ring-[var(--gnosi-blue)]/50'
                            }`}
                    >
                        {isSubmitting ? '...' : resolvedConfirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
