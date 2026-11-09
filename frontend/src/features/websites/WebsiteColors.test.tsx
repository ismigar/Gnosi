import { act, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import type { SiteTheme } from '../../shared/api/sites';
import { WebsiteColors } from './WebsiteColors';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, string>) => values?.label ? `${key}:${values.label}` : key }) }));
const theme: SiteTheme = { schema_version: 1, name: 'Existing', logo: '/logo.png', logo_alt: 'Logo', favicon: '', fonts: [], advanced_css: '.custom{}', tokens: { primary: '#264653', accent: '#c75b35', background: '#f5efe7', surface: '#ffffff', text: '#2c3e50', muted: '#555555', 'font-body': 'Georgia, serif', 'custom-token': '#123456' } };
function control(root: HTMLElement, prefix: string, token: string) {
  const element = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="websites.colors.${prefix}:websites.tokens.${token}"]`);
  if (!element) throw new Error(`Missing ${token}`);
  return element;
}
function select(element: HTMLInputElement | HTMLSelectElement, value: string) {
  element.value = value; element.dispatchEvent(new Event('change', { bubbles: true }));
}
function setup(initial = theme, legacy = false) {
  const changed = vi.fn<(value: SiteTheme) => void>();
  function Harness() {
    const [value, setValue] = useState(initial);
    return <WebsiteColors theme={value} legacy={legacy} disabled={false} onChange={next => { changed(next); setValue(next); }} />;
  }
  return { ...mountTestComponent(<Harness />), changed };
}

describe('Website palette and regional assignments', () => {
  it('retains existing settings and inherits until a region is explicitly assigned', () => {
    const view = setup();
    expect(view.changed).not.toHaveBeenCalled();
    expect(control(view.container, 'assignment', 'header-background').value).toBe('inherit');
    expect(view.container.querySelector('[aria-label="websites.colors.pick:websites.tokens.header-background"]')).toBeNull();
    act(() => { select(control(view.container, 'assignment', 'header-background'), 'white'); });
    expect(view.changed.mock.lastCall?.[0]).toEqual({ ...theme, tokens: { ...theme.tokens, 'header-background': '#ffffff' } });
    view.unmount();
  });

  it('keeps palette references linked after changing the primary colour', () => {
    const view = setup();
    act(() => { select(control(view.container, 'assignment', 'body-text'), 'primary'); });
    const picker = control(view.container, 'pick', 'primary');
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(picker, '#112233'); picker.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(view.changed.mock.lastCall?.[0].tokens?.['body-text']).toBe('var(--primary)');
    expect(control(view.container, 'pick', 'body-text').value).toBe('#112233');
    expect(view.changed.mock.lastCall?.[0].tokens?.['custom-token']).toBe('#123456');
    view.unmount();
  });

  it('separates secondary brand colour from muted text and restores inheritance', () => {
    const view = setup();
    act(() => { select(control(view.container, 'assignment', 'footer-background'), 'secondary'); });
    expect(control(view.container, 'pick', 'footer-background').value).toBe('#e2dfda');
    expect(view.changed.mock.lastCall?.[0].tokens?.muted).toBe('#555555');
    act(() => { select(control(view.container, 'assignment', 'footer-background'), 'inherit'); });
    expect(view.changed.mock.lastCall?.[0]).toEqual(theme);
    view.unmount();
  });

  it('starts custom legacy colours from the inherited palette', () => {
    const view = setup(theme, true);
    expect(view.changed).not.toHaveBeenCalled();
    act(() => { select(control(view.container, 'assignment', 'body-background'), 'custom'); });
    expect(control(view.container, 'pick', 'body-background').value).toBe('#ffffff');
    act(() => { select(control(view.container, 'assignment', 'body-heading'), 'custom'); });
    expect(control(view.container, 'pick', 'body-heading').value).toBe('#c75b35');
    expect(view.changed.mock.lastCall?.[0].tokens?.['body-background']).toBe('#ffffff');
    view.unmount();
  });
});
