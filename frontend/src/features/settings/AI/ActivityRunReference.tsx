import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { writeClipboardText } from '../../../shared/platform/clipboard';
import { toast } from '../../../shared/notifications/toast';

export function ActivityRunReference({ id, name, diagnostic }: {
    readonly id: string; readonly name: string; readonly diagnostic?: string | null;
}) {
    const { t } = useTranslation();
    const reference = id.slice(id.indexOf(':') + 1);
    const copy = async () => {
        try {
            await writeClipboardText(`${name}\n${t('activity.run_reference')}: ${reference}${diagnostic ? `\n${diagnostic}` : ''}`);
            toast.success(t('activity.reference_copied'));
        } catch { toast.error(t('activity.reference_copy_failed')); }
    };
    return <details>
        <summary>{t('activity.reference_and_diagnostics')}</summary>
        <p>{t('activity.run_reference_help')}</p>
        <div className="ai-resource-card__actions"><span>{t('activity.run_reference')}: <code>{reference}</code></span>
            <button type="button" title={t('activity.copy_reference')} aria-label={t('activity.copy_reference')} onClick={() => { void copy(); }}><Copy size={14} aria-hidden="true" /></button>
        </div>
        {diagnostic && <><p>{t('activity.original_message')}</p><pre>{diagnostic}</pre></>}
    </details>;
}
