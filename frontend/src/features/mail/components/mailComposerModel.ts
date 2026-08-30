import type { TFunction } from 'i18next';

import {
  defineStorageKey,
  jsonStorageCodec,
  readStorage,
} from '../../../shared/platform/browser-storage';
import type {
  MailComposerAccount,
  MailSnippet,
  StoredMailSnippet,
} from './mailComposerTypes';


const MAIL_SNIPPETS_KEY = defineStorageKey(
  'gnosi_mail_snippets',
  jsonStorageCodec<readonly StoredMailSnippet[]>(isStoredMailSnippetArray),
);


function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function isStoredMailSnippet(value: unknown): value is StoredMailSnippet {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.content === 'string';
}


function isStoredMailSnippetArray(
  value: unknown,
): value is readonly StoredMailSnippet[] {
  return Array.isArray(value) && value.every(isStoredMailSnippet);
}


export function accountAddress(account: MailComposerAccount | null): string {
  return account?.email || account?.username || '';
}


export function composerInitialHtml(
  initialBody: string,
  quotedHtml: string,
  signatureHtml: string,
): string {
  if (initialBody) return initialBody;
  if (!quotedHtml) return '';
  const signatureBlock = signatureHtml
    ? `<div style="margin-bottom:0.5rem">${signatureHtml}</div><hr style="border:none;border-top:1px solid #ccc;margin:0.5rem 0">`
    : '';
  return `${signatureBlock}${quotedHtml}`;
}


export function hasComposerContent(
  body: string,
  subject: string,
  to: string,
): boolean {
  const bodyText = body.replace(/<[^>]*>/g, '').trim();
  return Boolean(bodyText || subject.trim() || to.trim());
}


export function appendUniqueFiles(
  current: readonly File[],
  incoming: readonly File[],
): File[] {
  const existing = new Set(
    current.map((file) => `${file.name}:${String(file.size)}`),
  );
  return [
    ...current,
    ...incoming.filter(
      (file) => !existing.has(`${file.name}:${String(file.size)}`),
    ),
  ];
}


export function buildMailFormData(input: {
  readonly attachments: readonly File[];
  readonly bcc: string;
  readonly body: string;
  readonly cc: string;
  readonly fromAccount: MailComposerAccount;
  readonly isReplyOrForward: boolean;
  readonly signatureHtml: string;
  readonly subject: string;
  readonly to: string;
}): FormData {
  const signaturePart = !input.isReplyOrForward && input.signatureHtml
    ? `<div style="margin-top:1rem">${input.signatureHtml}</div>`
    : '';
  const data = new FormData();
  data.append('to', input.to);
  data.append('subject', input.subject);
  data.append('body', `${input.body}${signaturePart}`);
  if (input.cc) data.append('cc', input.cc);
  if (input.bcc) data.append('bcc', input.bcc);
  if (input.fromAccount.smtp_email) {
    data.append('from_email', input.fromAccount.email || '');
  }
  const displayName = input.fromAccount.display_name || input.fromAccount.name;
  if (displayName) data.append('from_name', displayName);
  for (const file of input.attachments) data.append('attachments', file);
  return data;
}


export function mailSnippets(t: TFunction): MailSnippet[] {
  const stored = readStorage(MAIL_SNIPPETS_KEY);
  if (stored) {
    return stored.map((snippet) => ({
      content: snippet.content,
      key: snippet.id,
      label: snippet.title,
    }));
  }
  return [
    {
      content: t('mail.snippet_formal_greeting'),
      key: 'snip_default_1',
      label: t('mail.snippet_formal_greeting_label', 'Formal greeting'),
    },
    {
      content: t('mail.snippet_thanks'),
      key: 'snip_default_2',
      label: t('mail.snippet_thanks_label', 'Thanks for the reply'),
    },
    {
      content: t('mail.snippet_best_regards'),
      key: 'snip_default_3',
      label: t('mail.snippet_best_regards_label', 'Formal closing'),
    },
    {
      content: t('mail.snippet_meeting'),
      key: 'snip_default_4',
      label: t('mail.snippet_meeting_label', 'Meeting proposal'),
    },
    {
      content: t('mail.snippet_following_up'),
      key: 'snip_default_5',
      label: t('mail.snippet_following_up_label', 'Follow-up'),
    },
  ];
}
