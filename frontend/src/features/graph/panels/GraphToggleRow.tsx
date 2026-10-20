import type { ReactNode } from 'react';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';

interface GraphToggleRowProps {
    readonly active: boolean;
    readonly children: ReactNode;
    readonly label?: string;
    readonly onChange: () => void;
}

export function GraphToggleRow({ active, children, label, onChange }: GraphToggleRowProps) {
    return (
        <button type="button" role="switch" aria-checked={active} aria-label={label}
            className="graph-switch-row" onClick={onChange}>
            <GnosiToggle active={active} display />
            <span className="graph-switch-label">{children}</span>
        </button>
    );
}
