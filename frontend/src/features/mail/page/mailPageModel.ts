import type { IntegrationsDocument } from '../../../shared/api/integrations';
import type { MailCounts, MailView } from '../../../shared/api/mail';


export interface MailAccount {
  readonly [key: string]: unknown;
  readonly aliases?: readonly MailAccount[];
  readonly display_name?: string | null;
  readonly email?: string | null;
  readonly enabled?: boolean | null;
  readonly name?: string | null;
  readonly signature?: string | null;
  readonly smtp_email?: string | null;
  readonly subject_prefix?: string | null;
  readonly username?: string | null;
}


export interface MailPageMessage {
  readonly [key: string]: unknown;
  readonly body_text?: string | null;
  readonly cc?: string | readonly string[] | null;
  readonly id: string;
  readonly imap_folder?: string | null;
  readonly imap_uid?: string | null;
  readonly recipient?: string | readonly string[] | null;
  readonly source?: string | null;
  readonly subject?: string | null;
  readonly type?: string | null;
}


export interface MailComposeData {
  readonly _draftId?: string | null;
  readonly initialBody?: string;
  readonly initialCc?: string | readonly string[];
  readonly initialSubject?: string;
  readonly initialTo?: string | readonly string[];
  readonly mode?: 'forward' | 'reply' | 'reply_all' | null;
  readonly quotedHtml?: string;
  readonly replyToMessageId?: string | null;
  readonly sourceFolder?: string;
}


export interface MailUndoExtra {
  readonly imap_folder?: string | null;
  readonly imap_uid?: string | null;
}


export interface MailUndoAction extends MailUndoExtra {
  readonly email: string;
  readonly mailId: string;
  readonly type: string;
}


export interface MailAccountCatalog {
  readonly accounts: MailAccount[];
  readonly defaultAccount: MailAccount | null;
  readonly identities: MailAccount[];
  readonly selectedAccount: MailAccount | null;
}


export interface MailPageSelection {
  readonly activeCategory: string | null;
  readonly activeFolder: string | null;
  readonly activeTagId: string | null;
  readonly activeView: MailView | null;
}


function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}


function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function isOptionalString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}


function isOptionalBoolean(value: unknown): value is boolean | null | undefined {
  return value === undefined || value === null || typeof value === 'boolean';
}


function normalizeMailIdentity(value: unknown): MailAccount | null {
  if (!isUnknownRecord(value)) return null;
  if (
    !isOptionalString(value.display_name)
    || !isOptionalString(value.email)
    || !isOptionalBoolean(value.enabled)
    || !isOptionalString(value.name)
    || !isOptionalString(value.signature)
    || !isOptionalString(value.smtp_email)
    || !isOptionalString(value.subject_prefix)
    || !isOptionalString(value.username)
  ) return null;
  return value;
}


function normalizeMailAccount(value: unknown): MailAccount | null {
  const account = normalizeMailIdentity(value);
  if (!account) return null;
  const rawAliases = account.aliases;
  const aliases = isUnknownArray(rawAliases)
    ? rawAliases
      .map(normalizeMailIdentity)
      .filter((alias): alias is MailAccount => alias !== null)
    : [];
  return { ...account, aliases };
}


function integrationAccounts(value: unknown): MailAccount[] {
  if (!isUnknownArray(value)) return [];
  return value
    .map(normalizeMailAccount)
    .filter((account): account is MailAccount => account !== null);
}


export function mailAccountAddress(account: MailAccount): string {
  return account.email || account.username || '';
}


export function buildMailAccountCatalog(
  document: IntegrationsDocument,
): MailAccountCatalog {
  const allMail = [
    ...integrationAccounts(document.mail_accounts),
    ...integrationAccounts(document.emails),
  ];
  const seen = new Set<string>();
  const accounts = allMail.filter((account) => {
    const email = mailAccountAddress(account);
    if (!email) return false;
    const normalizedEmail = email.toLowerCase();
    if (seen.has(normalizedEmail)) return false;
    seen.add(normalizedEmail);
    return true;
  });
  const identities = accounts.flatMap((account) => {
    const parentEmail = mailAccountAddress(account);
    const aliases = (account.aliases ?? []).flatMap((alias) => {
      if (!alias.email) return [];
      return [{
        ...alias,
        name: alias.display_name || alias.email,
        smtp_email: parentEmail,
      }];
    });
    return [account, ...aliases];
  });
  const defaultEmail = typeof document.default_mail === 'string'
    ? document.default_mail
    : '';
  if (defaultEmail) {
    const defaultAccount = accounts.find(
      (account) => mailAccountAddress(account) === defaultEmail,
    ) ?? null;
    return {
      accounts,
      defaultAccount,
      identities,
      selectedAccount: defaultAccount,
    };
  }
  return {
    accounts,
    defaultAccount: accounts.at(0) ?? null,
    identities,
    selectedAccount: null,
  };
}


export function mergeMailCounts(results: readonly MailCounts[]): MailCounts {
  const merged: MailCounts = {};
  results.forEach((result) => {
    Object.entries(result).forEach(([key, value]) => {
      const current = merged[key] ?? { total: 0, unread: 0 };
      merged[key] = {
        total: current.total + value.total,
        unread: current.unread + value.unread,
      };
    });
  });
  return merged;
}


export function adjacentMail(
  messages: readonly MailPageMessage[],
  mailId: string,
): MailPageMessage | null {
  const index = messages.findIndex((message) => message.id === mailId);
  if (index < 0) return null;
  return messages.at(index + 1) ?? messages.at(index - 1) ?? null;
}


export function draftComposeData(mail: MailPageMessage): MailComposeData {
  return {
    _draftId: mail.id,
    initialBody: mail.body_text ?? '',
    initialCc: mail.cc || '',
    initialSubject: mail.subject === '(Esborrany)' ? '' : (mail.subject ?? ''),
    initialTo: mail.recipient || '',
  };
}


export function isVaultDraft(mail: MailPageMessage): boolean {
  return mail.type === 'Draft' && mail.source === 'vault';
}
