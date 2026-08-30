import { describe, expect, it } from 'vitest';

import {
  buildQuotedMailHtml,
  detectMailFormLinks,
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
});
