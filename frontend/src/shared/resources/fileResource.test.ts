import { describe, expect, it, vi } from 'vitest';

import {
  buildImageValue,
  canonicalStorageFolder,
  fileTargetKey,
  interpolateNamePattern,
  parseFileEntries,
  parseImageField,
  servedUrlToVaultPath,
  toServedAssetUrl,
  toAssetPreviewUrl,
} from './fileResource';

vi.mock('../api/notebooks', () => ({ fetchNotebookEvidence: vi.fn() }));
vi.mock('../api/transports', () => ({ transportFetch: vi.fn() }));
vi.mock('../notifications/notifyError', () => ({ logError: vi.fn() }));
vi.mock('../notifications/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe('file resource normalization', () => {
  it('requires image evidence and accepts extensionless sources only for declared image fields', () => {
    expect(toAssetPreviewUrl('https://example.test/image/123')).toBe('');
    expect(toAssetPreviewUrl('https://example.test/image/123', true)).toBe('https://example.test/image/123');
    expect(toAssetPreviewUrl('https://example.test/cover.jpg?size=small')).toBe('https://example.test/cover.jpg?size=small');
    expect(toAssetPreviewUrl('Assets/covers/123', true)).toContain('/api/vault/assets/covers/123');
    expect(toAssetPreviewUrl('Assets/covers/book.png')).toContain('/api/vault/assets/covers/book.png');
    expect(toAssetPreviewUrl('https://example.test/paper.pdf')).toBe('');
    for (const source of ['javascript:alert(1).png', 'data:text/html,image.png', 'file:///tmp/image.png', 'blob:https://example.test/id']) {
      expect(toAssetPreviewUrl(source, true)).toBe('');
      expect(toAssetPreviewUrl(source)).toBe('');
    }
  });
  it('keeps legacy storage and asset paths compatible', () => {
    expect(canonicalStorageFolder(' Biblioteca ')).toBe('library');
    expect(toServedAssetUrl('Assets/Covers/book cover.jpg')).toContain(
      '/api/vault/assets/Covers/book cover.jpg',
    );
    expect(servedUrlToVaultPath('/api/vault/assets/Covers/book.jpg?vault=main')).toBe(
      'Covers/book.jpg',
    );
  });

  it('serves legacy file URIs only when they resolve to a Vault asset', () => {
    for (const legacy of ['file:///Users/test/Vault/Assets/covers/book.png', 'file://localhost/Users/test/Vault/Assets/covers/book.png']) {
      expect(toAssetPreviewUrl(legacy)).toBe(toServedAssetUrl('Assets/covers/book.png'));
      expect(toAssetPreviewUrl(legacy, true)).toBe(toServedAssetUrl('Assets/covers/book.png'));
    }
    expect(toAssetPreviewUrl('file:///Users/test/Vault/Assets/covers/123', true))
      .toBe(toServedAssetUrl('Assets/covers/123'));
    for (const source of ['file:///tmp/cover.png', 'file:///Users/test/Vault/library/book.png', 'javascript:fake/Assets/cover.png', 'custom:///vault/Assets/cover.png']) {
      expect(toAssetPreviewUrl(source)).toBe('');
      expect(toAssetPreviewUrl(source, true)).toBe('');
    }
  });

  it('reads legacy image strings and emits composite values only when needed', () => {
    expect(parseImageField('Assets/cover.jpg')).toEqual({
      alt: '',
      caption: '',
      credit: '',
      src: 'Assets/cover.jpg',
      title: '',
    });
    expect(buildImageValue('Assets/cover.jpg')).toBe('Assets/cover.jpg');
    expect(buildImageValue('Assets/cover.jpg', { alt: 'A cover' })).toEqual({
      alt: 'A cover',
      src: 'Assets/cover.jpg',
    });
  });

  it('parses plain and Markdown file entries without splitting commas', () => {
    expect(parseFileEntries([
      '[Paper](/api/vault/library/Papers/a,b.pdf)',
      'Assets/notes.txt',
    ])).toEqual([
      { label: 'Paper', target: '/api/vault/library/Papers/a,b.pdf' },
      { label: 'notes.txt', target: 'Assets/notes.txt' },
    ]);
  });
});

describe('canonical file identity and naming', () => {
  it('deduplicates legacy local, file and served Library forms', () => {
    const fileUrl = 'file:///Users/first/Library/Research/Source%20One.pdf';
    const localPath = '/Users/second/Library/Research/Source One.pdf';
    const served = '/api/vault/library/Research/Source%20One.pdf?vault=principal';

    expect(fileTargetKey(fileUrl)).toBe(fileTargetKey(localPath));
    expect(fileTargetKey(localPath)).toBe(fileTargetKey(served));
  });

  it('preserves structured and legacy author interpolation', () => {
    expect(interpolateNamePattern('{Authors.cognom} - {Title}', {
      Authors: [{ cognom1: 'García', cognom2: 'Fernández', nom: 'Ismael' }],
      title: 'Gnosi',
    })).toBe('García Fernández - Gnosi');
    expect(interpolateNamePattern('{Authors.cognom1}', {
      Authors: 'Ismael García Fernández',
    })).toBe('García');
  });
});
