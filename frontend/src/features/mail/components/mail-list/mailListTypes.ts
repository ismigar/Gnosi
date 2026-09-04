import type { MailMessage, MailView } from '../../../../shared/api/mail';
import type { MailIdentityMessage } from '../../mailIdentity';


export interface MailAccount {
  readonly email?: string | null;
  readonly enabled?: boolean | null;
  readonly username?: string | null;
}


export interface MailListMessage extends MailMessage {
  readonly account_email?: string | null;
  readonly thread_count?: number;
  readonly thread_messages?: readonly MailListMessage[];
  readonly thread_senders?: readonly string[];
  readonly thread_unread?: number;
}


export interface MailUndoExtra {
  readonly imap_folder?: string | null;
  readonly imap_uid?: string | null;
}


export interface MailListProps {
  readonly account: MailAccount | null;
  readonly accountsLoading?: boolean;
  readonly accounts?: readonly MailAccount[];
  readonly activeTagId: string | null;
  readonly activeView: MailView | null;
  readonly category: string | null;
  readonly folder: string | null;
  readonly isComposing?: boolean;
  readonly listRefreshToken: number;
  readonly onBatchDone?: () => void;
  readonly onMailRead?: (mail: MailIdentityMessage) => void;
  readonly onMessagesLoaded?: (messages: readonly MailListMessage[]) => void;
  readonly onRecordAction?: (
    type: string,
    mailId: string,
    email: string,
    extra?: MailUndoExtra,
    mail?: MailListMessage,
  ) => void;
  readonly onSelectMail: (mail: MailListMessage) => void;
  readonly onToggleMailboxSidebar: () => void;
  readonly readMail: MailIdentityMessage | null;
  readonly removedMail: MailIdentityMessage | null;
  readonly searchQuery?: string;
  readonly selectedMailIdentity?: string;
  readonly showMailboxSidebar: boolean;
}


export interface MailFolder {
  readonly name: string;
  readonly type: string;
}


export interface AnchorRect {
  readonly bottom: number;
  readonly left: number;
}


export interface InlineTagPickerState {
  readonly msgId: string;
  readonly rect: AnchorRect;
}


export interface ContextMenuState {
  readonly message: MailListMessage;
  readonly x: number;
  readonly y: number;
}


export interface MoveMenuState {
  readonly folders: readonly MailFolder[];
  readonly msg: MailListMessage;
  readonly x: number;
  readonly y: number;
}


export interface BatchMoveMenuState {
  readonly folders: readonly MailFolder[];
  readonly x: number;
  readonly y: number;
}


export type MailListAction = 'archive' | 'read' | 'star' | 'trash';


export interface MailListConfig {
  readonly filterBy?: 'attachment' | 'not_archived' | 'starred' | 'unread';
  readonly groupBy: string;
  readonly showSnippet: boolean;
  readonly showTimestamp: boolean;
  readonly sortBy: string;
  readonly sortDir: string;
}


export interface MailListConfirmation {
  readonly isOpen: boolean;
  readonly message?: string;
  readonly onConfirm?: () => unknown;
  readonly title?: string;
}
