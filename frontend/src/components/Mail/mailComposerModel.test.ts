import { describe, expect, it } from 'vitest';

import {
  appendUniqueFiles,
  buildMailFormData,
  composerInitialHtml,
  hasComposerContent,
} from './mailComposerModel';


describe('mailComposerModel', () => {
  it('builds reply content with the signature before the quoted message', () => {
    expect(composerInitialHtml('', '<p>Quoted</p>', '<p>Ada</p>')).toBe(
      '<div style="margin-bottom:0.5rem"><p>Ada</p></div>'
      + '<hr style="border:none;border-top:1px solid #ccc;margin:0.5rem 0">'
      + '<p>Quoted</p>',
    );
    expect(composerInitialHtml('<p>Draft</p>', '<p>Quoted</p>', '<p>Ada</p>'))
      .toBe('<p>Draft</p>');
  });

  it('detects visible content while ignoring empty markup', () => {
    expect(hasComposerContent('<p> </p>', '', '')).toBe(false);
    expect(hasComposerContent('<p>Hello</p>', '', '')).toBe(true);
    expect(hasComposerContent('', 'Subject', '')).toBe(true);
  });

  it('deduplicates attachments by name and size', () => {
    const first = new File(['same'], 'notes.txt');
    const duplicate = new File(['same'], 'notes.txt');
    const different = new File(['longer'], 'notes.txt');
    expect(appendUniqueFiles([first], [duplicate, different]))
      .toEqual([first, different]);
  });

  it('materializes the multipart identity and signature contract', () => {
    const attachment = new File(['content'], 'notes.txt');
    const data = buildMailFormData({
      attachments: [attachment],
      bcc: 'bcc@example.test',
      body: '<p>Hello</p>',
      cc: 'cc@example.test',
      fromAccount: {
        display_name: 'Ada Lovelace',
        email: 'ada@example.test',
        signature: '<p>Ada</p>',
        smtp_email: 'smtp@example.test',
      },
      isReplyOrForward: false,
      signatureHtml: '<p>Ada</p>',
      subject: 'Engine',
      to: 'charles@example.test',
    });
    expect(data.get('body')).toBe(
      '<p>Hello</p><div style="margin-top:1rem"><p>Ada</p></div>',
    );
    expect(data.get('from_email')).toBe('ada@example.test');
    expect(data.get('from_name')).toBe('Ada Lovelace');
    expect(data.get('attachments')).toBe(attachment);
  });
});
