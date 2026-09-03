import { describe, expect, it, vi } from 'vitest';

import {
  buildMailHtmlDocument,
  buildQuotedMailHtml,
  detectMailFormLinks,
  linkPlainMailText,
  normalizeMailEntities,
  sanitizeMailHtml,
} from './mailViewerModel';
import { installRemoteMailImageRecovery } from './mailRemoteImageRecovery';


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
      degradedReason: null,
      events: [{ description: '', end: '', location: '', start: '2026-09-01', title: 'Review' }],
      localAnalysis: null,
      providerAttempts: [],
      resultSource: null,
    });
  });

  it('normalizes typed local evidence and safe provider diagnostics', () => {
    expect(normalizeMailEntities({
      contacts: [],
      degraded_reason: 'providers_failed',
      events: [],
      local_analysis: {
        attachments: [],
        dates: [],
        indicators: [],
        participants: [],
        summary: {
          confidence: 1,
          kind: 'summary',
          label: 'extractive_summary',
          origin: 'message_body',
          value: 'Literal sentence.',
        },
        tasks: [],
      },
      provider_attempts: [{ provider: 'primary', status: 'timeout' }],
      result_source: 'local',
    })).toMatchObject({
      degradedReason: 'providers_failed',
      localAnalysis: { summary: { value: 'Literal sentence.' } },
      providerAttempts: [{ provider: 'primary', status: 'timeout' }],
      resultSource: 'local',
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

  it('defers safe remote images, blocks unsafe sources and installs a restrictive CSP', () => {
    const source = buildMailHtmlDocument(
      '<base href="https://redirect.invalid/"><picture><source srcset="https://images.example.test/large.png"><img src="https://images.example.test/a.png" srcset="https://images.example.test/a-2x.png 2x"></picture><img src="https://user:secret@images.example.test/private.png">',
      { themeCss: '' },
    );
    const document = new DOMParser().parseFromString(source, 'text/html');
    const images = [...document.querySelectorAll('img')];

    expect(document.querySelector('base')).toBeNull();
    expect(images[0]?.dataset.gnosiRemoteImage).toBe('pending');
    expect(images[0]?.hasAttribute('src')).toBe(false);
    expect(images[0]?.dataset.gnosiRemoteToken).toBe('remote-image-1');
    expect(source).not.toContain('https://images.example.test/a.png');
    expect(images[0]?.hasAttribute('srcset')).toBe(false);
    expect(document.querySelector('source')?.hasAttribute('srcset')).toBe(false);
    expect(images[1]?.dataset.gnosiRemoteImage).toBe('blocked');
    expect(images[1]?.hasAttribute('src')).toBe(false);
    expect(source).not.toContain('user:secret');
    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(policy?.getAttribute('content')).toContain("img-src 'self' data: blob:");
    expect(policy?.getAttribute('content')).toContain("connect-src 'none'");
  });

  it('only uses backend recovery after explicit consent, then installs a safe fallback', async () => {
    const document = new DOMParser().parseFromString(
      '<img alt="Quarterly chart" height="180" width="320" data-gnosi-remote-image="pending" data-gnosi-remote-token="remote-image-1">',
      'text/html',
    );
    const image = document.querySelector('img');
    if (!image) throw new Error('Missing image fixture');
    Object.defineProperty(image, 'complete', { configurable: true, value: false });
    const recoverSource = vi.fn().mockResolvedValue('blob:recovered-image');
    const releaseRecoveredSource = vi.fn();
    const openOriginalSource = vi.fn();
    const cleanup = installRemoteMailImageRecovery(document, {
      fallbackLabel: 'Remote image unavailable',
      fallbackDetail: 'The origin blocked access.',
      openOriginalLabel: 'Open original',
      openOriginalSource,
      recoveryActionLabel: 'Load safely',
      recoveryPromptLabel: 'Remote image blocked for privacy',
      recoveringLabel: 'Loading safely…',
      recoverSource,
      releaseRecoveredSource,
      retryLabel: 'Try again',
      timeoutMs: 100,
    });

    expect(recoverSource).not.toHaveBeenCalled();
    const recoveryButton = document.querySelector<HTMLButtonElement>(
      '.gnosi-remote-image-recover',
    );
    expect(recoveryButton?.textContent).toBe('Load safely');
    const offeredFallback = document.querySelector<HTMLElement>(
      '[data-gnosi-remote-image="recovery-offered"]',
    );
    expect(offeredFallback?.style.inlineSize).toBe('320px');
    expect(offeredFallback?.style.blockSize).toBe('180px');
    expect(offeredFallback?.textContent).toContain('Quarterly chart');
    document.querySelector<HTMLButtonElement>('.gnosi-remote-image-open-original')
      ?.click();
    expect(openOriginalSource).toHaveBeenCalledWith('remote-image-1');
    recoveryButton?.click();
    await vi.waitFor(() => {
      expect(image.dataset.gnosiRemoteImage).toBe('recovered');
    });
    expect(recoverSource).toHaveBeenCalledOnce();
    expect(recoverSource).toHaveBeenCalledWith('remote-image-1');
    expect(image.src).toBe('blob:recovered-image');
    expect(document.querySelector('img')).toBeNull();
    image.dispatchEvent(new Event('error'));

    const fallback = document.querySelector('[data-gnosi-remote-image="unavailable"]');
    expect(fallback?.getAttribute('role')).toBe('group');
    expect(fallback?.getAttribute('aria-label'))
      .toBe('Quarterly chart — Remote image unavailable');
    expect(fallback?.textContent).toContain('Quarterly chart');
    expect((fallback as HTMLElement | null)?.style.inlineSize).toBe('320px');
    expect((fallback as HTMLElement | null)?.style.blockSize).toBe('180px');
    expect(document.querySelector('img')).toBeNull();
    expect(releaseRecoveredSource).toHaveBeenCalledWith('blob:recovered-image');
    cleanup();
  });

  it('shows an actionable final state without exposing a failed source URL', async () => {
    const document = new DOMParser().parseFromString(
      '<img alt="Remote chart" height="180" width="320" data-gnosi-remote-image="pending" data-gnosi-remote-token="remote-image-1">',
      'text/html',
    );
    const image = document.querySelector('img');
    if (!image) throw new Error('Missing image fixture');
    const recoverSource = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('blob:retry-image');
    installRemoteMailImageRecovery(document, {
      fallbackLabel: 'Remote image unavailable',
      fallbackDetail: 'The origin blocked access or requires private data.',
      openOriginalLabel: 'Open original',
      recoveryActionLabel: 'Load safely',
      recoveryPromptLabel: 'Remote image blocked for privacy',
      recoveringLabel: 'Loading safely…',
      recoverSource,
      retryLabel: 'Try again',
    });

    document.querySelector<HTMLButtonElement>('.gnosi-remote-image-recover')?.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-gnosi-remote-image="unavailable"]'))
        .not.toBeNull();
    });
    expect(document.body.textContent).toContain('The origin blocked access');
    expect(document.body.textContent).toContain('Remote chart');
    expect(document.body.textContent).not.toContain('images.example.test');
    const retryButton = document.querySelector<HTMLButtonElement>('button');
    expect(retryButton?.textContent).toBe('Try again');
    retryButton?.click();
    await vi.waitFor(() => {
      expect(image.getAttribute('src')).toBe('blob:retry-image');
    });
    expect(document.querySelector('img')).toBeNull();
    image.dispatchEvent(new Event('load'));
    expect(document.querySelector('img')?.getAttribute('src')).toBe('blob:retry-image');
    expect(recoverSource).toHaveBeenCalledTimes(2);
  });

  it('keeps a stable local fallback for blocked images without a recoverable source', () => {
    const document = new DOMParser().parseFromString(
      '<img alt="Private tracking image" height="90" width="240" data-gnosi-remote-image="blocked">',
      'text/html',
    );
    installRemoteMailImageRecovery(document, {
      fallbackLabel: 'Remote image unavailable',
      fallbackDetail: 'The image cannot be loaded safely.',
      openOriginalLabel: 'Open original',
      recoveryActionLabel: 'Load safely',
      recoveryPromptLabel: 'Remote image blocked for privacy',
      recoveringLabel: 'Loading safely…',
      retryLabel: 'Try again',
    });

    const fallback = document.querySelector<HTMLElement>(
      '[data-gnosi-remote-image="unavailable"]',
    );
    expect(document.querySelector('img')).toBeNull();
    expect(fallback?.getAttribute('role')).toBe('img');
    expect(fallback?.getAttribute('aria-label'))
      .toBe('Private tracking image — Remote image unavailable');
    expect(fallback?.textContent).toContain('Private tracking image');
    expect(fallback?.style.inlineSize).toBe('240px');
    expect(fallback?.style.blockSize).toBe('90px');
    expect(fallback?.querySelector('button')).toBeNull();
  });
});
