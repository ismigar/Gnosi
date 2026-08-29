import { describe, expect, it } from 'vitest';

import {
  compactUrlLabel,
  extractInternalPageId,
  isEmptyInlineBlock,
  normalizeStandaloneHttpUrl,
} from './contextualLinkPasteUtils';

describe('contextual link paste utilities', () => {
  it('accepts only a standalone HTTP(S) URL', () => {
    expect(normalizeStandaloneHttpUrl(' https://example.com/path ')).toBe(
      'https://example.com/path',
    );
    expect(normalizeStandaloneHttpUrl('See https://example.com')).toBe('');
    expect(normalizeStandaloneHttpUrl('file:///tmp/test.pdf')).toBe('');
  });

  it('extracts a same-origin Vault page id', () => {
    expect(
      extractInternalPageId(
        'https://localhost:5173/vault/page/page-123',
        'https://localhost:5173',
      ),
    ).toBe('page-123');
    expect(
      extractInternalPageId(
        'https://other.test/vault/page/page-123',
        'https://localhost:5173',
      ),
    ).toBe('');
  });

  it('builds a compact external label and detects empty inline blocks', () => {
    expect(
      compactUrlLabel('https://www.example.com/products/item/'),
    ).toBe('example.com/products/item');
    expect(isEmptyInlineBlock({ content: [] })).toBe(true);
    expect(
      isEmptyInlineBlock({ content: [{ type: 'text', text: '  ' }] }),
    ).toBe(true);
    expect(
      isEmptyInlineBlock({ content: [{ type: 'text', text: 'Existing' }] }),
    ).toBe(false);
    expect(isEmptyInlineBlock({ content: undefined })).toBe(false);
  });
});
