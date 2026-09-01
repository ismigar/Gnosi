import { describe, expect, it } from 'vitest';
import { getMetaKey, getMetadataValueByNormalizedKey } from './metadata';

describe('table metadata compatibility', () => {
  it('retains actual key spelling, punctuation and first-match order', () => {
    expect(getMetaKey({ metadata: { 'My Field': 1, 'my-field': 2 } }, 'my_field')).toBe('My Field');
    expect(getMetaKey({ metadata: { hasOwnProperty: 'ordinary metadata', GNOSI_ID: 'value' } }, 'id')).toBe('GNOSI_ID');
  });
  it('prefers exact id aliases in id/gnosi_id/source_id order before normalized matches', () => {
    expect(getMetaKey({ metadata: { source_id: 1, gnosi_id: 2, id: 3 } }, 'ID')).toBe('id');
    expect(getMetaKey({ metadata: { 'GNOSI ID': 2, source_id: 1 } }, 'id')).toBe('source_id');
    expect(getMetaKey({ metadata: { 'GNOSI ID': 2 } }, 'id')).toBe('GNOSI ID');
  });
  it('returns the requested field when metadata or its alias is absent', () => {
    expect(getMetaKey(null, 'Title')).toBe('Title');
    expect(getMetaKey({ metadata: {} }, 'ID')).toBe('ID');
    // Preserve the old normalization/alias contract during extraction.
    expect(getMetaKey({ metadata: { created_time: '2026-01-01' } }, 'Date Added')).toBe('Date Added');
  });
  it('finds nonempty normalized values without dropping false or zero', () => {
    expect(getMetadataValueByNormalizedKey({ 'File Path': '' }, ['file_path'])).toBe('');
    expect(getMetadataValueByNormalizedKey({ path: null, 'File Path': false }, ['path', 'file_path'])).toBe(false);
    expect(getMetadataValueByNormalizedKey({ path: 0 }, ['path'])).toBe(0);
    expect(getMetadataValueByNormalizedKey({ attachments: ['a', 'b'] }, ['attachments'])).toEqual(['a', 'b']);
  });
  it('ignores inherited properties and preserves arbitrary own metadata', () => {
    const metadata: unknown = Object.create({ path: 'inherited' });
    expect(getMetadataValueByNormalizedKey(metadata, ['path'])).toBe('');
    expect(getMetadataValueByNormalizedKey(null, ['path'])).toBe('');
    expect(getMetadataValueByNormalizedKey('not metadata', ['path'])).toBe('');
    const value = { deeply: ['nested'] };
    expect(getMetadataValueByNormalizedKey({ path: value }, ['path'])).toBe(value);
  });
});
