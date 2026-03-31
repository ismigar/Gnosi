import React, { useRef, useState, useEffect, useCallback } from 'react';
import { AlertCircle, X, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const ConfirmModal = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmText,
    cancelText,
    isDestructive = true
}) => {
    const { t } = useTranslation();
    const displayTitle = title || t('Confirm Action', 'Confirm Action');
    const displayMessage = message || t("Are you sure you want to proceed with this action?", "Are you sure you want to proceed with this action?");
    const displayConfirmText = confirmText || t('Confirm', 'Confirm');
    const displayCancelText = cancelText || t('Cancel', 'Cancel');
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

    // Gestió del teclat més robusta
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
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
            {/* Backdrop amb blur effect unificat de l'app */}
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            ></div>

            {/* Modal Box */}
            <div
                ref={modalRef}
                onClick={(e) => e.stopPropagation()}
                className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden transform transition-all animate-in fade-in zoom-in-95 duration-200 p-6 border border-slate-100"
            >
                <div className="flex justify-between items-start mb-4">
                    <div className={`p-3 rounded-full flex-shrink-0 ${isDestructive ? 'bg-red-50 text-red-500' : 'bg-indigo-50 text-indigo-500'}`}>
                        {isDestructive ? <AlertCircle size={24} /> : <Check size={24} />}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-1.5 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div>
                    <h3 className="text-lg font-semibold text-slate-800 mb-2">
                        {displayTitle}
                    </h3>
                    <p className="text-sm text-slate-500 leading-relaxed mb-6">
                        {displayMessage}
                    </p>
                </div>

                <div className="flex items-center justify-end gap-3 mt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="px-4 py-2 font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors focus:ring-2 focus:ring-slate-100 outline-none"
                    >
                        {displayCancelText}
                    </button>
                    <button
                        autoFocus
                        type="button"
                        onClick={handleConfirm}
                        disabled={isSubmitting}
                        className={`px-4 py-2 font-medium rounded-lg text-white shadow-sm transition-colors focus:ring-2 focus:ring-offset-1 outline-none ${isDestructive
                            ? 'bg-red-500 hover:bg-red-600 focus:ring-red-500/50'
                            : 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-500/50'
                            }`}
                    >
                        {isSubmitting ? '...' : displayConfirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
