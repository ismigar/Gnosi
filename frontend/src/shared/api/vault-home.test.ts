import { describe, expect, it, vi } from 'vitest';
import { fetchVaultHome, readVaultHome, saveVaultHome } from './vault-home';
import { fetchEditorConfiguration, updateConfiguration } from './configuration';
import { getActiveVaultId } from './vault-context';
vi.mock('./configuration', () => ({ fetchEditorConfiguration: vi.fn(), updateConfiguration: vi.fn() }));
vi.mock('./vault-context', () => ({ getActiveVaultId: vi.fn() }));

describe('vault home', () => {
    it('does not inherit another vault home or accept malformed values', () => {
        expect(readVaultHome({ vault_home: { vault_id: 'a', page_id: 'home' } }, 'b')).toBeNull();
        expect(readVaultHome({ vault_home: { vault_id: 'a', page_id: 42 } }, 'a')).toBeNull();
        expect(readVaultHome({}, 'a')).toBeNull();
        expect(readVaultHome({ vault_home: { vault_id: 'a', page_id: 'home' } }, 'a')).toBe('home');
    });
    it('discards a read completed after a vault switch', async () => {
        vi.mocked(getActiveVaultId).mockReturnValueOnce('a').mockReturnValue('b');
        vi.mocked(fetchEditorConfiguration).mockResolvedValue({ vault_home: { vault_id: 'a', page_id: 'home' } });
        expect(await fetchVaultHome()).toBeNull();
    });
    it('persists and clears only the home section with vault identity', async () => {
        vi.mocked(getActiveVaultId).mockReturnValue('a');
        await saveVaultHome('home');
        expect(updateConfiguration).toHaveBeenLastCalledWith({ vault_home: { vault_id: 'a', page_id: 'home' } });
        await saveVaultHome(null);
        expect(updateConfiguration).toHaveBeenLastCalledWith({ vault_home: { vault_id: 'a', page_id: null } });
    });
});
