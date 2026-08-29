import type { CSSProperties } from 'react';

export const inputStyle: CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '8px',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    color: 'var(--text-primary)',
    fontSize: '14px',
    outline: 'none',
    transition: 'all 0.2s',
    marginTop: '6px',
};

export const selectStyle: CSSProperties = {
    ...inputStyle,
    width: 'auto',
    minWidth: '100px',
    cursor: 'pointer',
};

export const labelStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--text-tertiary)',
    opacity: 0.8,
};

export const sectionTitleStyle: CSSProperties = {
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--text-tertiary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
};
