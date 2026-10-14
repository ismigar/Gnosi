import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, vi } from 'vitest';
import { ConferenceJoinButton } from './ConferenceJoinButton';
import { conferenceJoinUrl } from './conferenceJoinUrl';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

it.each(['javascript:alert(1)', 'file:///tmp/private', '//host.test/path', 'https://u:secret@host.test', 'https://host.test/\npath', null])(
  'does not expose an unsafe meeting link: %s', (url) => { expect(conferenceJoinUrl(url)).toBeNull(); },
);

it('rejects every ASCII control character and whitespace before URL normalization', () => {
  for (const code of [...Array.from({ length: 33 }, (_, value) => value), 127]) {
    expect(conferenceJoinUrl(`https://host.test/${String.fromCharCode(code)}path`)).toBeNull();
  }
});

it('opens an HTTPS provider call in a separate browser context without a referrer', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => { root.render(<ConferenceJoinButton url="https://meet.google.com/abc-defg-hij" />); });
  const link = host.querySelector('a');
  expect(link?.href).toBe('https://meet.google.com/abc-defg-hij');
  expect(link?.target).toBe('_blank');
  expect(link?.rel).toBe('noopener noreferrer');
  expect(link?.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(link?.getAttribute('aria-label')).toContain('Join video call');
  act(() => { root.unmount(); });
});
