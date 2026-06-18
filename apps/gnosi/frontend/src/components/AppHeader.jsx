import React from 'react';

export function AppHeader({ icon: Icon, title, children }) {
    return (
        <header className="app-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingRight: '16px' }}>
            <div className="app-header__title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {Icon && <Icon size={18} className="text-[var(--text-secondary)]" strokeWidth={2} />}
                <span>{title}</span>
            </div>
            <div className="app-header__custom" style={{ marginLeft: 'auto', marginTop: '15px' }}>
                {children}
            </div>
        </header>
    );
}
