import { useEffect, useRef, useState } from 'react';

import { mailCidUrl } from '../../shared/api/mail-specialized';
import {
  subscribeElementEvent,
  subscribeWindowEvent,
} from '../../shared/platform/browser-events';
import { subscribeAppSignal } from '../../shared/platform/app-events';
import {
  linkPlainMailText,
  MAIL_DARK_BODY_EVENT,
  readMailDarkBody,
  sanitizeMailHtml,
} from './mailViewerModel';


const EMAIL_CSS_LIGHT = `
html, body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; line-height: 1.6; color: #111; background: #fff; }
img { max-width: 100% !important; height: auto !important; display: inline-block; }
table { max-width: 100% !important; border-collapse: collapse; }
td, th { word-break: break-word; }
pre, code { white-space: pre-wrap; word-break: break-word; }
a { color: #3b82f6; }
* { box-sizing: border-box; }
`;
const EMAIL_CSS_DARK = `
html, body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; line-height: 1.6; color: #e6e6e6; background: #1a1a1a; }
img { max-width: 100% !important; height: auto !important; display: inline-block; }
table { max-width: 100% !important; border-collapse: collapse; }
td, th { word-break: break-word; color: inherit; }
pre, code { white-space: pre-wrap; word-break: break-word; background: #2a2a2a; color: #e6e6e6; }
a { color: #6ea8fe; }
blockquote { border-left: 3px solid #444; color: #c0c0c0; }
hr { border-color: #444; }
* { box-sizing: border-box; }
`;


interface MailBodyProps {
  readonly bodyHtml?: string | null;
  readonly bodyText?: string | null;
  readonly email?: string | null;
  readonly folder?: string | null;
  readonly messageId?: string | null;
}


export function MailBody({
  bodyHtml,
  bodyText,
  email,
  folder,
  messageId,
}: MailBodyProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(200);
  const [darkBody, setDarkBody] = useState(readMailDarkBody);

  useEffect(() => {
    const update = (): void => { setDarkBody(readMailDarkBody()); };
    const unsubscribeTheme = subscribeAppSignal(MAIL_DARK_BODY_EVENT, update);
    const unsubscribeStorage = subscribeWindowEvent('storage', update);
    return () => {
      unsubscribeTheme();
      unsubscribeStorage();
    };
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!bodyHtml || !iframe) return undefined;
    return subscribeElementEvent(iframe, 'load', () => {
      try {
        const document = iframe.contentDocument;
        if (!document) return;
        for (const anchor of document.querySelectorAll('a')) {
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
        }
        setHeight(Math.max(200, document.documentElement.scrollHeight + 20));
      } catch {
        // A cross-origin iframe body cannot be inspected.
      }
    });
  }, [bodyHtml, darkBody]);

  if (bodyHtml) {
    const sanitized = sanitizeMailHtml(bodyHtml);
    const withCid = messageId && email
      ? sanitized.replace(/cid:([^"'\s>)]+)/gi, (_match, cid: string) => (
        mailCidUrl(messageId, cid, email, folder || 'INBOX')
      ))
      : sanitized;
    return (
      <iframe
        ref={iframeRef}
        srcDoc={`<style>${darkBody ? EMAIL_CSS_DARK : EMAIL_CSS_LIGHT}</style>${withCid}`}
        sandbox="allow-same-origin allow-popups"
        title="mail-body"
        style={{
          background: darkBody ? '#1a1a1a' : '#fff',
          border: 'none',
          borderRadius: '12px',
          display: 'block',
          height: `${String(height)}px`,
          width: '100%',
        }}
      />
    );
  }

  return (
    <div
      className="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-[var(--text-primary)]"
      dangerouslySetInnerHTML={{ __html: linkPlainMailText(bodyText || '') }}
    />
  );
}
