import { describe, expect, it, vi } from 'vitest';

import { canonicalDocumentSource, documentAnnotationSources } from './documentSourceIdentity';
import { documentTabId } from './fileResourcePaths';

vi.mock('../api/vault-context', () => ({
  ACTIVE_VAULT_ID_KEY: 'gnosi_active_vault',
  getActiveVaultId: () => 'vault-1',
  getActiveVaultSlug: () => 'principal',
  setActiveVaultCookie: vi.fn(),
}));

describe('document source identity', () => {
  it('shares highlights and a reader tab between attachment and citation routes', () => {
    const canonical = '/api/vault/library/Notes català.pdf';
    const scoped = '/api/v1/vaults/principal/knowledge/library/Notes%20catal%C3%A0.pdf';
    expect(canonicalDocumentSource(scoped)).toBe(canonical);
    expect(documentTabId(scoped)).toBe(documentTabId(canonical));
    expect(documentAnnotationSources(scoped)).toEqual([
      canonical, scoped,
      '/api/v1/vaults/principal/knowledge/library/Notes català.pdf',
      `${canonical}?vault=vault-1`,
    ]);
    expect(documentAnnotationSources(canonical)).toContain(
      '/api/v1/vaults/principal/knowledge/library/Notes català.pdf',
    );
  });

  it.each([
    '/api/v1/vaults/another/knowledge/library/Book.pdf',
    '/api/vault/library/Book.pdf?vault=another',
    'https://example.org/api/vault/library/Book.pdf',
    'file:///Library/Book.pdf',
    '/api/vault/local-file/token',
    '/api/vault/library/Book.pdf?revision=2',
    '/api/vault/library/%broken.pdf',
  ])('preserves unrelated or ambiguous source identities: %s', (source) => {
    expect(canonicalDocumentSource(source)).toBe(source);
    expect(documentAnnotationSources(source)).toEqual([source]);
  });
});
