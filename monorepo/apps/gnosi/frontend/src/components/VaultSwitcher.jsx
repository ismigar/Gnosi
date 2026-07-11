import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Vault, Plus, Check, Loader, Trash2 } from 'lucide-react';
import ConfirmModal from './ConfirmModal';

/**
 * Vault selector (personal multi-vault mode). Lists the vaults, allows creating new ones, and
 * switching the active one (saved to localStorage as `gnosi_active_vault` and propagated via X-Vault-Id on
 * every request — see pageEtagInterceptor). Useful for cloning Notion into a separate vault,
 * validating it in isolation, and adopting or discarding it. Switching vaults reloads the app.
 */
export default function VaultSwitcher() {
    const { t } = useTranslation();
    const [vaults, setVaults] = useState([]);
    const [busy, setBusy] = useState('');
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [error, setError] = useState('');
    const [confirmTarget, setConfirmTarget] = useState(null);

    const load = async () => {
        try {
            const { data } = await axios.get('/api/vaults');
            const list = data.vaults || [];
            setVaults(list);
            const active = list.find(v => v.active);
            if (active?.name) {
                try { localStorage.setItem('gnosi_active_vault_name', active.name); } catch {}
            }
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
    };
    useEffect(() => { load(); }, []);

    const switchTo = (id) => {
        try {
            localStorage.setItem('gnosi_active_vault', id);
            const target = vaults.find(v => v.id === id);
            if (target?.name) localStorage.setItem('gnosi_active_vault_name', target.name);
        } catch { /* */ }
        window.location.reload();   // reloads everything from the chosen vault
    };

    const create = async () => {
        const name = newName.trim();
        if (!name) return;
        setBusy('create'); setError('');
        try {
            await axios.post('/api/vaults', { name });
            setNewName(''); setCreating(false);
            await load();
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    const remove = (v) => setConfirmTarget(v);   // opens Gnosi's confirmation modal

    const doRemove = async () => {
        const v = confirmTarget;
        if (!v) return;
        setBusy('del:' + v.id); setError('');
        try {
            await axios.delete(`/api/vaults/${v.id}`);
            await load();
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); setConfirmTarget(null); }
    };

    const inp = { background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--settings-border)', borderRadius: 10, padding: '7px 12px', fontSize: '0.85rem' };

    return (
        <div style={{ marginBottom: 16, padding: 14, borderRadius: 14, border: '1px solid var(--settings-border)', background: 'var(--bg-primary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                <Vault size={15} /> {t('vault_switcher.active_vault', 'Vault actiu')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {vaults.map(v => (
                    <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 0, borderRadius: 10,
                        border: `1px solid ${v.active ? 'var(--gnosi-primary)' : 'var(--settings-border)'}`, overflow: 'hidden' }}>
                        <button onClick={() => !v.active && switchTo(v.id)} title={v.path}
                            style={{ ...inp, border: 'none', borderRadius: 0, cursor: v.active ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                color: v.active ? 'var(--gnosi-primary)' : 'var(--text-primary)', fontWeight: v.active ? 700 : 400 }}>
                            {v.active && <Check size={13} />}{v.name}
                        </button>
                        {!v.active && (
                            <button onClick={() => remove(v)} disabled={busy === 'del:' + v.id} title={t('vault_switcher.delete_tooltip', 'Esborra aquest vault del registre')}
                                style={{ background: 'none', border: 'none', borderLeft: '1px solid var(--settings-border)', cursor: 'pointer', padding: '7px 8px', color: 'var(--text-tertiary)', display: 'flex' }}>
                                {busy === 'del:' + v.id ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                        )}
                    </div>
                ))}
                {creating ? (
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input style={{ ...inp, width: 160 }} autoFocus placeholder={t('settings.general.vault_name', 'Nom del vault')} value={newName}
                            onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
                        <button className="btn-gnosi-primary" onClick={create} disabled={busy === 'create' || !newName.trim()}
                            style={{ padding: '7px 12px', borderRadius: 10, fontSize: '0.82rem' }}>
                            {busy === 'create' ? <Loader size={13} className="animate-spin" /> : t('common.create', 'Crea')}
                        </button>
                        <button onClick={() => { setCreating(false); setNewName(''); }} style={{ ...inp, cursor: 'pointer' }}>{t('common.cancel', 'Cancel·la')}</button>
                    </span>
                ) : (
                    <button onClick={() => setCreating(true)}
                        style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                        <Plus size={14} /> {t('vault_switcher.new_vault', 'Nou vault')}
                    </button>
                )}
            </div>
            <div style={{ marginTop: 8, fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
                {t('vault_switcher.description', "Clona Notion a un vault separat, verifica'l aïllat i adopta'l o descarta'l sense tocar el principal.")}
            </div>
            {error && <div style={{ marginTop: 6, color: '#e05252', fontSize: '0.8rem' }}>{error}</div>}
            <ConfirmModal
                isOpen={!!confirmTarget}
                onClose={() => setConfirmTarget(null)}
                onConfirm={doRemove}
                title={t('vault_switcher.delete_modal_title', 'Esborrar vault')}
                message={confirmTarget ? t('vault_switcher.delete_modal_message', 'Esborrar el vault «{{name}}» del registre? No esborra cap fitxer del disc.', { name: confirmTarget.name }) : ''}
                confirmText={t('vault_switcher.delete_modal_confirm', 'Esborrar')}
                cancelText={t('common.cancel', 'Cancel·la')}
                isDestructive
            />
        </div>
    );
}
