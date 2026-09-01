import type { CSSProperties } from 'react';


export const INPUT_STYLE: CSSProperties = {
    background: 'var(--bg-secondary, #fafafa)',
    border: '1px solid var(--border-primary, #ddd)',
    borderRadius: 6,
    boxSizing: 'border-box',
    color: 'var(--text-primary, #111)',
    fontSize: 13,
    padding: '8px 10px',
    width: '100%',
};


export const BUTTON_STYLE: CSSProperties = {
    alignItems: 'center',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: 13,
    fontWeight: 500,
    justifyContent: 'center',
    padding: '8px 12px',
};


export const LABEL_STYLE: CSSProperties = {
    color: 'var(--text-secondary, #666)',
    fontSize: 12,
    fontWeight: 500,
};


export const toggleSegmentStyle = (active: boolean): CSSProperties => ({
    alignItems: 'center',
    background: active ? 'var(--bg-primary, #fff)' : 'transparent',
    border: 'none',
    borderRadius: 6,
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
    color: active
        ? 'var(--text-primary, #111)'
        : 'var(--text-secondary, #666)',
    cursor: 'pointer',
    display: 'inline-flex',
    flex: 1,
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    justifyContent: 'center',
    padding: '7px 10px',
    transition: 'background 0.15s, box-shadow 0.15s',
});
