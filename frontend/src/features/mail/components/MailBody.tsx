import { useEffect, useRef, useState } from 'react';

import {
  subscribeElementEvent,
  subscribeWindowEvent,
} from '../../../shared/platform/browser-events';
import { subscribeAppSignal } from '../../../shared/platform/app-events';
import { fetchRemoteMailImage } from '../../../shared/api/mail-specialized';
import {
  buildMailHtmlDocument,
  installRemoteMailImageRecovery,
  linkPlainMailText,
  MAIL_DARK_BODY_EVENT,
  readMailDarkBody,
} from './mailViewerModel';


const EMAIL_CSS_LIGHT = `
html, body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; line-height: 1.6; color: #111 !important; background: #fff !important; color-scheme: light; }
body > :where(table, div, section, main) { background-color: transparent !important; }
img { max-width: 100% !important; height: auto !important; display: inline-block; }
table { max-width: 100% !important; border-collapse: collapse; }
td, th { word-break: break-word; }
pre, code { white-space: pre-wrap; word-break: break-word; }
a { color: #3b82f6; }
* { box-sizing: border-box; }
.gnosi-remote-image-fallback { display: inline-flex; min-height: 52px; min-width: 160px; max-width: 100%; flex-direction: column; gap: 8px; align-items: center; justify-content: center; padding: 12px; border: 1px dashed #aeb4bd; border-radius: 8px; color: #5f6670; background: #f5f6f8; font-size: 12px; text-align: center; }
.gnosi-remote-image-recover { appearance: none; border: 1px solid #94a3b8; border-radius: 7px; padding: 5px 9px; color: #334155; background: #fff; font: inherit; font-weight: 600; cursor: pointer; }
.gnosi-remote-image-recover:hover { border-color: #3b82f6; color: #2563eb; }
.gnosi-remote-image-recover:disabled { cursor: wait; opacity: .65; }
.gnosi-remote-image-detail { max-width: 320px; opacity: .8; }
`;
const EMAIL_CSS_DARK = `
html, body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; line-height: 1.6; color: #e6e6e6 !important; background: #1a1a1a !important; color-scheme: dark; }
body > :where(table, div, section, main) { background-color: transparent !important; }
img { max-width: 100% !important; height: auto !important; display: inline-block; }
table { max-width: 100% !important; border-collapse: collapse; }
td, th { word-break: break-word; color: inherit; }
pre, code { white-space: pre-wrap; word-break: break-word; background: #2a2a2a; color: #e6e6e6; }
a { color: #6ea8fe; }
blockquote { border-left: 3px solid #444; color: #c0c0c0; }
hr { border-color: #444; }
* { box-sizing: border-box; }
.gnosi-remote-image-fallback { display: inline-flex; min-height: 52px; min-width: 160px; max-width: 100%; flex-direction: column; gap: 8px; align-items: center; justify-content: center; padding: 12px; border: 1px dashed #555d68; border-radius: 8px; color: #c0c6ce; background: #25282d; font-size: 12px; text-align: center; }
.gnosi-remote-image-recover { appearance: none; border: 1px solid #64748b; border-radius: 7px; padding: 5px 9px; color: #dbeafe; background: #1e293b; font: inherit; font-weight: 600; cursor: pointer; }
.gnosi-remote-image-recover:hover { border-color: #60a5fa; color: #bfdbfe; }
.gnosi-remote-image-recover:disabled { cursor: wait; opacity: .65; }
.gnosi-remote-image-detail { max-width: 320px; opacity: .8; }
`;


interface MailBodyProps {
  readonly bodyHtml?: string | null;
  readonly bodyText?: string | null;
  readonly email?: string | null;
  readonly folder?: string | null;
  readonly messageId?: string | null;
  readonly remoteImageBlockedLabel?: string;
  readonly remoteImageRecoveryLabel?: string;
  readonly remoteImageRecoveringLabel?: string;
  readonly remoteImageUnavailableDetail?: string;
  readonly remoteImageUnavailableLabel?: string;
}


export function MailBody({
  bodyHtml,
  bodyText,
  email,
  folder,
  messageId,
  remoteImageBlockedLabel = 'Remote image blocked for privacy',
  remoteImageRecoveryLabel = 'Load safely',
  remoteImageRecoveringLabel = 'Loading safely…',
  remoteImageUnavailableDetail = 'The origin blocked access or requires data that Gnosi does not send.',
  remoteImageUnavailableLabel = 'Remote image unavailable',
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
    const abortController = new AbortController();
    const recoveryCleanups: Array<() => void> = [];
    const objectUrls = new Set<string>();
    const releaseRecoveredSource = (source: string): void => {
      if (!objectUrls.delete(source)) return;
      URL.revokeObjectURL(source);
    };
    const recoverSource = async (source: string): Promise<string | null> => {
      try {
        const body = await fetchRemoteMailImage(source, abortController.signal);
        if (!body) return null;
        const objectUrl = URL.createObjectURL(body);
        objectUrls.add(objectUrl);
        return objectUrl;
      } catch {
        return null;
      }
    };
    const setupDocument = (): void => {
      try {
        const document = iframe.contentDocument;
        if (!document) return;
        for (const anchor of document.querySelectorAll('a')) {
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
        }
        recoveryCleanups.push(installRemoteMailImageRecovery(document, {
          fallbackLabel: remoteImageUnavailableLabel,
          fallbackDetail: remoteImageUnavailableDetail,
          onStateChange: () => {
            setHeight(Math.max(200, document.documentElement.scrollHeight + 20));
          },
          recoveryActionLabel: remoteImageRecoveryLabel,
          recoveryPromptLabel: remoteImageBlockedLabel,
          recoveringLabel: remoteImageRecoveringLabel,
          recoverSource,
          releaseRecoveredSource,
        }));
        setHeight(Math.max(200, document.documentElement.scrollHeight + 20));
      } catch {
        // A cross-origin iframe body cannot be inspected.
      }
    };
    setupDocument();
    const unsubscribeLoad = subscribeElementEvent(iframe, 'load', setupDocument);
    const pollTimer = setInterval(setupDocument, 100);
    const stopPollTimer = setTimeout(() => { clearInterval(pollTimer); }, 2000);
    return () => {
      abortController.abort();
      clearInterval(pollTimer);
      clearTimeout(stopPollTimer);
      unsubscribeLoad();
      recoveryCleanups.forEach((cleanup) => { cleanup(); });
      objectUrls.forEach((source) => { URL.revokeObjectURL(source); });
      objectUrls.clear();
    };
  }, [
    bodyHtml,
    darkBody,
    email,
    folder,
    messageId,
    remoteImageBlockedLabel,
    remoteImageRecoveryLabel,
    remoteImageRecoveringLabel,
    remoteImageUnavailableDetail,
    remoteImageUnavailableLabel,
  ]);

  if (bodyHtml) {
    return (
      <iframe
        ref={iframeRef}
        srcDoc={buildMailHtmlDocument(bodyHtml, {
          email,
          folder,
          messageId,
          themeCss: darkBody ? EMAIL_CSS_DARK : EMAIL_CSS_LIGHT,
        })}
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
