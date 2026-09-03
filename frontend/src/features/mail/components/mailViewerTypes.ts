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
  readonly account_email?: string | null;
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


export interface MailAnalysisEvidence {
  readonly confidence: number;
  readonly kind: 'summary' | 'participant' | 'attachment' | 'indicator' | 'task' | 'date';
  readonly label: string;
  readonly origin: 'message_body' | 'message_header' | 'attachment_metadata' | 'message_metadata' | 'vevent';
  readonly value: string;
}


export interface MailLocalAnalysis {
  readonly attachments: readonly MailAnalysisEvidence[];
  readonly dates: readonly MailAnalysisEvidence[];
  readonly indicators: readonly MailAnalysisEvidence[];
  readonly participants: readonly MailAnalysisEvidence[];
  readonly summary: MailAnalysisEvidence | null;
  readonly tasks: readonly MailAnalysisEvidence[];
}


export interface MailProviderAttempt {
  readonly provider: string;
  readonly status: 'success' | 'timeout' | 'unauthorized' | 'rate_limited' | 'server_error' | 'network_error' | 'invalid_response' | 'unavailable';
}


export interface MailExtractedEntities {
  readonly contacts: readonly MailExtractedContact[];
  readonly degradedReason: 'not_configured' | 'providers_failed' | null;
  readonly events: readonly MailExtractedEvent[];
  readonly localAnalysis: MailLocalAnalysis | null;
  readonly providerAttempts: readonly MailProviderAttempt[];
  readonly resultSource: 'provider' | 'local' | 'previous_valid' | null;
}


export type MailAnalysisStatus =
  | 'idle'
  | 'analyzing'
  | 'results'
  | 'local_results'
  | 'no_entities'
  | 'not_configured'
  | 'temporarily_unavailable'
  | 'invalid_response';


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
    mail?: MailViewerMessage,
  ) => void;
  readonly onClose?: () => void;
  readonly onCompose?: (request: MailComposeRequest) => void;
  readonly onMailRead?: (mail: MailViewerMessage) => void;
  readonly onMoved?: (mail: MailViewerMessage) => void;
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
