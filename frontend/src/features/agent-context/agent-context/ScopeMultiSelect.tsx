import { useTranslation } from 'react-i18next';
import { MultiSelectPills } from '../../../shared/ui/selection/MultiSelectPills';
import type { NamedContextOption } from './agentContextModel';

export function ScopeMultiSelect({ label, options, values, onChange, numeric = false, minimum = 0, disabled = false }: {
    readonly label: string;
    readonly options: readonly NamedContextOption[];
    readonly values: readonly (string | number)[];
    readonly onChange: (values: string[] | number[]) => void;
    readonly numeric?: boolean;
    readonly minimum?: number;
    readonly disabled?: boolean;
}) {
    const { t } = useTranslation();
    return <div className="agent-source-field">
        <span>{label}</span>
        <MultiSelectPills portalZIndex="var(--z-modal-dropdown)" label={label} value={values.map(String)}
            options={options.map(option => String(option.id))}
            idToTitle={Object.fromEntries(options.map(option => [String(option.id), option.name]))}
            placeholder={t('settings.ai.sources.all', 'All')}
            unavailableLabel={disabled ? undefined : t('settings.ai.sources.unavailable', 'Unavailable')}
            emptyMessage={options.length === 0 ? t('settings.ai.sources.no_options', 'No options available.') : t('settings.ai.sources.no_more_matches', 'No more matching options.')}
            minimum={minimum} disabled={disabled}
            onChange={next => {
                const selected = (Array.isArray(next) ? next : [next]).map(String);
                onChange(numeric ? selected.map(Number) : selected);
            }} />
    </div>;
}
