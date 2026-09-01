import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

export default function StatusBadge({ status }: { status?: string }) {
    const { t } = useTranslation();
    const icons: Record<string, ReactNode> = {
        pending: <LoaderCircle size={13} className="animate-spin" />,
        indexing: <LoaderCircle size={13} className="animate-spin" />,
        available: <CheckCircle2 size={13} />,
        stale: <RefreshCw size={13} />,
        error: <AlertCircle size={13} />,
    };
    const icon = icons[status ?? ''] || <LoaderCircle size={13} />;
    return (
        <span className={`notebook-status notebook-status--${status || 'pending'}`}>
            {icon}
            {t(`notebooks.status.${status || 'pending'}`, status || 'Pending')}
        </span>
    );
}
