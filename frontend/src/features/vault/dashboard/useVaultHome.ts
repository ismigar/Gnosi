import { useEffect, useRef, useState } from 'react';
import { fetchVaultHome, saveVaultHome } from '../../../shared/api/vault-home';
import { getActiveVaultId } from '../../../shared/api/vault-context';
import { notifyError } from '../../../shared/notifications/notifyError';
import type { DashboardActions } from './useDashboardActions';

export function useVaultHome(context: Pick<DashboardActions, 'nestedPath' | 'loadPage' | 't' | 'activeTabId'>) {
    const [home, setHome] = useState<{ vaultId: string; id: string | null } | null>(null);
    const [saving, setSaving] = useState(false);
    const entered = useRef<string | null>(null);
    const vaultId = getActiveVaultId();
    const ready = Boolean(home && home.vaultId === vaultId);
    const homeId = ready ? home?.id ?? null : null;
    const { nestedPath, loadPage, t } = context;
    useEffect(() => {
        const controller = new AbortController();
        void fetchVaultHome(controller.signal).then(id => {
            if (controller.signal.aborted) return;
            if (vaultId) setHome({ vaultId, id });
        }).catch((error: unknown) => {
            if (!controller.signal.aborted) notifyError('vault-home', error, t('shell.home_load_error', 'Could not load vault home'));
        });
        return () => { controller.abort(); };
    }, [vaultId, t]);
    useEffect(() => {
        if (!ready || entered.current === vaultId) return;
        entered.current = vaultId;
        // Never replace an explicit deep link with the home page.
        if (!nestedPath && homeId) void loadPage(homeId);
    }, [ready, nestedPath, homeId, loadPage, vaultId]);
    const toggleHome = async () => {
        if (saving || !ready || !context.activeTabId) return;
        const next = homeId === context.activeTabId ? null : context.activeTabId;
        setSaving(true);
        try {
            await saveVaultHome(next);
            if (vaultId && getActiveVaultId() === vaultId) setHome({ vaultId, id: next });
        } catch (error) {
            notifyError('vault-home', error, t('shell.home_save_error', 'Could not save vault home'));
        } finally { setSaving(false); }
    };
    return { homeId, homeReady: ready && !saving, toggleHome, goHome: () => { if (homeId) void loadPage(homeId); } };
}
