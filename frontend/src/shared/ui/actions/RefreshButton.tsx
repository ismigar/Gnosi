import type { ButtonHTMLAttributes } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './RefreshButton.css';

/** Shared refresh action, placed at the right end of the section header. */
export function RefreshButton({ label, loading = false, disabled, className = '', ...props }:
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { readonly label?: string; readonly loading?: boolean }) {
    const { t } = useTranslation();
    const description = label || t('common.refresh', 'Refresh');
    return <button {...props} type="button" className={`gnosi-refresh-button ${className}`} title={description} aria-label={description} aria-busy={loading} disabled={disabled || loading}>
        <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
    </button>;
}
