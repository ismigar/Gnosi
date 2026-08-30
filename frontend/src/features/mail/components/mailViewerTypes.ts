import type { CalendarListItem } from '../../../shared/api/calendar';
import type { MailTag } from '../../../shared/api/mail';


export interface MailViewerAccount {
  readonly email?: string | null;
}


export interface MailViewerAttachment extends Readonly<Record<string, unknown>> {
  readonly attachment_id?: string | number | null;
  readonly content_type?: string | null;
  readonly filename?: string | null;
  readonly part_index?: number | null;
  readonly size?: number | null;
}


export interface MailViewerMessage extends Readonly<Record<string, unknown>> {
  readonly account?: string | null;
  readonly attachments?: readonly MailViewerAttachment[] | null;
  readonly body_html?: string | null;
  readonly body_text?: string | null;
  readonly category?: string | null;
  readonly cc?: string | readonly string[] | null;
  readonly date?: string | null;
  readonly has_attachments?: boolean | null;
  readonly id: string;
  readonly imap_folder?: string | null;
  readonly imap_uid?: string | null;
  readonly is_read?: boolean | null;
  readonly is_spam?: boolean | null;
  readonly is_starred?: boolean | null;
  readonly recipient?: string | readonly string[] | null;
  readonly sender?: string | null;
  readonly snippet?: string | null;
  readonly source?: string | null;
  readonly subject?: string | null;
  readonly thread_id?: string | null;
  readonly thread_messages?: readonly MailViewerMessage[] | null;
  readonly timestamp?: number | null;
  readonly type?: string | null;
}


export interface MailExtractedContact {
  readonly company: string;
  readonly email: string;
  readonly name: string;
  readonly notes: string;
  readonly phone: string;
}


export interface MailExtractedEvent {
  readonly description: string;
  readonly end: string;
  readonly location: string;
  readonly start: string;
  readonly title: string;
}


export interface MailExtractedEntities {
  readonly contacts: readonly MailExtractedContact[];
  readonly events: readonly MailExtractedEvent[];
}


export interface MailComposeRequest {
  readonly initialCc?: string | readonly string[];
  readonly initialSubject?: string;
  readonly initialTo?: string | readonly string[];
  readonly mode: 'forward' | 'reply' | 'reply_all';
  readonly quotedHtml: string;
  readonly replyToMessageId: string;
  readonly sourceFolder: string;
}


export interface MailActionExtra {
  readonly imap_folder?: string | null;
  readonly imap_uid?: string | null;
}


export interface MailViewerProps {
  readonly account?: MailViewerAccount | null;
  readonly mail?: MailViewerMessage | null;
  readonly onActionDone?: (
    id?: string,
    action?: string,
    email?: string,
    extra?: MailActionExtra,
  ) => void;
  readonly onClose?: () => void;
  readonly onCompose?: (request: MailComposeRequest) => void;
  readonly onMailRead?: (id: string) => void;
  readonly onMoved?: (id: string) => void;
}


export interface MailViewerCalendarPickerProps {
  readonly calendars: readonly CalendarListItem[];
  readonly event: MailExtractedEvent;
  readonly onAdd: (event: MailExtractedEvent, calendarId: string) => Promise<void>;
  readonly onClose: () => void;
}


export interface MailViewerTagState {
  readonly activeIds: readonly string[];
  readonly tags: readonly MailTag[];
}
