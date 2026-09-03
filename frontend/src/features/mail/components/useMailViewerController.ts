import { addDays, addHours, nextMonday } from 'date-fns';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMailTags } from '../hooks/useMailTags';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { logError } from '../../../shared/notifications/notifyError';
import { toast } from '../../../shared/notifications/toast';
import { createCalendarEvent, fetchCalendarList, type CalendarListItem } from '../../../shared/api/calendar';
import { createContact } from '../../../shared/api/contacts';
import { fetchIdentity } from '../../../shared/api/identity';
import {
  archiveMailMessage,
  deleteMailDraft,
  fetchMailFolders,
  moveMailMessage,
  snoozeMailMessage,
  spamMailMessage,
  starMailMessage,
  trashMailMessage,
  type MailFolders,
} from '../../../shared/api/mail';
import { createVaultPage } from '../../../shared/api/vaults';
import { openBrowserWindow } from '../../../shared/platform/browser-events';
import {
  buildQuotedMailHtml,
  detectMailFormLinks,
  isSentMail,
  isSpamMail,
  mailErrorDetail,
} from './mailViewerModel';
import { useMailViewerData } from './useMailViewerData';
import type {
  MailComposeRequest,
  MailExtractedContact,
  MailExtractedEvent,
  MailViewerMessage,
  MailViewerProps,
} from './mailViewerTypes';


type SnoozeOption = '1h' | 'next_week' | 'tomorrow';


function mailAddressValues(
  value: string | readonly string[] | null | undefined,
): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}


export function useMailViewerController({
  account = null,
  mail: selectedMail = null,
  onActionDone,
  onClose,
  onCompose,
  onMailRead,
  onMoved,
}: MailViewerProps) {
  const { t } = useTranslation();
  const [showSnooze, setShowSnooze] = useState(false);
  const [snoozeMenuPos, setSnoozeMenuPos] = useState({ x: 0, y: 0 });
  const [showMove, setShowMove] = useState(false);
  const [moveMenuPos, setMoveMenuPos] = useState({ x: 0, y: 0 });
  const [moveFolders, setMoveFolders] = useState<MailFolders['folders']>([]);
  const [moving, setMoving] = useState(false);
  const moveButtonRef = useRef<HTMLButtonElement | null>(null);
  const [calendarPickerEvent, setCalendarPickerEvent] = useState<MailExtractedEvent | null>(null);
  const [availableCalendars, setAvailableCalendars] = useState<CalendarListItem[]>([]);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [tagPickerAnchor, setTagPickerAnchor] = useState<DOMRect | null>(null);
  const calendarPickerRef = useRef<HTMLDivElement | null>(null);
  const mailTags = useMailTags();
  const data = useMailViewerData({
    account,
    mailTags,
    onMailRead,
    selectedMail,
    t,
  });
  const {
    activeTagIds,
    analysisStatus,
    allThreadMessages,
    analyzing,
    expandedThreadIds,
    extractedEntities,
    loading,
    mailData,
    scanEntities,
    setActiveTagIds,
    setExtractedEntities,
    setMailData,
    threadMessageData,
    toggleThreadMessage,
  } = data;

  useModalKeyboard({
    containerRef: calendarPickerRef,
    isOpen: calendarPickerEvent !== null,
    onClose: () => { setCalendarPickerEvent(null); },
    trapFocus: true,
  });
  useModalKeyboard({ isOpen: showMove, onClose: () => { setShowMove(false); } });
  useModalKeyboard({ isOpen: showSnooze, onClose: () => { setShowSnooze(false); } });

  const effectiveEmail = account?.email || mailData?.account || '';
  const spam = isSpamMail(mailData);
  const formLinks = useMemo(
    () => detectMailFormLinks(mailData?.body_html, mailData?.body_text),
    [mailData?.body_html, mailData?.body_text],
  );

  const analysisContext = mailData?.body_text
    || mailData?.body_html
    || mailData?.snippet
    || '';
  const analyzeMessage = (): void => {
    const context = analysisContext;
    const recipientValues = [mailData?.recipient, mailData?.cc]
      .flatMap(mailAddressValues);
    const attachmentNames = (mailData?.attachments ?? []).flatMap((attachment) => (
      typeof attachment.filename === 'string' && attachment.filename
        ? [attachment.filename]
        : []
    ));
    if (context) void scanEntities(context, {
      attachments: attachmentNames,
      recipients: recipientValues,
      sender: mailData?.sender || '',
    });
  };

  const addExtractedContact = async (contact: MailExtractedContact): Promise<void> => {
    try {
      await createContact({
        company: contact.company,
        email: contact.email,
        name: contact.name,
        notes: `${contact.notes}\n\n${t('mail.extracted_from_email_label', 'Extracted from the email')}: ${mailData?.subject || ''}`,
        phone: contact.phone,
      });
      toast.success(t('mail.contact_added', 'Contact {{name}} added', { name: contact.name }));
      setExtractedEntities((current) => current ? {
        ...current,
        contacts: current.contacts.filter((item) => item.email !== contact.email),
      } : current);
    } catch (error) {
      logError('mail-viewer.add-contact', error);
      toast.error(t('mail.add_contact_error', 'Error adding the contact'));
    }
  };

  const openCalendarPicker = async (event: MailExtractedEvent): Promise<void> => {
    setCalendarPickerEvent(event);
    if (availableCalendars.length > 0) return;
    try {
      setAvailableCalendars((await fetchCalendarList(account?.email || '')).items);
    } catch (error) {
      logError('mail-viewer.calendars', error);
      toast.error(t('mail.load_calendars_error', 'Error loading calendars'));
    }
  };

  const addExtractedEvent = async (
    event: MailExtractedEvent,
    calendarId: string,
  ): Promise<void> => {
    try {
      await createCalendarEvent({
        calendarId,
        email: account?.email || '',
        event: {
          description: `${event.description}\n\n${t('mail.from_email_label', 'From the email')}: ${mailData?.subject || ''}`,
          end: { dateTime: event.end },
          location: event.location,
          start: { dateTime: event.start },
          title: event.title,
        },
      });
      toast.success(t('mail.event_added_to_calendar', 'Event "{{title}}" added to the calendar', { title: event.title }));
      setCalendarPickerEvent(null);
      setExtractedEntities((current) => current ? {
        ...current,
        events: current.events.filter((item) => item.title !== event.title),
      } : current);
    } catch (error) {
      logError('mail-viewer.add-event', error);
      toast.error(t('mail.add_event_error', 'Error adding the event'));
    }
  };

  const fillForm = async (url: string): Promise<void> => {
    toast.success(t('mail.autofill_starting', 'Starting smart autofill...'));
    try {
      const profile = await fetchIdentity();
      if (window.electronAPI?.openFormFiller) {
        window.electronAPI.openFormFiller(url, profile);
      } else {
        openBrowserWindow(url, '_blank');
        toast.error(t('mail.autofill_desktop_only', 'Autofill is only available in the desktop app'));
      }
    } catch (error) {
      logError('mail-viewer.form-profile', error);
      openBrowserWindow(url, '_blank');
    }
  };

  const addToVault = async (): Promise<void> => {
    if (!mailData) return;
    try {
      const title = mailData.subject || 'Correu sense assumpte';
      const content = `# ${title}\n\n**${t('mail.from_label', 'From')}:** ${mailData.sender || ''}\n**${t('mail.date_label', 'Date')}:** ${mailData.date || ''}\n\n---\n\n${mailData.body_text || ''}`;
      await createVaultPage({
        content,
        metadata: {
          date: mailData.date,
          sender: mailData.sender,
          source: 'mail',
          type: 'Mail',
        },
        title,
      });
      toast.success(t('mail.added_to_vault'));
    } catch (error) {
      logError('mail-viewer.add-to-vault', error);
      toast.error(t('mail.add_to_vault_error'));
    }
  };

  const snooze = async (option: SnoozeOption): Promise<void> => {
    if (!mailData?.id) return;
    setShowSnooze(false);
    const now = new Date();
    const values: Record<SnoozeOption, Date> = {
      '1h': addHours(now, 1),
      next_week: nextMonday(now),
      tomorrow: addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8), 1),
    };
    try {
      await snoozeMailMessage(mailData.id, values[option].toISOString());
      toast.success(t('mail.snooze_ok'));
    } catch (error) {
      logError('mail-viewer.snooze', error);
      toast.error(t('mail.snooze_error', 'Error setting reminder'));
    }
  };

  const compose = (mode: MailComposeRequest['mode']): void => {
    if (!mailData) return;
    const subjectPrefix = mode === 'forward' ? 'Fwd' : 'Re';
    onCompose?.({
      initialCc: mode === 'reply_all' ? mailData.recipient || '' : undefined,
      initialSubject: `${subjectPrefix}: ${mailData.subject || ''}`,
      initialTo: mode === 'forward' ? '' : mailData.sender || '',
      mode,
      quotedHtml: buildQuotedMailHtml(mailData, account?.email || '', t),
      replyToMessageId: mailData.id,
      sourceFolder: mailData.imap_folder || '',
    });
  };

  const toggleStar = (): void => {
    if (!mailData || !effectiveEmail) return;
    const next = !mailData.is_starred;
    setMailData((current) => current ? { ...current, is_starred: next } : current);
    void starMailMessage(mailData.id, effectiveEmail, next)
      .catch((error: unknown) => {
        logError('mail-viewer.star', error);
        toast.error(t('mail.mark_error', 'Error marking'));
      });
    toast.success(next ? t('mail.starred_added') : t('mail.starred_removed'));
  };

  const archive = (): void => {
    if (!mailData || !effectiveEmail) return;
    void archiveMailMessage(mailData.id, effectiveEmail, mailData.imap_folder || undefined)
      .then(() => { onActionDone?.(mailData.id, 'archive', effectiveEmail, { imap_uid: mailData.imap_uid, imap_folder: mailData.imap_folder }); })
      .catch((error: unknown) => {
        logError('mail-viewer.archive', error);
        toast.error(t('mail.archive_error'));
      });
  };

  const remove = (): void => {
    if (!mailData) return;
    if (mailData.source === 'vault' || selectedMail?.source === 'vault') {
      void deleteMailDraft(mailData.id)
        .then(() => { onActionDone?.(mailData.id, 'delete_draft', effectiveEmail); })
        .catch((error: unknown) => {
          logError('mail-viewer.delete-draft', error);
          toast.error(t('mail.delete_error'));
        });
      return;
    }
    if (!effectiveEmail) return;
    void trashMailMessage(mailData.id, effectiveEmail, mailData.imap_folder || undefined)
      .then(() => { onActionDone?.(mailData.id, 'trash', effectiveEmail, { imap_uid: mailData.imap_uid, imap_folder: mailData.imap_folder }); })
      .catch((error: unknown) => {
        logError('mail-viewer.trash', error);
        toast.error(t('mail.delete_error'));
      });
  };

  const toggleSpam = (): void => {
    if (!mailData || !effectiveEmail) return;
    const next = !spam;
    setMailData((current) => current ? {
      ...current,
      category: next ? 'SPAM' : 'Main',
      is_spam: next,
    } : current);
    void spamMailMessage(mailData.id, effectiveEmail, next)
      .then(() => {
        toast.success(next ? t('mail.spam_added') : t('mail.spam_removed'));
        onActionDone?.();
        if (next) onClose?.();
      })
      .catch((error: unknown) => {
        logError('mail-viewer.spam', error);
        toast.error(t('mail.error_updating'));
        setMailData((current) => current ? {
          ...current,
          category: next ? 'Main' : 'SPAM',
          is_spam: !next,
        } : current);
      });
  };

  const openMove = async (): Promise<void> => {
    if (!effectiveEmail) return;
    const rect = moveButtonRef.current?.getBoundingClientRect();
    if (rect) setMoveMenuPos({ x: rect.left, y: rect.bottom + 4 });
    setShowMove((value) => !value);
    if (moveFolders.length > 0) return;
    try {
      setMoveFolders((await fetchMailFolders(effectiveEmail)).folders);
    } catch (error) {
      logError('mail-viewer.folders', error);
      setMoveFolders([]);
    }
  };

  const moveToFolder = async (folderName: string): Promise<void> => {
    if (!mailData || !effectiveEmail || moving) return;
    setMoving(true);
    setShowMove(false);
    try {
      await moveMailMessage(mailData.id, effectiveEmail, {
        imap_folder: mailData.imap_folder,
        imap_uid: mailData.imap_uid,
        target_folder: folderName,
      });
      toast.success(t('mail.moved_to_folder', 'Moved to {{folder}}', { folder: folderName }));
      if (onMoved) onMoved(mailData.id);
      else onClose?.();
    } catch (error) {
      logError('mail-viewer.move', error);
      toast.error(mailErrorDetail(error) || t('mail.move_message_error', 'Error moving the message'));
    } finally {
      setMoving(false);
    }
  };

  const setTags = async (next: string[]): Promise<void> => {
    if (!selectedMail) return;
    setActiveTagIds(next);
    try {
      await mailTags.setMessageTags(selectedMail.id, next, {
        account_email: account?.email || selectedMail.account || '',
        date: selectedMail.date || '',
        sender: selectedMail.sender || '',
        subject: selectedMail.subject || '',
      });
    } catch (error) {
      logError('mail-viewer.set-tags', error);
    }
  };

  const deleteTag = async (id: string): Promise<void> => {
    try {
      await mailTags.deleteTag(id);
      setActiveTagIds((current) => current.filter((tagId) => tagId !== id));
    } catch (error) {
      logError('mail-viewer.delete-tag', error);
    }
  };

  return {
    account,
    activeTagIds,
    addExtractedContact,
    addExtractedEvent,
    addToVault,
    allThreadMessages,
    analyzeMessage,
    analysisStatus,
    analyzing,
    canAnalyze: Boolean(analysisContext),
    archive,
    availableCalendars,
    calendarPickerEvent,
    calendarPickerRef,
    compose,
    deleteTag,
    effectiveEmail,
    expandedThreadIds,
    extractedEntities,
    fillForm,
    formLinks,
    isSentMessage: (message: MailViewerMessage) => isSentMail(message, account?.email || ''),
    loading,
    mailData,
    mailTags,
    moveButtonRef,
    moveFolders,
    moveMenuPos,
    moveToFolder,
    moving,
    onClose,
    openCalendarPicker,
    openMove,
    remove,
    selectedMail,
    setCalendarPickerEvent,
    setShowMove,
    setShowSnooze,
    setShowTagPicker,
    setSnoozeMenuPos,
    setTagPickerAnchor,
    setTags,
    showMove,
    showSnooze,
    showTagPicker,
    snooze,
    snoozeMenuPos,
    spam,
    t,
    tagPickerAnchor,
    threadMessageData,
    toggleSpam,
    toggleStar,
    toggleThreadMessage,
  };
}


export type MailViewerController = ReturnType<typeof useMailViewerController>;
