import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AlertCircle, X, Check } from 'lucide-react';

export const ConfirmModal = ({
    isOpen,
    onClose,
    onConfirm,
    title = "Confirmar acció",
    message = "N'estàs segur que vols procedir amb aquesta acció?",
    confirmText = "Confirmar",
    cancelText = "Cancel·lar",
    isDestructive = true
}) => {
    const modalRef = useRef(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleConfirm = useCallback(async () => {
        if (isSubmitting) return;
        try {
            setIsSubmitting(true);
            await onConfirm();
        } catch (err) {
            console.error('[ConfirmModal] Error en onConfirm:', err);
        } finally {
            setIsSubmitting(false);
        }
    }, [isSubmitting, onConfirm]);

    useEffect(() => {
        if (!isOpen) return;

        // Save the previously focused element so we can restore focus when
        // the modal closes (accessibility best practice — keyboard users
        // should return to where they were).
        const previouslyFocused = document.activeElement;

        const getFocusable = () => {
            if (!modalRef.current) return [];
            return Array.from(
                modalRef.current.querySelectorAll(
                    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
            );
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (isSubmitting) return;
                onClose();
                return;
            }
            if (e.key === 'Enter') {
                // Only trigger Enter→confirm when focus is INSIDE the modal
                // (otherwise pressing Enter on a background input could
                // accidentally fire a destructive action).
                if (modalRef.current?.contains(document.activeElement)) {
                    e.preventDefault();
                    handleConfirm();
                }
                return;
            }
            // Focus trap on Tab: cycle within the modal.
            if (e.key === 'Tab') {
                const items = getFocusable();
                if (items.length === 0) return;
                const first = items[0];
                const last = items[items.length - 1];
                const active = document.activeElement;
                if (e.shiftKey) {
                    if (active === first || !modalRef.current?.contains(active)) {
                        e.preventDefault();
                        last.focus();
                    }
                } else {
                    if (active === last || !modalRef.current?.contains(active)) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            // Restore focus to the trigger element on close.
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                try { previouslyFocused.focus(); } catch { /* element gone */ }
            }
        };
    }, [isOpen, onClose, handleConfirm, isSubmitting]);

    useEffect(() => {
        if (!isOpen) {
            setIsSubmitting(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleBackdropClick = () => {
        if (isSubmitting) return; // never abort an in-flight destructive op
        onClose();
    };

    return (
        <div
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex: 99999 }}
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
        >
            <div className="absolute inset-0 bg-[var(--bg-primary)]/40 backdrop-blur-sm transition-opacity" />

            <div
                ref={modalRef}
                onClick={(e) => e.stopPropagation()}
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
                        aria-label="Tancar"
                    >
                        <X />
                    </button>
                </div>

                <div>
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                        {title}
                    </h3>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
                        {message}
                    </p>
                </div>

                <div className="flex items-center justify-end gap-3 mt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="px-4 py-2 font-medium text-[var(--text-secondary)] border border-[var(--border-primary)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors focus:ring-2 focus:ring-[var(--border-primary)] outline-none"
                    >
                        {cancelText}
                    </button>
                    <button
                        autoFocus
                        type="button"
                        onClick={handleConfirm}
                        disabled={isSubmitting}
                        className={`px-4 py-2 font-medium rounded-lg text-white shadow-sm transition-colors focus:ring-2 focus:ring-offset-1 outline-none ${isDestructive
                            ? 'bg-[var(--status-error)] hover:opacity-90 focus:ring-[var(--status-error)]/50'
                            : 'bg-[var(--gnosi-blue)] hover:opacity-90 focus:ring-[var(--gnosi-blue)]/50'
                            }`}
                    >
                        {isSubmitting ? '...' : confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
