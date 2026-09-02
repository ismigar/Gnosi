import { describe, expect, it, vi } from 'vitest';

import {
  buildMailHtmlDocument,
  buildQuotedMailHtml,
  detectMailFormLinks,
  installRemoteMailImageRecovery,
  linkPlainMailText,
  normalizeMailEntities,
  sanitizeMailHtml,
} from './mailViewerModel';


describe('mailViewerModel', () => {
  it('removes scripts and inline handlers from remote HTML', () => {
    expect(sanitizeMailHtml('<p onclick="bad()">Safe</p><script>bad()</script>'))
      .toBe('<p >Safe</p>');
  });

  it('escapes plain text before linking URLs', () => {
    expect(linkPlainMailText('<script>x</script> https://example.test'))
      .toContain('&lt;script&gt;x&lt;/script&gt; <a href="https://example.test"');
  });

  it('deduplicates supported form links', () => {
    expect(detectMailFormLinks(
      'https://forms.gle/abc https://forms.gle/abc',
      '',
    )).toEqual(['https://forms.gle/abc']);
  });

  it('normalizes only usable extracted entities', () => {
    expect(normalizeMailEntities({
      contacts: [{ email: 'ada@example.test', name: 'Ada' }, { email: 'missing' }],
      events: [{ start: '2026-09-01', title: 'Review' }, null],
    })).toEqual({
      contacts: [{ company: '', email: 'ada@example.test', name: 'Ada', notes: '', phone: '' }],
      events: [{ description: '', end: '', location: '', start: '2026-09-01', title: 'Review' }],
    });
  });

  it('escapes reply headers and rewrites inline CID images', () => {
    const t = (key: string): string => key;
    const quoted = buildQuotedMailHtml({
      account: 'ada@example.test',
      body_html: '<img src="cid:image-1">',
      date: 'today',
      id: 'message-1',
      sender: '<script>Ada</script>',
      subject: '<b>Subject</b>',
    }, '', t);
    expect(quoted).toContain('&lt;script&gt;Ada&lt;/script&gt;');
    expect(quoted).toContain('/api/mail/messages/message-1/cid/image-1');
    expect(quoted).not.toContain('<b>Subject</b>');
  });

  it('marks safe remote images and blocks embedded URL credentials', () => {
    const source = buildMailHtmlDocument(
      '<base href="https://redirect.invalid/"><img src="https://images.example.test/a.png"><img src="https://user:secret@images.example.test/private.png">',
      { themeCss: '' },
    );
    const document = new DOMParser().parseFromString(source, 'text/html');
    const images = [...document.querySelectorAll('img')];

    expect(document.querySelector('base')).toBeNull();
    expect(images[0]?.dataset.gnosiRemoteImage).toBe('pending');
    expect(images[1]?.dataset.gnosiRemoteImage).toBe('blocked');
    expect(images[1]?.hasAttribute('src')).toBe(false);
    expect(source).not.toContain('user:secret');
  });

  it('uses one backend recovery after direct failure, then installs a safe fallback', async () => {
    const document = new DOMParser().parseFromString(
      '<img data-gnosi-remote-image="pending" src="https://images.example.test/a.png">',
      'text/html',
    );
    const image = document.querySelector('img');
    if (!image) throw new Error('Missing image fixture');
    Object.defineProperty(image, 'complete', { configurable: true, value: false });
    const recoverSource = vi.fn().mockResolvedValue('blob:recovered-image');
    const releaseRecoveredSource = vi.fn();
    const cleanup = installRemoteMailImageRecovery(document, {
      fallbackLabel: 'Remote image unavailable',
      recoveryActionLabel: 'Load safely',
      recoveringLabel: 'Loading safely…',
      recoverSource,
      releaseRecoveredSource,
      timeoutMs: 100,
    });

    image.dispatchEvent(new Event('error'));
    expect(recoverSource).not.toHaveBeenCalled();
    const recoveryButton = document.querySelector<HTMLButtonElement>(
      '.gnosi-remote-image-recover',
    );
    expect(recoveryButton?.textContent).toBe('Load safely');
    recoveryButton?.click();
    await vi.waitFor(() => {
      expect(image.dataset.gnosiRemoteImage).toBe('recovered');
    });
    expect(recoverSource).toHaveBeenCalledOnce();
    expect(recoverSource).toHaveBeenCalledWith('https://images.example.test/a.png');
    expect(image.src).toBe('blob:recovered-image');
    image.dispatchEvent(new Event('error'));

    const fallback = document.querySelector('[data-gnosi-remote-image="unavailable"]');
    expect(fallback?.getAttribute('role')).toBe('img');
    expect(fallback?.getAttribute('aria-label')).toBe('Remote image unavailable');
    expect(document.querySelector('img')).toBeNull();
    expect(releaseRecoveredSource).toHaveBeenCalledWith('blob:recovered-image');
    cleanup();
  });
});
