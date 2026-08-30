import type { BlockNoteEditor } from '@blocknote/core';
import type FullCalendar from '@fullcalendar/react';
import type { RefObject } from 'react';

import type { IntegrationsDocument } from '../../../shared/api/integrations';
import type {
  VaultPageSummary,
  VaultRegistryRecord,
} from '../../../shared/api/vaults';


export type MailComposerMode = 'forward' | 'reply' | 'reply_all' | null;


export interface MailComposerAccount {
  readonly display_name?: string | null;
  readonly email?: string | null;
  readonly name?: string | null;
  readonly signature?: string | null;
  readonly smtp_email?: string | null;
  readonly username?: string | null;
}


export interface MailComposerProps {
  readonly _draftId?: string | null;
  readonly account?: MailComposerAccount | null;
  readonly accounts?: readonly MailComposerAccount[];
  readonly initialBody?: string;
  readonly initialCc?: string;
  readonly initialSubject?: string;
  readonly initialTo?: string;
  readonly mode?: MailComposerMode;
  readonly onClose: () => void;
  readonly onDraftSaved?: () => void;
  readonly onSent?: () => void;
  readonly quotedHtml?: string;
  readonly replyToMessageId?: string | null;
  readonly sourceFolder?: string;
}


export interface MailSnippet {
  readonly content: string;
  readonly key: string;
  readonly label: string;
}


export interface StoredMailSnippet {
  readonly content: string;
  readonly id: string;
  readonly title: string;
}


export interface MailComposerCalendarData {
  readonly integrations: IntegrationsDocument;
  readonly pages: VaultPageSummary[];
  readonly tables: VaultRegistryRecord[];
}


export interface MailAvailabilitySelection {
  readonly allDay: boolean;
  readonly end: Date | null;
  readonly start: Date;
}


export interface MailComposerRefs {
  readonly calendar: RefObject<FullCalendar | null>;
  readonly editor: RefObject<BlockNoteEditor | null>;
  readonly fileInput: RefObject<HTMLInputElement | null>;
}
