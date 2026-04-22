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
        } finally {
            setIsSubmitting(false);
        }
    }, [isSubmitting, onConfirm]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (isSubmitting) return;
                onClose();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirm();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, handleConfirm, isSubmitting]);

    useEffect(() => {
        if (!isOpen) {
            setIsSubmitting(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 99999 }}>
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
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] p-1.5 rounded-lg transition-colors"
                    >
                        <X size={20} />
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
