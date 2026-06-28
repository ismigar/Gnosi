import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { Database, Check, Plus, Loader } from 'lucide-react';

/**
 * Selector de vault GLOBAL per a la barra lateral (mode personal multi-vault). Icona + popover
 * amb la llista de vaults: clica per canviar (recarrega l'app des d'aquell vault) o crea'n un de
 * nou. Així pots triar quin vault uses des de Coneixement, Graf, etc. La gestió completa
 * (esborrar) és a Configuració → Clonar de Notion (VaultSwitcher).
 */
export default function VaultMenu() {
    const [open, setOpen] = useState(false);
    const [vaults, setVaults] = useState([]);
    const [pos, setPos] = useState(null);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [busy, setBusy] = useState('');
    const btnRef = useRef(null);

    const load = async () => {
        try { const { data } = await axios.get('/api/vaults'); setVaults(data.vaults || []); } catch { /* */ }
    };
    useEffect(() => { load(); }, []);

    const toggle = () => {
        if (!open && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setPos({ left: r.right + 8, top: Math.max(8, r.top - 8) });
            load();
        }
        setOpen(o => !o);
    };

    const switchTo = (id) => {
        try { localStorage.setItem('gnosi_active_vault', id); } catch { /* */ }
        window.location.reload();
    };

    const create = async () => {
        const name = newName.trim();
        if (!name) return;
        setBusy('create');
        try { await axios.post('/api/vaults', { name }); setNewName(''); setCreating(false); await load(); }
        catch { /* */ } finally { setBusy(''); }
    };

    useEffect(() => {
        if (!open) return;
        const h = (e) => {
            if (btnRef.current?.contains(e.target)) return;
            if (e.target.closest?.('[data-vaultmenu]')) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [open]);

    const active = vaults.find(v => v.active);
    const itemBtn = { width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '7px 8px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' };

    return (
        <>
            <button ref={btnRef} className="app-sidebar__item" title={`Vault: ${active?.name || '…'}`} onClick={toggle}>
                <Database size={16} strokeWidth={1.5} />
                <span className="app-sidebar__tooltip"><span>Vault: {active?.name || '…'}</span></span>
            </button>
            {open && pos && createPortal(
                <div data-vaultmenu style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 4000, minWidth: 220,
                    background: 'var(--bg-primary)', border: '1px solid var(--settings-border)', borderRadius: 12, padding: 8,
                    boxShadow: '0 10px 34px rgba(0,0,0,0.28)' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', padding: '2px 8px 6px' }}>VAULT ACTIU</div>
                    {vaults.map(v => (
                        <button key={v.id} onClick={() => !v.active && switchTo(v.id)} title={v.path}
                            style={{ ...itemBtn, cursor: v.active ? 'default' : 'pointer',
                                color: v.active ? 'var(--gnosi-primary)' : 'var(--text-primary)', fontWeight: v.active ? 700 : 400 }}>
                            {v.active ? <Check size={13} /> : <span style={{ width: 13, flexShrink: 0 }} />}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                        </button>
                    ))}
                    {creating ? (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && create()} placeholder="Nom del vault"
                                style={{ flex: 1, fontSize: '0.82rem', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--settings-border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                            <button onClick={create} disabled={busy === 'create' || !newName.trim()} className="btn-gnosi-primary"
                                style={{ padding: '6px 10px', borderRadius: 8, fontSize: '0.8rem' }}>
                                {busy === 'create' ? <Loader size={12} className="animate-spin" /> : 'Crea'}
                            </button>
                        </div>
                    ) : (
                        <button onClick={() => setCreating(true)} style={{ ...itemBtn, cursor: 'pointer', color: 'var(--text-secondary)', marginTop: 2 }}>
                            <Plus size={13} /> Nou vault
                        </button>
                    )}
                </div>, document.body)}
        </>
    );
}
