import { useState } from 'react';
import { Copy, ExternalLink, Eye, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { fetchVaultPage } from '../../../../shared/api/vaults';
import { toast } from '../../../../shared/notifications/toast';
import { openBrowserWindow } from '../../../../shared/platform/browser-events';

interface PageActionsPanelProps {
    readonly onClose: () => void;
    readonly pageId: string;
    readonly pageTitle: string;
}

export function PageActionsPanel({
    onClose,
    pageId,
    pageTitle,
}: PageActionsPanelProps) {
    const { t } = useTranslation();
    const [preview, setPreview] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const loadPreview = async (): Promise<void> => {
        if (loading) return;
        setLoading(true);
        try {
            const page = await fetchVaultPage(pageId);
            setPreview(page.content || t('editor.no_content'));
        } catch {
            toast.error(t('tldraw.load_content_error'));
        } finally {
            setLoading(false);
        }
    };

    const copyId = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(pageId);
            toast.success(t('tldraw.id_copied'));
        } catch {
            toast.error(t('tldraw.id_copy_error'));
        }
    };

    return (
        <div
            className="absolute top-2 left-2 z-50 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden"
            style={{ minWidth: 280 }}
        >
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
                <span className="text-xs font-semibold text-slate-700 truncate">
                    {pageTitle}
                </span>
                <button
                    type="button"
                    onClick={onClose}
                    className="text-slate-400 hover:text-slate-600"
                    aria-label={t('common.close')}
                >
                    <X size={14} />
                </button>
            </div>
            <div className="flex gap-1 p-2">
                <button
                    type="button"
                    onClick={() => {
                        void loadPreview();
                    }}
                    disabled={loading}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                >
                    {loading
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Eye size={14} />}
                    {t('tldraw.preview')}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        openBrowserWindow(`/vault?page=${pageId}`, '_blank');
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-green-50 hover:text-green-600 transition-colors"
                >
                    <ExternalLink size={14} />
                    {t('common.open')}
                </button>
                <button
                    type="button"
                    onClick={() => {
                        void copyId();
                    }}
                    className="px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 rounded-md hover:bg-slate-100 transition-colors"
                    aria-label={t('tldraw.copy_id')}
                >
                    <Copy size={14} />
                </button>
            </div>
            {preview !== null && (
                <div className="border-t border-slate-200 max-h-[200px] overflow-y-auto p-3">
                    <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                        {preview.substring(0, 500) || t('editor.no_content')}
                        {preview.length > 500 && '...'}
                    </p>
                </div>
            )}
        </div>
    );
}
