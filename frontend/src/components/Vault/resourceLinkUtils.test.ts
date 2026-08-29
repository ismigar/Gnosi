import { describe, expect, it } from 'vitest';

import { hasResourceReference } from './resourceLinkUtils';

describe('hasResourceReference', () => {
  it.each([undefined, null, '', '  ', [], {}, [null, '']])(
    'returns false for an empty resource value: %j',
    (value) => {
      expect(hasResourceReference(value)).toBe(false);
    },
  );

  it.each([
    'zotero://select/library/items/ABCD',
    ['  ', 'file:///tmp/document.pdf'],
    { path: '/tmp/document.pdf' },
  ])('returns true for a populated resource value: %j', (value) => {
    expect(hasResourceReference(value)).toBe(true);
  });
});
