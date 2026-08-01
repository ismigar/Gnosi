import React from 'react';

export function SettingsSectionTabs({ ariaLabel, items, activeId, onChange }) {
    return (
        <nav className="ai-settings-sections settings-section-tabs" aria-label={ariaLabel}>
            {items.map(({ id, icon: Icon, label }) => (
                <button
                    key={id}
                    type="button"
                    className={activeId === id ? 'is-active' : ''}
                    aria-current={activeId === id ? 'page' : undefined}
                    onClick={() => onChange(id)}
                >
                    <Icon size={17} />
                    {label}
                </button>
            ))}
        </nav>
    );
}
