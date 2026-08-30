import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import './SettingsSectionTabs.css';

export interface SettingsSectionItem {
    readonly icon: LucideIcon;
    readonly id: string;
    readonly label: ReactNode;
}

export interface SettingsSectionTabsProps {
    readonly activeId: string;
    readonly ariaLabel: string;
    readonly items: readonly SettingsSectionItem[];
    readonly onChange: (id: string) => void;
}

export function SettingsSectionTabs({
    ariaLabel,
    items,
    activeId,
    onChange,
}: SettingsSectionTabsProps) {
    return (
        <nav className="ai-settings-sections settings-section-tabs" aria-label={ariaLabel}>
            {items.map(({ id, icon: Icon, label }) => (
                <button
                    key={id}
                    type="button"
                    className={activeId === id ? 'is-active' : ''}
                    aria-current={activeId === id ? 'page' : undefined}
                    onClick={() => {
                        onChange(id);
                    }}
                >
                    <Icon size={17} />
                    {label}
                </button>
            ))}
        </nav>
    );
}
