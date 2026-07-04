import React from 'react';
import { useActiveVaultName } from '../hooks/useActiveVaultName';

export function AppHeader({ icon: Icon, title, children }) {
    const activeVaultName = useActiveVaultName();
    return (
        <header className="app-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingRight: '16px' }}>
            <div className="app-header__title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {Icon && <Icon size={18} className="text-[var(--text-secondary)]" strokeWidth={2} />}
                <span>{title}</span>
                <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    color: 'var(--text-tertiary)',
                    backgroundColor: 'var(--bg-secondary)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-primary)',
                    marginLeft: '4px'
                }}>
                    Vault: {activeVaultName || '…'}
                </span>
            </div>
            <div className="app-header__custom" style={{ marginLeft: 'auto', marginTop: '15px' }}>
                {children}
            </div>
        </header>
    );
}
