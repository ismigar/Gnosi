import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Vault as VaultIcon, Check, Plus, Loader } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    activateVault,
    canonicalVaultSwitchPath,
    persistVaultCatalog,
} from '../../shared/routing/vaultRouting';
import {
    ACTIVE_VAULT_NAME_KEY,
    storageSet,
    type StoredVault,
} from '../../shared/api/vault-context';
import { createVault, fetchVaultCatalog } from '../../shared/api/vaults';

interface VaultMenuPosition {
    readonly left: number;
    readonly top: number;
}

/**
 * GLOBAL vault selector for the sidebar (personal multi-vault mode). Icon + popover
 * with the list of vaults: click to switch reactively or create a
 * new one. This lets you choose which vault you use from Knowledge, Graph, etc. Full
 * management (deleting) is in Settings → Clone from Notion (VaultSwitcher).
 */
export default function VaultMenu() {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [vaults, setVaults] = useState<StoredVault[]>([]);
    const [pos, setPos] = useState<VaultMenuPosition | null>(null);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [busy, setBusy] = useState('');
    const btnRef = useRef<HTMLButtonElement | null>(null);

    const load = useCallback(async (): Promise<void> => {
        try {
            const data = await fetchVaultCatalog();
            const list = persistVaultCatalog(data.vaults);
            setVaults(list);
            const active = list.find(v => v.active);
            if (active?.name) {
                storageSet(ACTIVE_VAULT_NAME_KEY, active.name);
            }
        } catch { /* */ }
    }, []);
    useEffect(() => {
        const loadId = setTimeout(() => {
            void load();
        }, 0);
        return () => {
            clearTimeout(loadId);
        };
    }, [load]);

    const toggle = () => {
        if (!open && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setPos({ left: r.right + 8, top: Math.max(8, r.top - 8) });
            void load();
        }
        setOpen(o => !o);
    };

    const switchTo = (id: string): void => {
        const target = vaults.find(v => v.id === id);
        if (!target || !activateVault(target)) return;
        setOpen(false);
        void navigate(canonicalVaultSwitchPath(location.pathname, target.slug));
    };

    const create = async (): Promise<void> => {
        const name = newName.trim();
        if (!name) return;
        setBusy('create');
        try { await createVault(name); setNewName(''); setCreating(false); await load(); }
        catch { /* */ } finally { setBusy(''); }
    };

    useEffect(() => {
        if (!open) return;
        const h = (event: MouseEvent): void => {
            const target = event.target;
            if (target instanceof Node && btnRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest('[data-vaultmenu]')) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', h);
        return () => {
            document.removeEventListener('mousedown', h);
        };
    }, [open]);

    const active = vaults.find(v => v.active);
    const vaultLabel = t('common.vault_label', 'Vault');
    const itemBtn: CSSProperties = { width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '7px 8px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' };

    return (
        <>
            <button ref={btnRef} className="app-sidebar__item" title={`${vaultLabel}: ${active?.name || '…'}`} aria-label={`${vaultLabel}: ${active?.name || '…'}`} onClick={toggle}>
                <VaultIcon size={16} strokeWidth={1.5} />
                <span className="app-sidebar__tooltip"><span>{vaultLabel}: {active?.name || '…'}</span></span>
            </button>
            {open && pos && createPortal(
                <div data-vaultmenu style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 'var(--z-popover)', minWidth: 220,
                    background: 'var(--bg-primary)', border: '1px solid var(--settings-border)', borderRadius: 12, padding: 8,
                    boxShadow: '0 10px 34px rgba(0,0,0,0.28)' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', padding: '2px 8px 6px' }}>{t('sidebar.vault_menu_active', "ACTIVE VAULT")}</div>
                    {vaults.map(v => (
                        <button key={v.id} onClick={() => {
                            if (!v.active) switchTo(v.id);
                        }} title={typeof v.path === 'string' ? v.path : undefined}
                            style={{ ...itemBtn, cursor: v.active ? 'default' : 'pointer',
                                color: v.active ? 'var(--gnosi-primary)' : 'var(--text-primary)', fontWeight: v.active ? 700 : 400 }}>
                            {v.active ? <Check size={13} /> : <span style={{ width: 13, flexShrink: 0 }} />}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                        </button>
                    ))}
                    {creating ? (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                            <input autoFocus value={newName} onChange={(event) => {
                                setNewName(event.target.value);
                            }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') void create();
                                }} placeholder={t('settings.general.vault_name', "Vault name")}
                                style={{ flex: 1, fontSize: '0.82rem', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--settings-border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }} />
                            <button onClick={() => {
                                void create();
                            }} disabled={busy === 'create' || !newName.trim()} className="btn-gnosi-primary"
                                style={{ padding: '6px 10px', borderRadius: 8, fontSize: '0.8rem' }}>
                                {busy === 'create' ? <Loader size={12} className="animate-spin" /> : t('common.create', "Create")}
                            </button>
                        </div>
                    ) : (
                        <button onClick={() => {
                            setCreating(true);
                        }} style={{ ...itemBtn, cursor: 'pointer', color: 'var(--text-secondary)', marginTop: 2 }}>
                            <Plus size={13} /> {t('sidebar.vault_menu_new', "New vault")}
                        </button>
                    )}
                </div>, document.body)}
        </>
    );
}
