import {
  defineStorageKey,
  readStorage,
  stringStorageCodec,
} from '../../shared/platform/browser-storage';
import { mailCidUrl } from '../../shared/api/mail-specialized';
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
