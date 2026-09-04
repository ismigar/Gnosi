import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { assertApiSuccess, unwrapApiResult } from './errors';

export type MailTag = components['schemas']['MailTagResponse'];
export type MailTaggedMessages =
  components['schemas']['MailTaggedMessagesResponse'];
export type MailTagsByMessage =
  components['schemas']['MailTagsByMessageResponse'];
export type MailMessageIdentityScope =
  components['schemas']['MailMessageIdentityScope'];
export type MailMessageTagDescriptor =
  components['schemas']['MailMessageTagDescriptor'];

type GeneratedTagCreate = components['schemas']['MailTagCreateSchema'];
type GeneratedTagUpdate = components['schemas']['MailTagUpdateSchema'];
type GeneratedMessageTags = components['schemas']['MailMessageTagsSetSchema'];

export type MailTagCreate = Pick<GeneratedTagCreate, 'name'> &
  Partial<Omit<GeneratedTagCreate, 'name'>>;
export type MailTagUpdate = Partial<GeneratedTagUpdate>;
export type MailMessageTagsInput = Pick<GeneratedMessageTags, 'tag_ids'> &
  Partial<Omit<GeneratedMessageTags, 'tag_ids'>>;

export async function fetchMailTags(signal?: AbortSignal): Promise<MailTag[]> {
  return unwrapApiResult<MailTag[], unknown>(
    await apiClient.GET('/api/mail/tags', { signal }),
  );
}

export async function createMailTag(input: MailTagCreate): Promise<MailTag> {
  return unwrapApiResult<MailTag, unknown>(
    await apiClient.POST('/api/mail/tags', {
      body: { color: '#3b82f6', ...input },
    }),
  );
}

export async function updateMailTag(
  tagId: string,
  input: MailTagUpdate,
): Promise<MailTag> {
  return unwrapApiResult<MailTag, unknown>(
    await apiClient.PUT('/api/mail/tags/{tag_id}', {
      body: input,
      params: { path: { tag_id: tagId } },
    }),
  );
}

export async function deleteMailTag(tagId: string): Promise<void> {
  assertApiSuccess(
    await apiClient.DELETE('/api/mail/tags/{tag_id}', {
      params: { path: { tag_id: tagId } },
    }),
  );
}

export async function fetchMailMessageTags(
  messageId: string,
  scope?: MailMessageIdentityScope,
): Promise<string[]> {
  return unwrapApiResult<string[], unknown>(
    await apiClient.GET('/api/mail/messages/{message_id}/tags', {
      params: {
        path: { message_id: messageId },
        query: {
          account_email: scope?.account_email,
          imap_folder: scope?.imap_folder,
          imap_uid: scope?.imap_uid,
          source: scope?.source,
        },
      },
    }),
  );
}

export async function setMailMessageTags(
  messageId: string,
  input: MailMessageTagsInput,
): Promise<components['schemas']['MailMessageTagsResponse']> {
  return unwrapApiResult<components['schemas']['MailMessageTagsResponse'], unknown>(
    await apiClient.POST('/api/mail/messages/{message_id}/tags', {
      body: {
        account_email: '',
        date_str: '',
        sender: '',
        subject: '',
        ...input,
      },
      params: { path: { message_id: messageId } },
    }),
  );
}

export async function fetchTaggedMailMessages(
  tagId: string,
): Promise<MailTaggedMessages> {
  return unwrapApiResult<MailTaggedMessages, unknown>(
    await apiClient.GET('/api/mail/tags/{tag_id}/messages', {
      params: { path: { tag_id: tagId } },
    }),
  );
}

export async function fetchTagsForMailMessages(
  messageIds: string[],
): Promise<MailTagsByMessage> {
  return unwrapApiResult<MailTagsByMessage, unknown>(
    await apiClient.POST('/api/mail/tags/messages/batch', {
      body: { message_ids: messageIds, messages: [] },
    }),
  );
}

export async function fetchTagsForScopedMailMessages(
  messages: MailMessageTagDescriptor[],
): Promise<MailTagsByMessage> {
  return unwrapApiResult<MailTagsByMessage, unknown>(
    await apiClient.POST('/api/mail/tags/messages/batch', {
      body: { message_ids: [], messages },
    }),
  );
}
