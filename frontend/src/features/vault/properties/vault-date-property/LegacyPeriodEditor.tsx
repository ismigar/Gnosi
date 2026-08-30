import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { parsePeriod, periodDaysInclusive } from '../../../../shared/dates/projectPlanning';
import { addDaysISO } from './dateModel';
import type { PeriodEditorProps } from './types';

type LegacyPeriodEditorProps = Pick<PeriodEditorProps, 'onChange' | 'value'>;

export function LegacyPeriodEditor({
    onChange,
    value,
}: LegacyPeriodEditorProps) {
    const { t } = useTranslation();
    const { start, end } = parsePeriod(value);
    const days = periodDaysInclusive(start, end);
    const handleDaysChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const nextDays = Number.parseInt(event.target.value, 10);
        if (!start || !Number.isFinite(nextDays) || nextDays < 1) return;
        onChange(`${start}/${addDaysISO(start, nextDays - 1)}`);
    };

    return (
        <div className="flex items-center gap-1 w-full">
            <div className="flex-1 relative group">
                <input
                    type="text"
                    value={start || ''}
                    onChange={(event) => {
                        onChange(`${event.target.value}/${end || ''}`);
                    }}
                    className="w-full bg-transparent hover:bg-[var(--bg-tertiary)] text-xs rounded px-1 transition-colors outline-none cursor-pointer"
                />
            </div>
            <span className="text-[var(--text-tertiary)]">→</span>
            <div className="flex-1 relative group">
                <input
                    type="text"
                    value={end || ''}
                    onChange={(event) => {
                        onChange(`${start || ''}/${event.target.value}`);
                    }}
                    className="w-full bg-transparent hover:bg-[var(--bg-tertiary)] text-xs rounded px-1 transition-colors outline-none cursor-pointer"
                />
            </div>
            <input
                type="number"
                min="1"
                value={days ?? ''}
                onChange={handleDaysChange}
                disabled={!start}
                placeholder={t('vault_date.days_placeholder', 'days')}
                title={t(
                    'vault_date.days_count_hint',
                    'Number of days (recalculates the end date)',
                )}
                className="w-12 shrink-0 bg-transparent hover:bg-[var(--bg-tertiary)] text-xs text-right rounded px-1 transition-colors outline-none disabled:opacity-40 disabled:cursor-not-allowed"
            />
            <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
                {t('vault_date.days_unit', 'd')}
            </span>
        </div>
    );
}
