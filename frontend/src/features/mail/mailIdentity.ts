export interface MailIdentityMessage {
  readonly account?: string | null;
  readonly account_email?: string | null;
  readonly id: string;
  readonly gm_thrid?: string | null;
  readonly imap_folder?: string | null;
  readonly imap_uid?: string | null;
  readonly internet_message_id?: string | null;
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


/** Content can be shared across IMAP folders without sharing action identity. */
export function mailContentVersion(message?: MailIdentityMessage | null): string {
  const identifier = message?.internet_message_id?.trim() || '';
  return identifier.startsWith('<') && identifier.endsWith('>')
    ? identifier.slice(1, -1).trim() : identifier;
}


export function isSameMailMessageContent(
  left: MailIdentityMessage | null | undefined,
  right: MailIdentityMessage | null | undefined,
  fallbackAccount?: string | null,
): boolean {
  if (!left || !right) return false;
  const messageId = mailContentVersion(left);
  const otherMessageId = mailContentVersion(right);
  if (messageId && otherMessageId && messageId !== otherMessageId) return false;
  if (left === right || isSameMailMessage(left, right, fallbackAccount)
    || isHydratedSparseSelection(right, left, fallbackAccount)) return true;
  const account = accountIdentity(left, fallbackAccount);
  const leftGmailThread = left.gm_thrid?.trim();
  const rightGmailThread = right.gm_thrid?.trim();
  return Boolean(account && messageId
    && account === accountIdentity(right, fallbackAccount)
    && providerIdentity(left) === 'imap' && providerIdentity(right) === 'imap'
    && (!leftGmailThread || !rightGmailThread || leftGmailThread === rightGmailThread)
    && messageId === otherMessageId);
}


/** A fetched detail is authoritative for the header used to request it. */
export function canUseMailBody(
  summary: MailIdentityMessage,
  detail: MailIdentityMessage | null | undefined,
  requestedVersion: string,
  fallbackAccount?: string | null,
): boolean {
  if (!detail || (!isSameMailMessage(summary, detail, fallbackAccount)
    && !isHydratedSparseSelection(detail, summary, fallbackAccount))) return false;
  const version = mailContentVersion(summary);
  return !version || version === requestedVersion || version === mailContentVersion(detail);
}


export function isSelectedMailBody(
  message: MailIdentityMessage,
  detail: MailIdentityMessage | null | undefined,
  selected: MailIdentityMessage | null | undefined,
  fallbackAccount?: string | null,
): boolean {
  return Boolean(selected && canUseMailBody(message, detail, mailContentVersion(selected), fallbackAccount))
    || isSameMailMessageContent(message, detail, fallbackAccount);
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
    internet_message_id: mailContentVersion(detail) ? detail.internet_message_id : selected.internet_message_id,
    source: detail.source || selected.source,
    thread_id: detail.thread_id || selected.thread_id,
  };
}


function selectedDiscriminatorMatches(
  selectedValue?: string | null,
  loadedValue?: string | null,
): boolean {
  const selected = normalizeIdentityPart(selectedValue);
  return !selected || selected === normalizeIdentityPart(loadedValue);
}


function isHydratedSparseSelection(
  loaded: MailIdentityMessage,
  selected: MailIdentityMessage,
  fallbackAccount?: string | null,
): boolean {
  if (loaded.id !== selected.id) return false;
  const selectedAccount = accountIdentity(selected, fallbackAccount);
  if (selectedAccount && (tryMailMessageIdentity(selected, fallbackAccount) !== null
    || selectedAccount !== accountIdentity(loaded, fallbackAccount))) return false;
  return selectedDiscriminatorMatches(selected.source, loaded.source)
    && selectedDiscriminatorMatches(selected.imap_folder, loaded.imap_folder)
    && selectedDiscriminatorMatches(selected.imap_uid, loaded.imap_uid)
    && selectedDiscriminatorMatches(selected.thread_id, loaded.thread_id);
}


export function selectMailDisplayMessage<T extends MailIdentityMessage, U extends MailIdentityMessage>(
  loaded: T | null,
  selected: U | null,
  fallbackAccount?: string | null,
): T | U | null {
  if (!loaded || !selected) return selected;
  return isSameMailMessage(loaded, selected, fallbackAccount)
    || isHydratedSparseSelection(loaded, selected, fallbackAccount)
    ? loaded
    : selected;
}
