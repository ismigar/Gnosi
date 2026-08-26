import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Vault, Plus, Check, Loader, Trash2, Store, PackagePlus } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import VaultTemplateMarketplace from './VaultTemplateMarketplace';
import { setActiveVaultCookie } from '../lib/fileResource';

/**
 * Vault selector (personal multi-vault mode). Lists the vaults, allows creating new ones, and
 * switching the active one (saved to localStorage as `gnosi_active_vault` and propagated via X-Vault-Id on
 * every request — see pageEtagInterceptor). Useful for cloning Notion into a separate vault,
 * validating it in isolation, and adopting or discarding it.
 */
export default function VaultSwitcher() {
    const { t } = useTranslation();
    const [vaults, setVaults] = useState([]);
    const [busy, setBusy] = useState('');
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [error, setError] = useState('');
    const [confirmTarget, setConfirmTarget] = useState(null);
    const [marketplaceSection, setMarketplaceSection] = useState('');

    const load = async () => {
        try {
            const { data } = await axios.get('/api/vaults');
            const list = data.vaults || [];
            setVaults(list);
            const active = list.find(v => v.active);
            if (active?.name) {
                try { localStorage.setItem('gnosi_active_vault_name', active.name); } catch {
                    // Storage can be unavailable in restricted browser contexts.
                }
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
        setActiveVaultCookie(id);
        window.dispatchEvent(new CustomEvent('gnosi:vault-changed', { detail: { id } }));
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
                <Vault size={15} /> {t('vault_switcher.active_vault', "Active vault")}
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
                            <button onClick={() => remove(v)} disabled={busy === 'del:' + v.id} title={t('vault_switcher.delete_tooltip', "Remove this vault from the registry")}
                                style={{ background: 'none', border: 'none', borderLeft: '1px solid var(--settings-border)', cursor: 'pointer', padding: '7px 8px', color: 'var(--text-tertiary)', display: 'flex' }}>
                                {busy === 'del:' + v.id ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                        )}
                    </div>
                ))}
                {creating ? (
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input style={{ ...inp, width: 160 }} autoFocus placeholder={t('settings.general.vault_name', "Vault name")} value={newName}
                            onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} />
                        <button className="btn-gnosi-primary" onClick={create} disabled={busy === 'create' || !newName.trim()}
                            style={{ padding: '7px 12px', borderRadius: 10, fontSize: '0.82rem' }}>
                            {busy === 'create' ? <Loader size={13} className="animate-spin" /> : t('common.create', "Create")}
                        </button>
                        <button onClick={() => { setCreating(false); setNewName(''); }} style={{ ...inp, cursor: 'pointer' }}>{t('common.cancel', "Cancel")}</button>
                    </span>
                ) : (
                    <>
                        <button onClick={() => setCreating(true)}
                            style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                            <Plus size={14} /> {t('vault_switcher.new_vault', "New vault")}
                        </button>
                        <button onClick={() => setMarketplaceSection('catalog')}
                            style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                            <Store size={14} /> {t('vault_templates.from_repository')}
                        </button>
                        <button onClick={() => setMarketplaceSection('publish')}
                            style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                            <PackagePlus size={14} /> {t('vault_templates.publish_action')}
                        </button>
                    </>
                )}
            </div>
            {error && <div style={{ marginTop: 6, color: '#e05252', fontSize: '0.8rem' }}>{error}</div>}
            <ConfirmModal
                isOpen={!!confirmTarget}
                onClose={() => setConfirmTarget(null)}
                onConfirm={doRemove}
                title={t('vault_switcher.delete_modal_title', "Delete vault")}
                message={confirmTarget ? t('vault_switcher.delete_modal_message', "Remove the vault \"{{name}}\" from the registry? This does not delete any files from disk.", { name: confirmTarget.name }) : ''}
                confirmText={t('vault_switcher.delete_modal_confirm', "Delete")}
                cancelText={t('common.cancel', "Cancel")}
                isDestructive
            />
            {marketplaceSection && (
                <VaultTemplateMarketplace
                    vaults={vaults}
                    initialSection={marketplaceSection}
                    onClose={() => setMarketplaceSection('')}
                    onCreated={load}
                />
            )}
        </div>
    );
}
