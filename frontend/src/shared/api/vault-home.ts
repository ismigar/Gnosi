import { fetchEditorConfiguration, updateConfiguration } from './configuration';
import { getActiveVaultId } from './vault-context';

export function readVaultHome(config: Record<string, unknown>, vaultId: string): string | null {
    const home = config.vault_home;
    if (!home || typeof home !== 'object' || !('vault_id' in home) || home.vault_id !== vaultId) return null;
    return 'page_id' in home && typeof home.page_id === 'string' && home.page_id.trim()
        ? home.page_id : null;
}

export async function fetchVaultHome(signal?: AbortSignal): Promise<string | null> {
    const vaultId = getActiveVaultId();
    if (!vaultId) return null;
    const config = await fetchEditorConfiguration(signal);
    return getActiveVaultId() === vaultId ? readVaultHome(config, vaultId) : null;
}

export async function saveVaultHome(pageId: string | null): Promise<void> {
    const vaultId = getActiveVaultId();
    if (!vaultId) throw new Error('No active vault');
    // The existing configuration endpoint writes the request-local vault's
    // .gnosi/params.yaml. The identity also prevents inherited defaults leaking.
    await updateConfiguration({ vault_home: { vault_id: vaultId, page_id: pageId } });
}
