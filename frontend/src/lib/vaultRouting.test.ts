import { beforeEach, describe, expect, it } from 'vitest';

// Contract coverage for the typed canonical and legacy routing boundary.

import {
    activateVault,
    canonicalizeVaultApiUrl,
    knowledgeDocumentPath,
    knowledgeDocumentType,
    legacyBrowserPathToCanonical,
    persistVaultCatalog,
    vaultAppFromPath,
    vaultPath,
} from './vaultRouting';


describe('vaultRouting', () => {
    beforeEach(() => {
        localStorage.clear();
        persistVaultCatalog([
            { id: 'vault-a', slug: 'historia', name: 'Història' },
            { id: 'vault-b', slug: 'proves', name: 'Proves' },
        ]);
        activateVault({ id: 'vault-a', slug: 'historia', name: 'Història' }, { notify: false });
    });

    it('builds self-contained browser routes', () => {
        expect(vaultPath('knowledge', 'page/page-1')).toBe('/@historia/knowledge/page/page-1');
        expect(vaultAppFromPath('/@historia/calendar/event/event-1')).toBe('calendar');
        expect(legacyBrowserPathToCanonical('/vault/table/people')).toBe('/@historia/knowledge/table/people');
        expect(legacyBrowserPathToCanonical('/composer')).toBe('/@historia/social/compose');
        expect(knowledgeDocumentType({ metadata: { is_dashboard: true } })).toBe('dashboard');
        expect(knowledgeDocumentPath('dashboard/id', { metadata: { is_dashboard: true } }))
            .toBe('/@historia/knowledge/dashboard/dashboard%2Fid');
        expect(knowledgeDocumentPath('page/id')).toBe('/@historia/knowledge/page/page%2Fid');
    });

    it('moves legacy vault APIs below the versioned app namespace', () => {
        expect(canonicalizeVaultApiUrl('/api/vault/pages/page-1?full=true'))
            .toBe('/api/v1/vaults/historia/knowledge/pages/page-1?full=true');
        expect(canonicalizeVaultApiUrl('/api/vault/literature/reviews'))
            .toBe('/api/v1/vaults/historia/resources/reviews');
        expect(canonicalizeVaultApiUrl('/api/calendar/events'))
            .toBe('/api/v1/vaults/historia/calendar/events');
        expect(canonicalizeVaultApiUrl('/api/chat', 'proves'))
            .toBe('/api/v1/vaults/proves/ai/chat');
    });

    it('does not rewrite global management APIs', () => {
        expect(canonicalizeVaultApiUrl('/api/vaults')).toBe('/api/vaults');
        expect(canonicalizeVaultApiUrl('/api/auth/me')).toBe('/api/auth/me');
    });
});
