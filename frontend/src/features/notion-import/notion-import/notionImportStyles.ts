import type { CSSProperties } from 'react';


export const CARD_STYLE: CSSProperties = {
    background: 'var(--settings-sidebar-bg)',
    border: '1px solid var(--settings-border)',
    borderRadius: 24,
    marginTop: 32,
    padding: 24,
};


export const INPUT_STYLE: CSSProperties = {
    background: 'var(--bg-primary)',
    border: '1px solid var(--settings-border)',
    borderRadius: 10,
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    padding: '9px 12px',
};


export const SMALL_BUTTON_STYLE: CSSProperties = {
    ...INPUT_STYLE,
    alignItems: 'center',
    cursor: 'pointer',
    display: 'inline-flex',
    gap: 8,
};


export const MUTED_TEXT_STYLE: CSSProperties = {
    color: 'var(--text-secondary)',
    fontSize: '0.82rem',
};
