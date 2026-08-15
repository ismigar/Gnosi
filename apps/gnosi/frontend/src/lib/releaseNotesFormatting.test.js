import { describe, expect, it } from 'vitest';

import { normalizeLineEndings } from './releaseNotesFormatting';

describe('normalizeLineEndings', () => {
  it('preserves LF line endings', () => {
    expect(normalizeLineEndings('first\nsecond\n')).toBe('first\nsecond\n');
  });

  it('normalizes Windows and legacy line endings to LF', () => {
    expect(normalizeLineEndings('first\r\nsecond\rthird\r\n')).toBe(
      'first\nsecond\nthird\n',
    );
  });
});
