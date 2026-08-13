/**
 * CollaborationPresence — avatars of the other users on the same page.
 *
 * Mounted in the BlockEditor's title bar. Renders nothing if:
 *   - we are not in org mode (single user), or
 *   - there is no one else on the page.
 * So, in everyday personal use, it is invisible and has no cost.
 */
import React from 'react';
import { useCollaboration } from '../../hooks/useCollaboration';

// Stable palette derived from the name so each user always has the same
// color (no shared state). Simple hash → palette index.
const AVATAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

function colorFor(id) {
    let hash = 0;
    const s = String(id || '');
    for (let i = 0; i < s.length; i += 1) {
        hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    }
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function CollaborationPresence({ pageId }) {
    const { peers, enabled } = useCollaboration(pageId);

    if (!enabled || peers.length === 0) return null;

    const names = peers.map((p) => p.name).join(', ');
    const verb = peers.length === 1 ? 'està editant' : 'estan editant';
    const shown = peers.slice(0, 3);
    const extra = peers.length - shown.length;

    return (
        <div
            title={`${names} ${verb}`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
            <div style={{ display: 'flex' }}>
                {shown.map((p, i) => (
                    <span
                        key={p.id}
                        style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: colorFor(p.id),
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            fontWeight: 700,
                            border: '2px solid var(--bg-primary)',
                            marginLeft: i === 0 ? 0 : '-8px',
                            userSelect: 'none',
                        }}
                    >
                        {initials(p.name)}
                    </span>
                ))}
            </div>
            {extra > 0 && (
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>+{extra}</span>
            )}
        </div>
    );
}

export default CollaborationPresence;
