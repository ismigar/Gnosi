/**
 * CollaborationPresence — avatars dels altres usuaris a la mateixa pàgina.
 *
 * Es munta a la barra de títol del BlockEditor. No renderitza res si:
 *   - no estem en mode org (un sol usuari), o
 *   - no hi ha ningú més a la pàgina.
 * Així, en l'ús personal habitual, és invisible i sense cost.
 */
import React from 'react';
import { useCollaboration } from '../../hooks/useCollaboration';

// Paleta estable derivada del nom perquè cada usuari tingui sempre el mateix
// color (sense estat compartit). Hash simple → índex de paleta.
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
