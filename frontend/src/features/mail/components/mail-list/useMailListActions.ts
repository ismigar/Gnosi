import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from 'react';
import type { TFunction } from 'i18next';

import { toast } from '../../../../shared/notifications/toast';
import {
  archiveMailMessage,
  batchMailMessages,
  deleteMailDraft,
  emptyMailFolder,
  fetchMailFolders,
  moveMailMessage,
  starMailMessage,
  trashMailMessage,
} from '../../../../shared/api/mail';
import { filterOutMailThread, mailListMessageIdentity } from './mailListModel';
import type {
  BatchMoveMenuState,
  MailAccount,
  MailFolder,
  MailListAction,
  MailListConfirmation,
  MailListMessage,
  MailUndoExtra,
  MoveMenuState,
} from './mailListTypes';


interface UseMailListActionsOptions {
  readonly account: MailAccount | null;
  readonly clearCurrentMemoryCache: () => void;
  readonly emails: readonly string[];
  readonly enabledAccounts: readonly MailAccount[];
  readonly fetchMessages: (options?: { readonly force?: boolean }) => void;
  readonly folder: string | null;
  readonly messages: readonly MailListMessage[];
  readonly onBatchDone?: () => void;
  readonly onRecordAction?: (
    type: string,
    mailId: string,
    email: string,
    extra?: MailUndoExtra,
    mail?: MailListMessage,
  ) => void;
  readonly purgeMessageFromCaches: (
    message: MailListMessage,
  ) => void;
  readonly purgeMessagesFromCaches: (messages: readonly MailListMessage[]) => void;
  readonly selectedIds: ReadonlySet<string>;
  readonly setLoading: Dispatch<SetStateAction<boolean>>;
  readonly setMessages: Dispatch<SetStateAction<MailListMessage[]>>;
  readonly setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  readonly t: TFunction;
}


interface EmailIdGroup {
  readonly email: string;
  readonly messages: MailListMessage[];
}


interface ActionResult {
  readonly identities: readonly string[];
  readonly ok: boolean;
}


function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}


function messageEmail(message: MailListMessage): string {
  return message.account_email || message.account || '';
}


function groupMessageIdsByEmail(
  messages: readonly MailListMessage[],
): EmailIdGroup[] {
  const groups: Record<string, EmailIdGroup> = {};
  messages.forEach((message) => {
    const email = messageEmail(message);
    if (!email) return;
    (groups[email] ??= { email, messages: [] }).messages.push(message);
  });
  return Object.values(groups);
}


function selectedMessages(
  messages: readonly MailListMessage[],
  identities: ReadonlySet<string>,
): MailListMessage[] {
  return messages.filter((message) => identities.has(mailListMessageIdentity(message)));
}


export function useMailListActions({
  account,
  clearCurrentMemoryCache,
  emails,
  enabledAccounts,
  fetchMessages,
  folder,
  messages,
  onBatchDone,
  onRecordAction,
  purgeMessageFromCaches,
  purgeMessagesFromCaches,
  selectedIds,
  setLoading,
  setMessages,
  setSelectedIds,
  t,
}: UseMailListActionsOptions) {
  const [confirmConfig, setConfirmConfig] = useState<MailListConfirmation>({
    isOpen: false,
  });
  const [moveMenu, setMoveMenu] = useState<MoveMenuState | null>(null);
  const [batchMoveMenu, setBatchMoveMenu] = useState<BatchMoveMenuState | null>(null);
  const foldersCacheRef = useRef<Record<string, readonly MailFolder[]>>({});

  const getFolders = useCallback(async (email: string): Promise<readonly MailFolder[]> => {
    const cached = foldersCacheRef.current[email];
    if (cached?.length) return cached;
    try {
      const folders = (await fetchMailFolders(email)).folders;
      foldersCacheRef.current[email] = folders;
      return folders;
    } catch {
      return [];
    }
  }, []);

  const handleInlineMoveOpen = useCallback(async (
    event: ReactMouseEvent<HTMLElement>,
    message: MailListMessage,
  ): Promise<void> => {
    event.stopPropagation();
    const email = account?.email || message.account;
    if (!email) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const folders = await getFolders(email);
    setMoveMenu({ folders, msg: message, x: rect.left, y: rect.bottom + 4 });
  }, [account, getFolders]);

  const handleInlineMoveToFolder = useCallback(async (
    folderName: string,
  ): Promise<void> => {
    if (!moveMenu) return;
    const { msg: message } = moveMenu;
    setMoveMenu(null);
    const email = account?.email || message.account;
    if (!email) return;
    setMessages((current) => filterOutMailThread(current, message));
    try {
      await moveMailMessage(message.id, email, {
        imap_folder: message.imap_folder,
        imap_uid: message.imap_uid,
        target_folder: folderName,
      });
    } catch (error: unknown) {
      toast.error(errorMessage(error)
        || t('mail.move_connection_error', 'Connection error while moving the message'));
      setMessages((current) => [message, ...current]);
      return;
    }
    toast.success(t('mail.moved_to_folder', 'Moved to {{folder}}', {
      folder: folderName,
    }));
    onBatchDone?.();
  }, [account, moveMenu, onBatchDone, setMessages, t]);

  const handleBatchMoveOpen = useCallback(async (
    event: ReactMouseEvent<HTMLElement>,
  ): Promise<void> => {
    const email = account?.email
      || enabledAccounts[0]?.email
      || enabledAccounts[0]?.username;
    if (!email) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const folders = await getFolders(email);
    setBatchMoveMenu({ folders, x: rect.left, y: rect.bottom + 4 });
  }, [account, enabledAccounts, getFolders]);

  const handleBatchMoveToFolder = useCallback(async (
    folderName: string,
  ): Promise<void> => {
    if (!batchMoveMenu || selectedIds.size === 0) return;
    setBatchMoveMenu(null);
    const selected = selectedMessages(messages, selectedIds);
    setMessages((current) => current.filter(
      (message) => !selectedIds.has(mailListMessageIdentity(message)),
    ));
    setSelectedIds(new Set());
    const groups = account?.email
      ? [{ email: account.email, messages: selected }]
      : groupMessageIdsByEmail(selected);
    const results = await Promise.all(groups.map(async (group) => Promise.all(
      group.messages.map(async (message) => {
        const identity = mailListMessageIdentity(message);
        try {
          await moveMailMessage(message.id, group.email, {
            imap_folder: message.imap_folder,
            imap_uid: message.imap_uid,
            target_folder: folderName,
          });
          return { identity, ok: true };
        } catch {
          return { identity, ok: false };
        }
      }),
    )));
    const failedIdentities = new Set(
      results.flat().filter((result) => !result.ok).map((result) => result.identity),
    );
    if (failedIdentities.size > 0) {
      const failed = selected.filter(
        (message) => failedIdentities.has(mailListMessageIdentity(message)),
      );
      setMessages((current) => [...failed, ...current]);
      toast.error(t('mail.move_batch_error', {
        count: failedIdentities.size,
        defaultValue_one: "Couldn't move {{count}} message",
        defaultValue_other: "Couldn't move {{count}} messages",
      }));
    }
    onBatchDone?.();
  }, [account, batchMoveMenu, messages, onBatchDone, selectedIds, setMessages, setSelectedIds, t]);

  const handleInlineAction = useCallback(async (
    event: Pick<ReactMouseEvent<HTMLElement>, 'stopPropagation'>,
    action: MailListAction,
    message: MailListMessage,
  ): Promise<void> => {
    event.stopPropagation();
    const email = account?.email || message.account;
    if (!email) return;
    if (action === 'star') {
      const starred = !message.is_starred;
      setMessages((current) => current.map((candidate) => (
        mailListMessageIdentity(candidate) === mailListMessageIdentity(message)
          ? { ...candidate, is_starred: starred }
          : candidate
      )));
      await starMailMessage(message.id, email, starred).catch(() => undefined);
    } else if (action === 'archive') {
      setMessages((current) => filterOutMailThread(current, message));
      purgeMessageFromCaches(message);
      onRecordAction?.('archive', message.id, email, {
        imap_folder: message.imap_folder,
        imap_uid: message.imap_uid,
      }, message);
      await archiveMailMessage(message.id, email).catch(() => undefined);
    } else if (action === 'trash') {
      setMessages((current) => filterOutMailThread(current, message));
      purgeMessageFromCaches(message);
      onRecordAction?.('trash', message.id, email, {
        imap_folder: message.imap_folder,
        imap_uid: message.imap_uid,
      }, message);
      if (message.source === 'vault') {
        await deleteMailDraft(message.id).catch(() => undefined);
        onBatchDone?.();
      } else {
        await trashMailMessage(message.id, email).catch(() => undefined);
      }
    }
  }, [account, onBatchDone, onRecordAction, purgeMessageFromCaches, setMessages]);

  const handleBatchAction = useCallback(async (
    action: MailListAction,
  ): Promise<void> => {
    if (selectedIds.size === 0) return;
    const selected = selectedMessages(messages, selectedIds);
    if (action === 'trash' || action === 'archive') {
      setMessages((current) => current.filter(
        (message) => !selectedIds.has(mailListMessageIdentity(message)),
      ));
      purgeMessagesFromCaches(selected);
    } else if (action === 'read') {
      setMessages((current) => current.map((message) => (
        selectedIds.has(mailListMessageIdentity(message))
          ? { ...message, is_read: true }
          : message
      )));
    }
    setSelectedIds(new Set());

    if (action === 'trash' || action === 'archive') {
      const vaultMessages = selected.filter((message) => message.source === 'vault');
      const providerMessages = selected.filter((message) => message.source !== 'vault');
      const groups = account?.email
        ? [{ email: account.email, messages: providerMessages }]
        : groupMessageIdsByEmail(providerMessages);
      const results: ActionResult[] = await Promise.all([
        ...vaultMessages.map(async (message): Promise<ActionResult> => {
          const identity = mailListMessageIdentity(message);
          try {
            await deleteMailDraft(message.id);
            return { identities: [identity], ok: true };
          } catch {
            return { identities: [identity], ok: false };
          }
        }),
        ...groups.filter((group) => group.messages.length > 0).map(
          async (group): Promise<ActionResult> => {
            const identities = group.messages.map(mailListMessageIdentity);
            try {
              await batchMailMessages(
                group.email,
                action,
                group.messages.map((message) => message.id),
              );
              return { identities, ok: true };
            } catch {
              return { identities, ok: false };
            }
          },
        ),
      ]);
      const failedIdentities = new Set(
        results.filter((result) => !result.ok)
          .flatMap((result) => result.identities),
      );
      if (failedIdentities.size > 0) {
        const failed = selected.filter(
          (message) => failedIdentities.has(mailListMessageIdentity(message)),
        );
        if (failed.length) setMessages((current) => [...failed, ...current]);
        toast.error(t('mail.batch_action_error', {
          count: failedIdentities.size,
          defaultValue: 'Could not update {{count}} message(s)',
        }));
      }
    } else {
      const groups = account?.email
        ? [{ email: account.email, messages: selected }]
        : groupMessageIdsByEmail(selected);
      await Promise.all(groups.map(async (group) => {
        try {
          await batchMailMessages(
            group.email,
            action,
            group.messages.map((message) => message.id),
          );
        } catch {
          return;
        }
      }));
    }
    onBatchDone?.();
  }, [account, messages, onBatchDone, purgeMessagesFromCaches, selectedIds, setMessages, setSelectedIds, t]);

  const handleBatchActionWithConfirm = useCallback((action: MailListAction): void => {
    if (selectedIds.size === 0) return;
    let message: string | null = null;
    let title = t('mail.confirm_action_title', 'Confirm action');
    const isTrash = folder?.toUpperCase() === 'TRASH';
    if (action === 'trash' && isTrash) {
      title = t('mail.delete_permanently_title', 'Delete permanently');
      message = t('mail.delete_permanently_confirm', {
        count: selectedIds.size,
        defaultValue_one: 'Do you want to permanently delete this message? This action cannot be undone.',
        defaultValue_other: 'Do you want to permanently delete these {{count}} messages? This action cannot be undone.',
      });
    } else if (action === 'trash' && selectedIds.size > 5) {
      title = t('mail.move_to_trash_title', 'Move to trash');
      message = t('mail.move_to_trash_confirm', {
        count: selectedIds.size,
        defaultValue: 'Do you want to move these {{count}} messages to the trash?',
      });
    }
    if (!message) {
      void handleBatchAction(action);
      return;
    }
    setConfirmConfig({
      isOpen: true,
      message,
      onConfirm: () => {
        void handleBatchAction(action);
        setConfirmConfig({ isOpen: false });
      },
      title,
    });
  }, [folder, handleBatchAction, selectedIds.size, t]);

  const handleEmptyFolder = useCallback((): void => {
    const isTrash = folder?.toUpperCase() === 'TRASH';
    setConfirmConfig({
      isOpen: true,
      message: isTrash
        ? (account
          ? t('mail.empty_trash_confirm_account', 'Do you want to permanently empty the entire trash? This action cannot be undone.')
          : t('mail.empty_trash_confirm_all', 'Do you want to empty the trash for ALL accounts?'))
        : (account
          ? t('mail.empty_junk_confirm_account', 'Do you want to move all junk mail to the trash?')
          : t('mail.empty_junk_confirm_all', 'Do you want to move junk mail to the trash for ALL accounts?')),
      onConfirm: async () => {
        if (emails.length === 0) {
          setConfirmConfig({ isOpen: false });
          toast.error(t('mail.no_accounts_configured', 'No accounts configured'));
          return;
        }
        setLoading(true);
        try {
          const results = await Promise.all(emails.map(async (email) => {
            try {
              await emptyMailFolder(email, folder ?? '');
              return { email, error: null, ok: true };
            } catch (error: unknown) {
              return { email, error, ok: false };
            }
          }));
          const failed = results.filter((result) => !result.ok);
          if (failed.length === results.length) {
            throw new Error(errorMessage(failed[0]?.error)
              || t('mail.server_error', 'Server error'));
          }
          if (failed.length > 0) {
            const errors = failed.map((result) => (
              `${result.email}: ${errorMessage(result.error) || t('errors.unknown')}`
            ));
            toast.error(t('mail.empty_partial_error', 'Partially emptied. Errors: {{errors}}', {
              errors: errors.join('; '),
            }), { duration: 6000 });
          } else {
            toast.success(isTrash
              ? t('mail.trash_emptied', 'Trash emptied')
              : t('mail.junk_moved_to_trash', 'Junk mail moved to trash'));
          }
          setLoading(false);
          clearCurrentMemoryCache();
          setMessages([]);
          fetchMessages({ force: true });
          onBatchDone?.();
          setConfirmConfig({ isOpen: false });
        } catch (error: unknown) {
          setLoading(false);
          setConfirmConfig({ isOpen: false });
          toast.error(`${t('mail.error_prefix', 'Error')}: ${errorMessage(error)
            || t('mail.empty_folder_fallback_error', "Couldn't empty it")}`);
        }
      },
      title: isTrash
        ? t('mail.empty_trash_title', 'Empty trash')
        : t('mail.empty_junk_title', 'Empty junk'),
    });
  }, [account, clearCurrentMemoryCache, emails, fetchMessages, folder, onBatchDone, setLoading, setMessages, t]);

  return {
    batchMoveMenu,
    confirmConfig,
    handleBatchAction,
    handleBatchActionWithConfirm,
    handleBatchMoveOpen,
    handleBatchMoveToFolder,
    handleEmptyFolder,
    handleInlineAction,
    handleInlineMoveOpen,
    handleInlineMoveToFolder,
    moveMenu,
    setBatchMoveMenu,
    setConfirmConfig,
    setMoveMenu,
  };
}
