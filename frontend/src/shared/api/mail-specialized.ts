import { GnosiApiError } from './errors';
import type { MailStatus } from './mail';
import { transportFetch } from './transports';

export interface MailAssetQuery {
  readonly contentType?: string;
  readonly filename?: string;
  readonly folder?: string;
  readonly inline?: boolean;
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
