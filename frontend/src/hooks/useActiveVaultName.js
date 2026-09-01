import { useState, useEffect } from 'react';
import { useVaultNameChanged } from '../lib/configEvents';
import { useVaultCatalog } from '../shared/api/useVaultCatalog';

export function useActiveVaultName() {
    const vaultCatalog = useVaultCatalog();
    const [activeVaultName, setActiveVaultName] = useState(() => {
        try {
            return localStorage.getItem('gnosi_active_vault_name') || '';
        } catch {
            return '';
        }
    });

    useEffect(() => {
        const vaults = vaultCatalog.data?.vaults || [];
        const active = vaults.find(v => v.active);
        if (active?.name) {
            setActiveVaultName(active.name);
            try { localStorage.setItem('gnosi_active_vault_name', active.name); } catch {
                // Storage can be unavailable in restricted browser contexts.
            }
        }
    }, [vaultCatalog.data]);

    // Refresh the name when the active vault is renamed (from Settings → General),
    // without reloading the page.
    useVaultNameChanged(() => {
        void vaultCatalog.refetch();
    });

    return activeVaultName;
}
