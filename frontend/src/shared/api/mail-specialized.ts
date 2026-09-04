import { GnosiApiError } from './errors';
import type { MailStatus } from './mail';
import { transportFetch } from './transports';

export interface MailAssetQuery {
  readonly contentType?: string;
  readonly filename?: string;
  readonly folder?: string;
  readonly inline?: boolean;
}

const REMOTE_MAIL_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const MAX_REMOTE_MAIL_IMAGE_BYTES = 8 * 1024 * 1024;

export type RemoteMailImageFailureReason =
  | 'blocked'
  | 'timeout'
  | 'too_large'
  | 'unsupported'
  | 'unavailable';

export class RemoteMailImageFetchError extends Error {
  readonly reason: RemoteMailImageFailureReason;

  constructor(reason: RemoteMailImageFailureReason) {
    super(reason);
    this.name = 'RemoteMailImageFetchError';
    this.reason = reason;
  }
}

function remoteImageFailureReason(value: unknown): RemoteMailImageFailureReason {
  let code = '';
  if (value && typeof value === 'object' && 'detail' in value
    && typeof value.detail === 'string') code = value.detail;
  if (code === 'blocked_url' || code === 'invalid_url') return 'blocked';
  if (code === 'timeout') return 'timeout';
  if (code === 'image_too_large') return 'too_large';
  if (code === 'unsupported_media_type' || code === 'invalid_image') return 'unsupported';
  return 'unavailable';
}

function apiPath(path: string, query: Record<string, boolean | string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function mailEventsUrl(email?: string): string {
  return apiPath('/api/mail/events', { email });
}

export function mailAttachmentUrl(
  messageId: string,
  attachmentId: string,
  email: string,
  query: MailAssetQuery = {},
): string {
  return apiPath(
    `/api/mail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      content_type: query.contentType,
      email,
      filename: query.filename,
      folder: query.folder || 'INBOX',
      inline: query.inline,
    },
  );
}

export function mailCidUrl(
  messageId: string,
  cid: string,
  email: string,
  folder = 'INBOX',
): string {
  return apiPath(
    `/api/mail/messages/${encodeURIComponent(messageId)}/cid/${encodeURIComponent(cid)}`,
    { email, folder },
  );
}

export async function fetchRemoteMailImage(
  url: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await transportFetch('/api/mail/remote-images/fetch', {
    body: JSON.stringify({ url }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal,
  });
  const contentType = response.headers.get('content-type')
    ?.split(';', 1)[0]?.trim().toLocaleLowerCase() || '';
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined);
    throw new RemoteMailImageFetchError(remoteImageFailureReason(payload));
  }
  if (!REMOTE_MAIL_IMAGE_TYPES.has(contentType)) {
    throw new RemoteMailImageFetchError('unsupported');
  }
  const body = await response.blob();
  if (body.size === 0) throw new RemoteMailImageFetchError('unsupported');
  if (body.size > MAX_REMOTE_MAIL_IMAGE_BYTES) {
    throw new RemoteMailImageFetchError('too_large');
  }
  return body.slice(0, body.size, contentType);
}

async function multipartMailStatus(path: string, body: FormData): Promise<MailStatus> {
  const response = await transportFetch(path, { body, method: 'POST' });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw new GnosiApiError(response, payload);
  if (!payload || typeof payload !== 'object' || !('status' in payload)) {
    throw new GnosiApiError(response, 'The API returned an invalid mail status');
  }
  return { status: String(payload.status) };
}

export function sendMailMultipart(email: string, body: FormData): Promise<MailStatus> {
  return multipartMailStatus(apiPath('/api/mail/send', { email }), body);
}

export function replyMailMultipart(
  messageId: string,
  email: string,
  folder: string,
  body: FormData,
): Promise<MailStatus> {
  return multipartMailStatus(
    apiPath(`/api/mail/messages/${encodeURIComponent(messageId)}/reply`, {
      email,
      folder,
    }),
    body,
  );
}
