import { useCallback } from 'react';
import { record } from './readers';
import { fetchVaultAliasIndex } from '../../shared/api/vaults';
import { fetchVaultGlobalIndex } from '../../shared/api/vaults';
import type { DashboardState } from './useDashboardState';
type Context = Pick<DashboardState, 'setAliasIndex' | 'setGlobalIndex'>;
export function useGlobalIndex(context: Context) {
    const { setAliasIndex, setGlobalIndex } = context;
    const fetchGlobalIndex = useCallback(async () => {
        try {
            const index = await fetchVaultGlobalIndex();
            setGlobalIndex(index);
        }
        catch (err) {
            console.error("Error loading global index:", err);
        }
        // The alias index is secondary: if it fails, title-based wikilinks
        // keep working (and `[[alias]]` still resolves via /resolve-by-title).
        try {
            const index = await fetchVaultAliasIndex();
            setAliasIndex(index);
        }
        catch (err) {
            console.warn("Error loading alias index:", record(err).message || err);
        }
    }, [setAliasIndex, setGlobalIndex]);
    return { fetchGlobalIndex };
}
