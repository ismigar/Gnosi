import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
});

describe('deferred i18n initialization', () => {
  it('registers only the active catalogue during startup', async () => {
    const { default: i18n, initializeI18n } = await import('./i18n');

    await initializeI18n('ca-ES');

    expect(i18n.resolvedLanguage).toBe('ca');
    expect(i18n.hasResourceBundle('ca', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(false);
    expect(i18n.hasResourceBundle('es', 'translation')).toBe(false);
    expect(i18n.hasResourceBundle('fr', 'translation')).toBe(false);
  });

  it('loads a second catalogue only when the user changes language', async () => {
    const { changeI18nLanguage, default: i18n, initializeI18n } = await import('./i18n');
    await initializeI18n('en');

    await changeI18nLanguage('es-MX');

    expect(i18n.resolvedLanguage).toBe('es');
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('es', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('ca', 'translation')).toBe(false);
    expect(i18n.hasResourceBundle('fr', 'translation')).toBe(false);
  });
});
