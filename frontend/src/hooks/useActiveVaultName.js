import { useState, useEffect } from 'react';
import axios from 'axios';
import { useVaultNameChanged } from '../lib/configEvents';

export function useActiveVaultName() {
    const [activeVaultName, setActiveVaultName] = useState(() => {
        try {
            return localStorage.getItem('gnosi_active_vault_name') || '';
        } catch {
            return '';
        }
    });

    useEffect(() => {
        let mounted = true;
        axios.get('/api/vaults').then(({ data }) => {
            if (!mounted) return;
            const vaults = data?.vaults || [];
            const active = vaults.find(v => v.active);
            if (active?.name) {
                setActiveVaultName(active.name);
                try { localStorage.setItem('gnosi_active_vault_name', active.name); } catch {}
            }
        }).catch(() => {});
        return () => { mounted = false; };
    }, []);

    // Refresh the name when the active vault is renamed (from Settings → General),
    // without reloading the page.
    useVaultNameChanged(() => {
        axios.get('/api/vaults').then(({ data }) => {
            const vaults = data?.vaults || [];
            const active = vaults.find(v => v.active);
            if (active?.name) {
                setActiveVaultName(active.name);
                try { localStorage.setItem('gnosi_active_vault_name', active.name); } catch {}
            }
        }).catch(() => {});
    });

    return activeVaultName;
}
