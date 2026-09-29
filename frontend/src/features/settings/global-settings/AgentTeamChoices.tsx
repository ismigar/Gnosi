import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';

interface Props {
    label: string;
    options: { id: string; label: string; disabled?: boolean }[];
    value: string[];
    emptyLabel: string;
    onChange: (value: string[]) => void;
}

export function AgentTeamChoices({ label, options, value, emptyLabel, onChange }: Props) {
    return <div role="group" aria-label={label} className="agent-team-setup__choices">
        {options.length ? options.map(option => <label className="agent-team-setup__row" key={option.id}>
            <span>{option.label}</span>
            <GnosiToggle label={option.label} active={value.includes(option.id)} disabled={option.disabled && !value.includes(option.id)}
                onChange={() => { onChange(value.includes(option.id) ? value.filter(id => id !== option.id) : [...value, option.id]); }} />
        </label>) : <p className="settings-desc">{emptyLabel}</p>}
    </div>;
}
