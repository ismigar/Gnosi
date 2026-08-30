import { describe, expect, it } from 'vitest';

import { formatVaultDate, parseVaultDate } from './dateUtils';
import { formatDate } from './formatUtils';

describe('signed Vault dates', () => {
  it('round-trips a BCE ISO date without JavaScript year coercion', () => {
    const date = parseVaultDate('-0044-03-15');

    expect(date.getFullYear()).toBe(-44);
    expect(formatVaultDate(date)).toBe('-0044-03-15');
  });

  it('keeps BCE dates explicit when formatting them for display', () => {
    expect(
      formatDate('-0044-03-15', {
        dateFormat: 'locale',
        locale: 'ca-ES',
      }),
    ).toBe('-0044-03-15');
  });
});
