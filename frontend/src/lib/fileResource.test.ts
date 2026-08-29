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
} from './fileResource';

vi.mock('../shared/api/notebooks', () => ({ fetchNotebookEvidence: vi.fn() }));
vi.mock('../shared/api/transports', () => ({ transportFetch: vi.fn() }));
vi.mock('./notifyError', () => ({ logError: vi.fn() }));
vi.mock('./toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe('file resource normalization', () => {
  it('keeps legacy storage and asset paths compatible', () => {
    expect(canonicalStorageFolder(' Biblioteca ')).toBe('library');
    expect(toServedAssetUrl('Assets/Covers/book cover.jpg')).toContain(
      '/api/vault/assets/Covers/book cover.jpg',
    );
    expect(servedUrlToVaultPath('/api/vault/assets/Covers/book.jpg?vault=main')).toBe(
      'Covers/book.jpg',
    );
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
