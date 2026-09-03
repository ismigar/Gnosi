import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MailBody } from './MailBody';
import { MAIL_DARK_BODY_EVENT, MAIL_DARK_BODY_KEY } from './mailViewerModel';
import { emitAppEvent } from '../../../shared/platform/app-events';
import { removeStorage, writeStorage } from '../../../shared/platform/browser-storage';


let container: HTMLDivElement;
let root: Root;

async function settleIframe(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  });
}

beforeAll(() => {
  const testGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  removeStorage(MAIL_DARK_BODY_KEY);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  removeStorage(MAIL_DARK_BODY_KEY);
});


describe('MailBody', () => {
  it('renders plain text as text and links only escaped URLs', () => {
    act(() => { root.render(<MailBody bodyText={'<script>unsafe()</script> https://example.test'} />); });
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>unsafe()</script>');
    expect(container.querySelector('a')?.href).toBe('https://example.test/');
    expect(container.querySelector('a')?.rel).toBe('noopener noreferrer');
  });

  it('keeps remote HTML sandboxed and rewrites inline images', async () => {
    act(() => {
      root.render(<MailBody bodyHtml={'<script>unsafe()</script><img src="cid:logo" onerror="unsafe()">'} email="ada@example.test" folder="Sent" messageId="message-1" />);
    });
    await settleIframe();
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('sandbox')).toBe('allow-same-origin allow-popups');
    expect(iframe?.srcdoc).not.toContain('<script>');
    expect(iframe?.srcdoc).not.toContain('onerror');
    expect(iframe?.srcdoc).toContain('/api/mail/messages/message-1/cid/logo');
    expect(iframe?.srcdoc).toContain('folder=Sent');
    expect(iframe?.srcdoc).toContain('referrerpolicy="no-referrer"');
    expect(iframe?.srcdoc).toContain('loading="eager"');
  });

  it('promotes script-dependent deferred images and appends the theme override', async () => {
    act(() => {
      root.render(<MailBody bodyHtml={'<style>body{background:#000}</style><img data-src="https://images.example.test/logo.png">'} />);
    });
    await settleIframe();
    const source = container.querySelector('iframe')?.srcdoc || '';
    expect(source).toContain('src="https://images.example.test/logo.png"');
    expect(source).toContain('data-gnosi-remote-image="pending"');
    expect(source).toContain('background: #fff !important');
    expect(source.lastIndexOf('background: #fff !important'))
      .toBeGreaterThan(source.indexOf('body{background:#000}'));
  });

  it('updates the isolated canvas when the mail theme changes', async () => {
    act(() => { root.render(<MailBody bodyHtml="<p>Hello</p>" />); });
    await settleIframe();
    expect(container.querySelector('iframe')?.srcdoc).toContain('background: #fff');
    act(() => {
      writeStorage(MAIL_DARK_BODY_KEY, '1');
      emitAppEvent(MAIL_DARK_BODY_EVENT);
    });
    await settleIframe();
    const darkSource = container.querySelector('iframe')?.srcdoc || '';
    expect(darkSource).toContain('background: #1a1a1a');
    expect(darkSource).toContain('.gnosi-remote-image-alt');
    expect(darkSource).toContain('color: #e2e8f0');
  });

  it('keeps the remote-image fallback readable in the light canvas', async () => {
    act(() => {
      root.render(<MailBody bodyHtml={'<img alt="Fixture chart" height="180" width="320" src="https://images.example.test/chart.png">'} />);
    });
    await settleIframe();
    const source = container.querySelector('iframe')?.srcdoc || '';
    expect(source).toContain('color: #334155');
    expect(source).toContain('background: #f5f6f8');
    expect(source).not.toContain('https://images.example.test/chart.png');
  });
});
