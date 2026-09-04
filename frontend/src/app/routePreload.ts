import { vaultAppFromPath } from '../shared/routing/vaultRouting';


export const loadVaultDashboard = () => import('../features/vault/VaultDashboard');


export async function preloadApplicationRoute(pathname: string): Promise<void> {
  if (vaultAppFromPath(pathname) === 'knowledge') {
    await loadVaultDashboard();
  }
}
