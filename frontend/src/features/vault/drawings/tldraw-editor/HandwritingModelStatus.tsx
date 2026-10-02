import { useTranslation } from 'react-i18next';
import type { HandwritingStatusResponse } from '../../../../shared/api/drawings';

export function HandwritingModelStatus({ status, onCancel }: {
    readonly status: HandwritingStatusResponse;
    readonly onCancel?: () => Promise<void>;
}) {
    const { t, i18n } = useTranslation();
    const format = new Intl.NumberFormat(i18n?.resolvedLanguage ?? i18n?.language ?? 'en', {
        minimumFractionDigits: 1, maximumFractionDigits: 1,
    });
    return <span className="text-xs" style={{ color: 'var(--text-secondary)' }} role="status">
        {status.error === 'InsufficientDiskSpace' ? t('tldraw.ocr_disk_space')
            : t(`tldraw.ocr_${status.available ? status.state : 'unavailable'}`)}
        {status.state === 'downloading' && <>
            {' · '}{t('tldraw.ocr_size', {
                done: format.format(status.downloaded_bytes / 1024 ** 2),
                total: status.total_bytes == null ? '?' : format.format(status.total_bytes / 1024 ** 2),
            })}
            <button type="button" className="btn-gnosi" disabled={status.cancelling || !onCancel}
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                onClick={() => { void onCancel?.(); }}>
                {t(status.cancelling ? 'tldraw.ocr_cancelling' : 'tldraw.ocr_cancel_download')}
            </button>
        </>}
    </span>;
}
