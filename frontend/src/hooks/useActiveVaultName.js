import { useState, useEffect } from 'react';
import axios from 'axios';

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

    return activeVaultName;
}
