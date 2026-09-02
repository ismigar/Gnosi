import {
  defineStorageKey,
  readStorage,
  stringStorageCodec,
} from '../../../shared/platform/browser-storage';
import { subscribeElementEvent } from '../../../shared/platform/browser-events';
import { mailCidUrl } from '../../../shared/api/mail-specialized';
import type {
  MailExtractedContact,
  MailExtractedEntities,
  MailExtractedEvent,
  MailViewerMessage,
} from './mailViewerTypes';


export const MAIL_DARK_BODY_EVENT = 'gnosi-mail-dark-body-changed';
export const MAIL_DARK_BODY_KEY = defineStorageKey(
  'gnosi_mail_dark_body',
  stringStorageCodec,
);


function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function isReadonlyStringArray(
  value: string | readonly string[] | null | undefined,
): value is readonly string[] {
  return Array.isArray(value);
}


function recordString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}


export function cleanMailAddress(value: string | readonly string[] | null | undefined): string {
  const address = isReadonlyStringArray(value) ? value.join(', ') : value || '';
  return address.split('<')[0]?.trim().replace(/^["']+|["']+$/g, '').trim()
    || address;
}


export function sanitizeMailHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
}


interface MailHtmlDocumentOptions {
  readonly email?: string | null;
  readonly folder?: string | null;
  readonly messageId?: string | null;
  readonly themeCss: string;
}


interface RemoteMailImageRecoveryOptions {
  readonly fallbackLabel: string;
  readonly fallbackDetail: string;
  readonly onStateChange?: () => void;
  readonly recoveryPromptLabel: string;
  readonly recoveryActionLabel: string;
  readonly recoveringLabel: string;
  readonly recoverSource?: (source: string) => Promise<string | null>;
  readonly releaseRecoveredSource?: (source: string) => void;
  readonly timeoutMs?: number;
}


function deferredImageSource(image: HTMLImageElement): string {
  for (const name of [
    'data-src',
    'data-original',
    'data-lazy-src',
    'data-original-src',
    'data-image-src',
  ]) {
    const value = image.getAttribute(name)?.trim() || '';
    if (/^(?:https?:|\/\/|\/api\/|data:image\/(?:avif|gif|jpeg|png|webp);)/i.test(value)) {
      return value.startsWith('//') ? `https:${value}` : value;
    }
  }
  return '';
}


export function buildMailHtmlDocument(
  html: string,
  options: MailHtmlDocumentOptions,
): string {
  const document = new DOMParser().parseFromString(sanitizeMailHtml(html), 'text/html');
  document.querySelectorAll('base').forEach((element) => { element.remove(); });
  document.querySelectorAll('source').forEach((element) => {
    element.removeAttribute('src');
    element.removeAttribute('srcset');
  });
  for (const image of document.querySelectorAll('img')) {
    image.removeAttribute('srcset');
    const currentSource = image.getAttribute('src')?.trim() || '';
    if (currentSource.toLocaleLowerCase().startsWith('cid:')
      && options.messageId && options.email) {
      image.src = mailCidUrl(
        options.messageId,
        currentSource.slice(4),
        options.email,
        options.folder || 'INBOX',
      );
    } else {
      // Lazy-loading scripts cannot run inside the sandboxed mail canvas.
      // A deferred source is therefore authoritative even when the sender
      // supplied a transparent placeholder in src.
      const deferredSource = deferredImageSource(image);
      if (deferredSource) image.src = deferredSource;
    }
    // Set attributes explicitly so the policy is preserved in the serialized
    // srcDoc in every DOM implementation, not only in browsers that reflect
    // these properties back to attributes.
    image.setAttribute('decoding', 'async');
    image.setAttribute('loading', 'eager');
    image.setAttribute('referrerpolicy', 'no-referrer');
    const finalSource = image.getAttribute('src')?.trim() || '';
    if (/^(?:https?:)?\/\//i.test(finalSource)) {
      try {
        const normalizedSource = finalSource.startsWith('//')
          ? `https:${finalSource}`
          : finalSource;
        const parsed = new URL(normalizedSource);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
          image.removeAttribute('src');
          image.dataset.gnosiRemoteImage = 'blocked';
        } else {
          image.dataset.gnosiRemoteSource = normalizedSource;
          image.removeAttribute('src');
          image.dataset.gnosiRemoteImage = 'pending';
        }
      } catch {
        image.removeAttribute('src');
        image.dataset.gnosiRemoteImage = 'blocked';
      }
    }
  }
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = [
    "default-src 'none'",
    "img-src 'self' data: blob:",
    "style-src 'unsafe-inline'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  document.head.prepend(policy);
  const theme = document.createElement('style');
  theme.dataset.gnosiMailTheme = 'true';
  theme.textContent = options.themeCss;
  document.head.append(theme);
  return `<!doctype html>${document.documentElement.outerHTML}`;
}


export function installRemoteMailImageRecovery(
  document: Document,
  options: RemoteMailImageRecoveryOptions,
): () => void {
  const timeoutMs = options.timeoutMs ?? 8000;
  const cleanups: Array<() => void> = [];

  const monitor = (image: HTMLImageElement): void => {
    if (image.dataset.gnosiRecoveryInstalled === 'true') return;
    image.dataset.gnosiRecoveryInstalled = 'true';
    let settled = false;
    let active = true;
    let phase: 'pending' | 'offered' | 'recovering' | 'recovered' = 'pending';
    let recoveredSource: string | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = (): void => {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    };
    const releaseRecoveredSource = (): void => {
      if (!recoveredSource) return;
      options.releaseRecoveredSource?.(recoveredSource);
      recoveredSource = null;
    };
    const renderFinalFallback = (fallback: HTMLElement): void => {
      fallback.dataset.gnosiRemoteImage = 'unavailable';
      fallback.setAttribute('role', 'img');
      fallback.setAttribute('aria-label', options.fallbackLabel);
      fallback.replaceChildren();
      const label = document.createElement('span');
      label.textContent = `▧ ${options.fallbackLabel}`;
      const detail = document.createElement('span');
      detail.className = 'gnosi-remote-image-detail';
      detail.textContent = options.fallbackDetail;
      fallback.append(label, detail);
    };
    const showFinalFallback = (): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      releaseRecoveredSource();
      const fallback = document.createElement('span');
      fallback.className = 'gnosi-remote-image-fallback';
      renderFinalFallback(fallback);
      image.replaceWith(fallback);
      options.onStateChange?.();
    };
    const offerRecovery = (): void => {
      if (settled || phase !== 'pending') return;
      clearTimers();
      const source = image.dataset.gnosiRemoteSource?.trim() || '';
      if (!source || !options.recoverSource) {
        showFinalFallback();
        return;
      }
      phase = 'offered';
      const fallback = document.createElement('span');
      fallback.className = 'gnosi-remote-image-fallback';
      fallback.dataset.gnosiRemoteImage = 'recovery-offered';
      fallback.setAttribute('aria-label', options.fallbackLabel);
      fallback.setAttribute('role', 'group');
      const label = document.createElement('span');
      label.textContent = `▧ ${options.recoveryPromptLabel}`;
      const button = document.createElement('button');
      button.className = 'gnosi-remote-image-recover';
      button.type = 'button';
      button.textContent = options.recoveryActionLabel;
      fallback.append(label, button);
      image.replaceWith(fallback);
      const unsubscribeClick = subscribeElementEvent(button, 'click', () => {
        if (!active || settled || phase !== 'offered') return;
        phase = 'recovering';
        fallback.dataset.gnosiRemoteImage = 'recovering';
        fallback.setAttribute('aria-live', 'polite');
        button.disabled = true;
        button.textContent = options.recoveringLabel;
        void options.recoverSource?.(source).then((nextSource) => {
          if (!active || settled || !fallback.isConnected) {
            if (nextSource) options.releaseRecoveredSource?.(nextSource);
            return;
          }
          if (!nextSource) {
            settled = true;
            renderFinalFallback(fallback);
            options.onStateChange?.();
            return;
          }
          recoveredSource = nextSource;
          phase = 'recovered';
          image.dataset.gnosiRemoteImage = 'recovered';
          fallback.replaceWith(image);
          timeoutTimer = setTimeout(showFinalFallback, timeoutMs);
          image.src = nextSource;
          options.onStateChange?.();
        }).catch(() => {
          if (!active || settled) return;
          settled = true;
          renderFinalFallback(fallback);
          options.onStateChange?.();
        });
      });
      cleanups.push(unsubscribeClick);
      options.onStateChange?.();
    };
    const markLoaded = (): void => {
      if (settled || !image.isConnected) return;
      settled = true;
      clearTimers();
      image.dataset.gnosiRemoteImage = 'loaded';
      releaseRecoveredSource();
      options.onStateChange?.();
    };
    const unsubscribeLoad = subscribeElementEvent(image, 'load', markLoaded);
    const unsubscribeError = subscribeElementEvent(image, 'error', () => {
      if (phase === 'recovered') showFinalFallback();
    });
    cleanups.push(() => {
      active = false;
      settled = true;
      clearTimers();
      releaseRecoveredSource();
      unsubscribeLoad();
      unsubscribeError();
    });

    if (image.dataset.gnosiRemoteImage === 'blocked') {
      showFinalFallback();
      return;
    }
    offerRecovery();
  };

  document
    .querySelectorAll<HTMLImageElement>('img[data-gnosi-remote-image]')
    .forEach((image) => {
      monitor(image);
    });
  return () => { cleanups.forEach((cleanup) => { cleanup(); }); };
}


export function escapeMailHtml(value: unknown): string {
  const text = typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    ? String(value)
    : '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


export function linkPlainMailText(text: string): string {
  const escaped = escapeMailHtml(text).replace(/'/g, '&#39;');
  return escaped.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#3b82f6">$1</a>',
  );
}


export function readMailDarkBody(): boolean {
  return readStorage(MAIL_DARK_BODY_KEY) === '1';
}


export function detectMailFormLinks(html?: string | null, text?: string | null): string[] {
  const patterns = [
    /https:\/\/forms\.gle\/[a-zA-Z0-9_-]+/g,
    /https:\/\/docs\.google\.com\/forms\/[a-zA-Z0-9_/-]+/g,
    /https:\/\/[a-zA-Z0-9-]+\.typeform\.com\/to\/[a-zA-Z0-9_-]+/g,
    /https:\/\/forms\.office\.com\/[a-zA-Z0-9_-]+/g,
  ];
  const found = patterns.flatMap((pattern) => (html || text || '').match(pattern) ?? []);
  return [...new Set(found)];
}


function normalizeContact(value: unknown): MailExtractedContact | null {
  if (!isRecord(value)) return null;
  const name = recordString(value, 'name');
  if (!name) return null;
  return {
    company: recordString(value, 'company'),
    email: recordString(value, 'email'),
    name,
    notes: recordString(value, 'notes'),
    phone: recordString(value, 'phone'),
  };
}


function normalizeEvent(value: unknown): MailExtractedEvent | null {
  if (!isRecord(value)) return null;
  const title = recordString(value, 'title');
  if (!title) return null;
  return {
    description: recordString(value, 'description'),
    end: recordString(value, 'end'),
    location: recordString(value, 'location'),
    start: recordString(value, 'start'),
    title,
  };
}


export function normalizeMailEntities(value: {
  readonly contacts?: readonly unknown[];
  readonly events?: readonly unknown[];
}): MailExtractedEntities {
  return {
    contacts: (value.contacts ?? [])
      .map(normalizeContact)
      .filter((item): item is MailExtractedContact => item !== null),
    events: (value.events ?? [])
      .map(normalizeEvent)
      .filter((item): item is MailExtractedEvent => item !== null),
  };
}


export function isSentMail(
  message: MailViewerMessage,
  accountEmail: string,
): boolean {
  const sender = message.sender || '';
  const senderEmail = sender.match(/<([^>]+)>/)?.[1]?.toLocaleLowerCase()
    || sender.toLocaleLowerCase();
  return message.type === 'Sent'
    || Boolean(accountEmail && senderEmail.includes(accountEmail.toLocaleLowerCase()));
}


export function isSpamMail(message: MailViewerMessage | null): boolean {
  const folder = message?.imap_folder?.toLocaleUpperCase();
  return message?.category === 'SPAM'
    || message?.is_spam === true
    || folder === 'SPAM'
    || folder === 'JUNK'
    || folder === 'CORREU BROSSA';
}


export type MailViewerTranslate = (
  key: 'mail.date_label' | 'mail.from_label' | 'mail.subject_label',
) => string;


export function buildQuotedMailHtml(
  message: MailViewerMessage,
  fallbackEmail: string,
  t: MailViewerTranslate,
): string {
  const header = `<strong>${t('mail.from_label')}:</strong> ${escapeMailHtml(message.sender)} &nbsp;|&nbsp; <strong>${t('mail.date_label')}:</strong> ${escapeMailHtml(message.date)} &nbsp;|&nbsp; <strong>${t('mail.subject_label')}:</strong> ${escapeMailHtml(message.subject)}`;
  let content = message.body_html
    ? sanitizeMailHtml(message.body_html)
    : escapeMailHtml(message.body_text || '').replace(/\n/g, '<br>');
  const email = message.account || fallbackEmail;
  if (message.body_html && message.id && email) {
    content = content.replace(/src=(["'])cid:([^"']+)\1/gi, (_match, quote: string, cid: string) => (
      `src=${quote}${mailCidUrl(message.id, cid, email, message.imap_folder || 'INBOX')}${quote}`
    ));
  }
  return `<div style="font-size:12px;margin-bottom:6px;opacity:0.7">${header}</div><hr style="opacity:0.2;margin:6px 0">${content}`;
}


export function mailErrorDetail(error: unknown): string {
  if (!isRecord(error)) return '';
  const payload = error.payload;
  return isRecord(payload) ? recordString(payload, 'detail') : '';
}
