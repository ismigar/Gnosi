import {
    useCallback,
    useEffect,
    useState,
    type CSSProperties,
    type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Vault, Plus, Check, Loader, Trash2, Store, PackagePlus } from 'lucide-react';
import ConfirmModal from './ConfirmModal';
import VaultTemplateMarketplace from './VaultTemplateMarketplace';
import { useLocation, useNavigate } from 'react-router-dom';
import {
    activateVault,
    canonicalVaultSwitchPath,
    persistVaultCatalog,
} from '../lib/vaultRouting';
import {
    ACTIVE_VAULT_NAME_KEY,
} from '../shared/api/vault-context';
import {
    defineStorageKey,
    stringStorageCodec,
    writeStorage,
} from '../shared/platform/browser-storage';
import {
    createVault,
    deleteVault,
    fetchVaultCatalog,
    type VaultSummary,
} from '../shared/api/vaults';


type MarketplaceSection = 'catalog' | 'publish';


const activeVaultNameStorageKey = defineStorageKey(
    ACTIVE_VAULT_NAME_KEY,
    stringStorageCodec,
);


function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return typeof error === 'string' && error ? error : 'Unknown error';
}

/**
 * Vault selector (personal multi-vault mode). Lists the vaults, allows creating new ones, and
 * switching the active one (saved through browser storage as `gnosi_active_vault` and propagated via X-Vault-Id on
 * every request — see the shared request-context middleware). Useful for cloning Notion into a separate vault,
 * validating it in isolation, and adopting or discarding it.
 */
export default function VaultSwitcher() {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const [vaults, setVaults] = useState<VaultSummary[]>([]);
    const [busy, setBusy] = useState('');
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [error, setError] = useState('');
    const [confirmTarget, setConfirmTarget] = useState<VaultSummary | null>(null);
    const [marketplaceSection, setMarketplaceSection] = useState<MarketplaceSection | null>(null);

    const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
        try {
            const data = await fetchVaultCatalog(signal);
            const list = data.vaults;
            persistVaultCatalog(list);
            setVaults(list);
            const active = list.find((vault) => vault.active);
            if (active?.name) {
                writeStorage(activeVaultNameStorageKey, active.name);
            }
        } catch (error) {
            if (!signal?.aborted) setError(errorMessage(error));
        }
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        const loadInitialCatalog = async (): Promise<void> => {
            await Promise.resolve();
            await load(controller.signal);
        };
        void loadInitialCatalog();
        return () => {
            controller.abort();
        };
    }, [load]);

    const switchTo = (id: string): void => {
        const target = vaults.find((vault) => vault.id === id);
        if (!target?.slug
            || !activateVault({ ...target, slug: target.slug })) return;
        void navigate(canonicalVaultSwitchPath(location.pathname, target.slug));
    };

    const create = async (): Promise<void> => {
        const name = newName.trim();
        if (!name) return;
        setBusy('create'); setError('');
        try {
            await createVault(name);
            setNewName(''); setCreating(false);
            await load();
        } catch (error) { setError(errorMessage(error)); }
        finally { setBusy(''); }
    };

    const remove = (vault: VaultSummary): void => {
        setConfirmTarget(vault);
    };

    const doRemove = async (): Promise<void> => {
        const v = confirmTarget;
        if (!v) return;
        setBusy('del:' + v.id); setError('');
        try {
            await deleteVault(v.id);
            await load();
        } catch (error) { setError(errorMessage(error)); }
        finally { setBusy(''); setConfirmTarget(null); }
    };

    const inp: CSSProperties = { background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--settings-border)', borderRadius: 10, padding: '7px 12px', fontSize: '0.85rem' };

    return (
        <div style={{ marginBottom: 16, padding: 14, borderRadius: 14, border: '1px solid var(--settings-border)', background: 'var(--bg-primary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                <Vault size={15} /> {t('vault_switcher.active_vault', "Active vault")}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {vaults.map(v => (
                    <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 0, borderRadius: 10,
                        border: `1px solid ${v.active ? 'var(--gnosi-primary)' : 'var(--settings-border)'}`, overflow: 'hidden' }}>
                        <button type="button" onClick={() => {
                            if (!v.active) switchTo(v.id);
                        }} title={v.path}
                            style={{ ...inp, border: 'none', borderRadius: 0, cursor: v.active ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                color: v.active ? 'var(--gnosi-primary)' : 'var(--text-primary)', fontWeight: v.active ? 700 : 400 }}>
                            {v.active && <Check size={13} />}{v.name}
                        </button>
                        {!v.active && (
                            <button type="button" onClick={() => {
                                remove(v);
                            }} disabled={busy === `del:${v.id}`} title={t('vault_switcher.delete_tooltip', "Remove this vault from the registry")}
                                style={{ background: 'none', border: 'none', borderLeft: '1px solid var(--settings-border)', cursor: 'pointer', padding: '7px 8px', color: 'var(--text-tertiary)', display: 'flex' }}>
                                {busy === `del:${v.id}` ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                        )}
                    </div>
                ))}
                {creating ? (
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input style={{ ...inp, width: 160 }} autoFocus placeholder={t('settings.general.vault_name', "Vault name")} value={newName}
                            onChange={(event) => {
                                setNewName(event.target.value);
                            }} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                                if (event.key === 'Enter') void create();
                            }} />
                        <button type="button" className="btn-gnosi-primary" onClick={() => {
                            void create();
                        }} disabled={busy === 'create' || !newName.trim()}
                            style={{ padding: '7px 12px', borderRadius: 10, fontSize: '0.82rem' }}>
                            {busy === 'create' ? <Loader size={13} className="animate-spin" /> : t('common.create', "Create")}
                        </button>
                        <button type="button" onClick={() => { setCreating(false); setNewName(''); }} style={{ ...inp, cursor: 'pointer' }}>{t('common.cancel', "Cancel")}</button>
                    </span>
                ) : (
                    <>
                        <button type="button" onClick={() => {
                            setCreating(true);
                        }}
                            style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                            <Plus size={14} /> {t('vault_switcher.new_vault', "New vault")}
                        </button>
                        <button type="button" onClick={() => {
                            setMarketplaceSection('catalog');
                        }}
                            style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                            <Store size={14} /> {t('vault_templates.from_repository')}
                        </button>
                        <button type="button" onClick={() => {
                            setMarketplaceSection('publish');
                        }}
                            style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                            <PackagePlus size={14} /> {t('vault_templates.publish_action')}
                        </button>
                    </>
                )}
            </div>
            {error && <div style={{ marginTop: 6, color: '#e05252', fontSize: '0.8rem' }}>{error}</div>}
            <ConfirmModal
                isOpen={!!confirmTarget}
                onClose={() => {
                    setConfirmTarget(null);
                }}
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
                    onClose={() => {
                        setMarketplaceSection(null);
                    }}
                    onCreated={load}
                />
            )}
        </div>
    );
}
