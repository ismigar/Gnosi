export interface MailIdentityMessage {
  readonly account?: string | null;
  readonly account_email?: string | null;
  readonly id: string;
  readonly imap_folder?: string | null;
  readonly imap_uid?: string | null;
  readonly source?: string | null;
  readonly thread_id?: string | null;
}


export interface MailIdentityScopeDescriptor {
  readonly account_email: string;
  readonly imap_folder: string | null;
  readonly imap_uid: string | null;
  readonly source: string;
}


function normalizeIdentityPart(value?: string | null): string {
  return value?.trim().toLocaleLowerCase() ?? '';
}


function accountIdentity(
  message: MailIdentityMessage,
  fallbackAccount?: string | null,
): string {
  return normalizeIdentityPart(
    message.account || message.account_email || fallbackAccount,
  );
}


function providerIdentity(message: MailIdentityMessage): string {
  const source = normalizeIdentityPart(message.source);
  if (source) return source;
  return message.imap_uid || message.id.startsWith('imap_') ? 'imap' : '';
}


function structuralIdentity(kind: 'message' | 'thread', parts: readonly string[]): string {
  return JSON.stringify([kind, ...parts]);
}


export function tryMailMessageIdentity(
  message: MailIdentityMessage,
  fallbackAccount?: string | null,
): string | null {
  const account = accountIdentity(message, fallbackAccount);
  const provider = providerIdentity(message);
  if (!account || !provider || !message.id) return null;
  if (provider === 'imap') {
    const folder = message.imap_folder?.trim() ?? '';
    const uid = message.imap_uid?.trim() ?? '';
    if (!folder || !uid) return null;
    return structuralIdentity('message', [account, provider, folder, uid]);
  }
  return structuralIdentity('message', [account, provider, '', message.id]);
}


export function tryMailIdentityScope(
  message: MailIdentityMessage,
  fallbackAccount?: string | null,
): MailIdentityScopeDescriptor | null {
  const account = accountIdentity(message, fallbackAccount);
  const provider = providerIdentity(message);
  if (!account || !provider || !message.id) return null;
  const imapFolder = message.imap_folder?.trim() || null;
  const imapUid = message.imap_uid?.trim() || null;
  if (provider === 'imap' && (!imapFolder || !imapUid)) return null;
  return {
    account_email: account,
    imap_folder: provider === 'imap' ? imapFolder : null,
    imap_uid: provider === 'imap' ? imapUid : null,
    source: provider,
  };
}


export function mailMessageIdentity(
  message: MailIdentityMessage,
  fallbackAccount?: string | null,
): string {
  return tryMailMessageIdentity(message, fallbackAccount)
    ?? structuralIdentity('message', [
      accountIdentity(message, fallbackAccount),
      providerIdentity(message),
      message.imap_folder?.trim() ?? '',
      message.imap_uid?.trim() || message.id,
    ]);
}


export function mailThreadIdentity(
  message: MailIdentityMessage,
  fallbackAccount?: string | null,
): string {
  const account = accountIdentity(message, fallbackAccount);
  const provider = providerIdentity(message);
  const thread = message.thread_id?.trim() ?? '';
  const folder = provider === 'imap' ? message.imap_folder?.trim() ?? '' : '';
  if (!account || !provider || !thread || (provider === 'imap' && !folder)) {
    return mailMessageIdentity(message, fallbackAccount);
  }
  return structuralIdentity('thread', [account, provider, folder, thread]);
}


export function isSameMailMessage(
  left: MailIdentityMessage | null | undefined,
  right: MailIdentityMessage | null | undefined,
  fallbackAccount?: string | null,
): boolean {
  if (!left || !right) return false;
  const leftIdentity = tryMailMessageIdentity(left, fallbackAccount);
  const rightIdentity = tryMailMessageIdentity(right, fallbackAccount);
  return leftIdentity !== null && leftIdentity === rightIdentity;
}


export function hydrateMailMessageIdentity<T extends MailIdentityMessage>(
  detail: T,
  selected: MailIdentityMessage,
  fallbackAccount?: string | null,
): T {
  return {
    ...detail,
    account: detail.account || selected.account || fallbackAccount,
    account_email: detail.account_email || selected.account_email,
    imap_folder: detail.imap_folder || selected.imap_folder,
    imap_uid: detail.imap_uid || selected.imap_uid,
    source: detail.source || selected.source,
    thread_id: detail.thread_id || selected.thread_id,
  };
}


export function selectMailDisplayMessage<T extends MailIdentityMessage>(
  loaded: T | null,
  selected: T | null,
  fallbackAccount?: string | null,
): T | null {
  return isSameMailMessage(loaded, selected, fallbackAccount)
    ? loaded
    : selected;
}
