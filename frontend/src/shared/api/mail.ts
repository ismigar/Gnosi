import type { components } from '../../generated/openapi';
import { apiClient } from './client';
import { assertApiSuccess, unwrapApiResult } from './errors';

export type MailCounts = components['schemas']['MailCountsResponse'];
export type MailMessage = components['schemas']['MailMessageResponse'];
export type MailMessages = components['schemas']['MailMessagesResponse'];
export type MailThread = components['schemas']['MailThreadResponse'];
export type MailStatus = components['schemas']['MailStatusResponse'];
export type MailSync = components['schemas']['MailSyncResponse'];
export type MailDraft = components['schemas']['MailDraftSaveResponse'];
export type MailSuggestions =
  components['schemas']['MailRecipientSuggestionsResponse'];
export type MailFolders = components['schemas']['MailFoldersResponse'];
export type MailBatch = components['schemas']['MailBatchResponse'];
export type MailGeneratedDraft =
  components['schemas']['MailGenerateDraftResponse'];
export type MailEntities = components['schemas']['MailExtractEntitiesResponse'];
export type MailView = components['schemas']['MailViewResponse'];
export type MailTag = components['schemas']['MailTagResponse'];
export type MailTaggedMessages =
  components['schemas']['MailTaggedMessagesResponse'];
export type MailTagsByMessage =
  components['schemas']['MailTagsByMessageResponse'];
export type MailAccountEnabled =
  components['schemas']['MailAccountEnabledResponse'];

type GeneratedDraftInput = components['schemas']['MailDraftSaveRequest'];
type GeneratedViewCreate = components['schemas']['MailViewCreateSchema'];
type GeneratedViewUpdate = components['schemas']['MailViewUpdateSchema'];
type GeneratedTagCreate = components['schemas']['MailTagCreateSchema'];
type GeneratedTagUpdate = components['schemas']['MailTagUpdateSchema'];
type GeneratedMessageTags = components['schemas']['MailMessageTagsSetSchema'];

export type MailDraftInput = Partial<GeneratedDraftInput>;
export type MailViewCreate = Pick<GeneratedViewCreate, 'name'> &
  Partial<Omit<GeneratedViewCreate, 'name'>>;
export type MailViewUpdate = Partial<GeneratedViewUpdate>;
export type MailTagCreate = Pick<GeneratedTagCreate, 'name'> &
  Partial<Omit<GeneratedTagCreate, 'name'>>;
export type MailTagUpdate = Partial<GeneratedTagUpdate>;
export type MailMessageTagsInput = Pick<GeneratedMessageTags, 'tag_ids'> &
  Partial<Omit<GeneratedMessageTags, 'tag_ids'>>;

export interface MailMessagesQuery {
  readonly category?: string;
  readonly email?: string;
  readonly folder?: string;
  readonly force?: boolean;
  readonly limit?: number;
  readonly offset?: number;
  readonly pageToken?: string;
  readonly search?: string;
}

export interface MailMessageQuery {
  readonly email?: string;
  readonly folder?: string;
}

export async function fetchMailCounts(
  email: string,
  signal?: AbortSignal,
): Promise<MailCounts> {
  return unwrapApiResult<MailCounts, unknown>(
    await apiClient.GET('/api/mail/counts', {
      params: { query: { email } },
      signal,
    }),
  );
}

export async function fetchMailMessages(
  query: MailMessagesQuery,
  signal?: AbortSignal,
): Promise<MailMessages> {
  return unwrapApiResult<MailMessages, unknown>(
    await apiClient.GET('/api/mail/messages', {
      params: {
        query: {
          category: query.category,
          email: query.email,
          folder: query.folder,
          force: query.force,
          limit: query.limit,
          offset: query.offset,
          page_token: query.pageToken,
          search: query.search,
        },
      },
      signal,
    }),
  );
}

export async function fetchMailMessage(
  messageId: string,
  query: MailMessageQuery = {},
  signal?: AbortSignal,
): Promise<MailMessage> {
  return unwrapApiResult<MailMessage, unknown>(
    await apiClient.GET('/api/mail/messages/{message_id}', {
      params: {
        path: { message_id: messageId },
        query: { email: query.email, folder: query.folder },
      },
      signal,
    }),
  );
}

export async function fetchMailThread(
  threadId: string,
  email: string,
  signal?: AbortSignal,
): Promise<MailThread> {
  return unwrapApiResult<MailThread, unknown>(
    await apiClient.GET('/api/mail/threads/{thread_id}', {
      params: { path: { thread_id: threadId }, query: { email } },
      signal,
    }),
  );
}

export async function syncMail(
  email?: string,
  limit = 50,
): Promise<MailSync> {
  return unwrapApiResult<MailSync, unknown>(
    await apiClient.POST('/api/mail/sync', {
      params: { query: { email, limit } },
    }),
  );
}

export async function saveMailDraft(input: MailDraftInput): Promise<MailDraft> {
  return unwrapApiResult<MailDraft, unknown>(
    await apiClient.POST('/api/mail/drafts', {
      body: {
        account: '',
        bcc: '',
        body: '',
        cc: '',
        subject: '',
        to: '',
        ...input,
      },
    }),
  );
}

export async function deleteMailDraft(draftId: string): Promise<MailStatus> {
  return unwrapApiResult<MailStatus, unknown>(
    await apiClient.DELETE('/api/mail/drafts/{draft_id}', {
      params: { path: { draft_id: draftId } },
    }),
  );
}

export async function fetchMailRecipientSuggestions(
  query: string,
  email?: string,
  signal?: AbortSignal,
): Promise<MailSuggestions> {
  return unwrapApiResult<MailSuggestions, unknown>(
    await apiClient.GET('/api/mail/recipients/suggest', {
      params: { query: { email, q: query } },
      signal,
    }),
  );
}

export async function fetchMailFolders(
  email: string,
  signal?: AbortSignal,
): Promise<MailFolders> {
  return unwrapApiResult<MailFolders, unknown>(
    await apiClient.GET('/api/mail/folders', {
      params: { query: { email } },
      signal,
    }),
  );
}

export async function moveMailMessage(
  messageId: string,
  email: string,
  input: components['schemas']['MailMoveRequest'],
): Promise<MailStatus> {
  return unwrapApiResult<MailStatus, unknown>(
    await apiClient.POST('/api/mail/messages/{message_id}/move', {
      body: input,
      params: { path: { message_id: messageId }, query: { email } },
    }),
  );
}

export async function batchMailMessages(
  email: string,
  action: string,
  ids: string[],
): Promise<MailBatch> {
  return unwrapApiResult<MailBatch, unknown>(
    await apiClient.POST('/api/mail/batch', {
      body: { action, ids },
      params: { query: { email } },
    }),
  );
}

export async function markMailRead(
  messageId: string,
  email: string,
  folder?: string,
): Promise<MailStatus> {
  return unwrapApiResult<MailStatus, unknown>(
    await apiClient.POST('/api/mail/messages/{message_id}/read', {
      params: {
        path: { message_id: messageId },
        query: { email, folder },
      },
    }),
  );
}

export async function snoozeMailMessage(
  messageId: string,
  snoozeUntil: string,
): Promise<MailStatus> {
  return unwrapApiResult<MailStatus, unknown>(
    await apiClient.POST('/api/mail/messages/{message_id}/snooze', {
      body: { snooze_until: snoozeUntil },
      params: { path: { message_id: messageId } },
    }),
  );
}

export async function starMailMessage(
  messageId: string,
  email: string,
  starred: boolean,
): Promise<MailStatus> {
  return unwrapApiResult<MailStatus, unknown>(
    await apiClient.POST('/api/mail/messages/{message_id}/star', {
      body: { starred },
      params: { path: { message_id: messageId }, query: { email } },
    }),
  );
}

async function mailAction(
  path: '/api/mail/messages/{message_id}/archive' | '/api/mail/messages/{message_id}/trash',
  messageId: string,
  email: string,
  folder?: string,
): Promise<MailStatus> {
  return unwrapApiResult<MailStatus, unknown>(
    await apiClient.POST(path, {
      params: { path: { message_id: messageId }, query: { email, folder } },
    }),
  );
}

export const archiveMailMessage = (
  messageId: string,
  email: string,
  folder?: string,
) => mailAction('/api/mail/messages/{message_id}/archive', messageId, email, folder);

export const trashMailMessage = (
  messageId: string,
  email: string,
  folder?: string,
) => mailAction('/api/mail/messages/{message_id}/trash', messageId, email, folder);

export async function spamMailMessage(
  messageId: string,
  email: string,
  spam: boolean,
): Promise<MailStatus> {
  return unwrapApiResult<MailStatus, unknown>(
    await apiClient.POST('/api/mail/messages/{message_id}/spam', {
      body: { spam },
      params: { path: { message_id: messageId }, query: { email } },
    }),
  );
}

export async function emptyMailFolder(
  email: string,
  folder: string,
): Promise<MailStatus> {
  return unwrapApiResult<MailStatus, unknown>(
    await apiClient.POST('/api/mail/empty_folder', {
      params: { query: { email, folder } },
    }),
  );
}

export async function generateMailDraft(
  context: string,
  prompt?: string,
): Promise<MailGeneratedDraft> {
  return unwrapApiResult<MailGeneratedDraft, unknown>(
    await apiClient.POST('/api/mail/ai/generate_draft', {
      body: { context, prompt: prompt || 'Write a professional response.' },
    }),
  );
}

export interface MailAnalysisMetadata {
  readonly attachments?: readonly string[];
  readonly recipients?: readonly string[];
  readonly sender?: string;
}


export async function extractMailEntities(
  context: string,
  metadata: MailAnalysisMetadata = {},
): Promise<MailEntities> {
  return unwrapApiResult<MailEntities, unknown>(
    await apiClient.POST('/api/mail/ai/extract_entities', {
      body: {
        attachments: [...(metadata.attachments ?? [])],
        context,
        recipients: [...(metadata.recipients ?? [])],
        sender: metadata.sender ?? '',
      },
    }),
  );
}

export async function setMailAccountEnabled(
  email: string,
  enabled: boolean,
): Promise<MailAccountEnabled> {
  return unwrapApiResult<MailAccountEnabled, unknown>(
    await apiClient.PATCH('/api/mail/accounts/{email}/enabled', {
      body: { enabled },
      params: { path: { email } },
    }),
  );
}

export async function fetchMailViews(signal?: AbortSignal): Promise<MailView[]> {
  return unwrapApiResult<MailView[], unknown>(
    await apiClient.GET('/api/mail/views', { signal }),
  );
}

export async function createMailView(input: MailViewCreate): Promise<MailView> {
  const { name, ...options } = input;
  return unwrapApiResult<MailView, unknown>(
    await apiClient.POST('/api/mail/views', {
      body: {
        filter_logic: 'AND',
        group_by: 'none',
        name,
        sort_by: 'date',
        sort_dir: 'desc',
        ...options,
      },
    }),
  );
}

export async function updateMailView(
  viewId: string,
  input: MailViewUpdate,
): Promise<MailView> {
  return unwrapApiResult<MailView, unknown>(
    await apiClient.PUT('/api/mail/views/{view_id}', {
      body: input as GeneratedViewUpdate,
      params: { path: { view_id: viewId } },
    }),
  );
}

export async function deleteMailView(viewId: string): Promise<void> {
  assertApiSuccess(
    await apiClient.DELETE('/api/mail/views/{view_id}', {
      params: { path: { view_id: viewId } },
    }),
  );
}

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

export async function fetchMailMessageTags(messageId: string): Promise<string[]> {
  return unwrapApiResult<string[], unknown>(
    await apiClient.GET('/api/mail/messages/{message_id}/tags', {
      params: { path: { message_id: messageId } },
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
      body: { message_ids: messageIds },
    }),
  );
}
