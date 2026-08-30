import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { confirmationDetailRecord, formatConfirmationValue, type AgentConfirmation } from './confirmationModel';

interface Props {
  readonly confirmation: AgentConfirmation;
  readonly summary: string;
}

export function ConfirmationReview({ confirmation, summary }: Props) {
    const { t } = useTranslation();
    const details = Object.entries(confirmation.details || {});
    const renderDetailValue = (key: string, value: unknown): ReactNode => {
        if (key === 'updates' && Array.isArray(value)) {
            return (
                <div style={{ display: 'grid', gap: '6px' }}>
                    {value.map((raw: unknown, index: number) => { const update = confirmationDetailRecord(raw); return (
                        <div key={`${formatConfirmationValue(update.id || 'row')}-${String(index)}`} style={{ padding: '6px 8px', borderRadius: '6px', background: 'var(--bg-secondary)' }}>
                            <strong>{formatConfirmationValue(update.title || update.id || t('chat.confirmations.row_fallback', 'Row {{count}}', { count: index + 1 }))}</strong>
                            {Boolean(update.properties) && <div style={{ marginTop: '2px', fontSize: '0.75rem' }}>{formatConfirmationValue(update.properties)}</div>}
                            {Boolean(update.from) && Boolean(update.to) && (
                                <div style={{ marginTop: '2px', fontSize: '0.75rem' }}>
                                    {formatConfirmationValue(update.from)} → {formatConfirmationValue(update.to)}
                                </div>
                            )}
                        </div>
                    ); })}
                </div>
            );
        }
        return formatConfirmationValue(value);
    };
    return (
        <div>
            <p style={{ margin: '0 0 12px' }}>
                {summary}
            </p>
            {details.length > 0 && (
                <dl style={{
                    display: 'grid',
                    gap: '8px',
                    margin: 0,
                    maxHeight: '45vh',
                    overflowY: 'auto',
                }}>
                    {details.map(([key, value]) => (
                        <div key={key}>
                            <dt style={{
                                color: 'var(--text-primary)',
                                fontWeight: 700,
                                fontSize: '0.72rem',
                            }}>
                                {t(
                                    `chat.confirmations.details.${key}`,
                                    key.replaceAll('_', ' '),
                                )}
                            </dt>
                            <dd style={{
                                margin: '2px 0 0',
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                                fontFamily: key === 'body' || key === 'arguments'
                                    ? 'monospace'
                                    : 'inherit',
                            }}>
                                {renderDetailValue(key, value)}
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
        </div>
    );

}
