import type { BlockNoteEditor } from '@blocknote/core';
import type FullCalendar from '@fullcalendar/react';
import { format } from 'date-fns';
import { ca } from 'date-fns/locale';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { logError } from '../../lib/notifyError';
import { toast } from '../../lib/toast';
import { fetchIntegrations } from '../../shared/api/integrations';
import {
  deleteMailDraft,
  generateMailDraft,
  saveMailDraft,
} from '../../shared/api/mail';
import {
  replyMailMultipart,
  sendMailMultipart,
} from '../../shared/api/mail-specialized';
import { queryClient } from '../../shared/api/query-client';
import { fetchVaultPages, fetchVaultTables } from '../../shared/api/vaults';
import { subscribeWindowEvent } from '../../shared/platform/browser-events';
import {
  appendUniqueFiles,
  buildMailFormData,
  composerInitialHtml,
  hasComposerContent,
  mailSnippets,
} from './mailComposerModel';
import type {
  MailAvailabilitySelection,
  MailComposerCalendarData,
  MailComposerProps,
} from './mailComposerTypes';


const INTEGRATIONS_QUERY_KEY = ['integrations'] as const;


function fetchCachedIntegrations() {
  return queryClient.query({
    queryFn: ({ signal }: { readonly signal: AbortSignal }) => fetchIntegrations(signal),
    queryKey: INTEGRATIONS_QUERY_KEY,
    retry: false,
    staleTime: 500,
  });
}


function pageSource(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const source = (metadata as Readonly<Record<string, unknown>>).source;
  return typeof source === 'string' && source ? source : null;
}


export function useMailComposerController({
  _draftId = null,
  account = null,
  accounts = [],
  initialBody = '',
  initialCc = '',
  initialSubject = '',
  initialTo = '',
  mode = null,
  onClose,
  onDraftSaved,
  onSent,
  quotedHtml = '',
  replyToMessageId = null,
  sourceFolder = '',
}: MailComposerProps) {
  const { t } = useTranslation();
  const [fromAccount, setFromAccount] = useState(
    () => account || accounts[0] || null,
  );
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState(initialCc);
  const [bcc, setBcc] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(Boolean(initialCc));
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [calendarData, setCalendarData] = useState<MailComposerCalendarData>({
    integrations: {},
    pages: [],
    tables: [],
  });
  const [, setCalendarTitle] = useState('');
  const editorRef = useRef<BlockNoteEditor | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const calendarRef = useRef<FullCalendar | null>(null);
  const draftIdRef = useRef(_draftId);
  const bodyRef = useRef(body);
  const subjectRef = useRef(subject);
  const toRef = useRef(to);
  const ccRef = useRef(cc);
  const bccRef = useRef(bcc);

  useEffect(() => { bodyRef.current = body; }, [body]);
  useEffect(() => { subjectRef.current = subject; }, [subject]);
  useEffect(() => { toRef.current = to; }, [to]);
  useEffect(() => { ccRef.current = cc; }, [cc]);
  useEffect(() => { bccRef.current = bcc; }, [bcc]);

  const signatureHtml = fromAccount?.signature || '';
  const isReplyOrForward = mode === 'reply'
    || mode === 'reply_all'
    || mode === 'forward';
  const editorInitialHtml = useMemo(
    () => composerInitialHtml(initialBody, quotedHtml, signatureHtml),
    [initialBody, quotedHtml, signatureHtml],
  );
  const snippets = useMemo(() => mailSnippets(t), [t]);
  const selectedCalendarSources = useMemo(() => new Set(
    calendarData.pages
      .map((page) => pageSource(page.metadata))
      .filter((source): source is string => source !== null),
  ), [calendarData.pages]);

  const saveDraft = useCallback(async (): Promise<void> => {
    if (!fromAccount?.email) return;
    if (!hasComposerContent(bodyRef.current, subjectRef.current, toRef.current)) {
      return;
    }
    try {
      const result = await saveMailDraft({
        account: fromAccount.email,
        bcc: bccRef.current,
        body: bodyRef.current,
        cc: ccRef.current,
        draft_id: draftIdRef.current || undefined,
        subject: subjectRef.current,
        to: toRef.current,
      });
      const isFirstSave = !draftIdRef.current;
      if (result.draft_id) draftIdRef.current = result.draft_id;
      if (isFirstSave) {
        toast(t('mail.draft_saved'), { duration: 1500, icon: '💾' });
        onDraftSaved?.();
      }
    } catch (error) {
      logError('mail-composer.draft-auto-save', error);
    }
  }, [fromAccount, onDraftSaved, t]);

  const handleCloseRequest = useCallback((): void => {
    if (hasComposerContent(bodyRef.current, subjectRef.current, toRef.current)) {
      setShowCloseConfirm(true);
      return;
    }
    onClose();
  }, [onClose]);

  const handleSaveAndClose = useCallback(async (): Promise<void> => {
    await saveDraft();
    setShowCloseConfirm(false);
    onClose();
  }, [onClose, saveDraft]);

  useEffect(() => {
    if (!fromAccount?.email) return undefined;
    const timer = window.setInterval(() => { void saveDraft(); }, 2000);
    return () => { window.clearInterval(timer); };
  }, [fromAccount, saveDraft]);

  useModalKeyboard({
    isOpen: showSnippets,
    onClose: () => { setShowSnippets(false); },
  });

  useEffect(() => subscribeWindowEvent('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (showAvailability) {
      setShowAvailability(false);
    } else if (showCloseConfirm) {
      setShowCloseConfirm(false);
    } else {
      handleCloseRequest();
    }
  }), [handleCloseRequest, showAvailability, showCloseConfirm]);

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>): void => {
    const incoming = Array.from(event.target.files || []);
    setAttachments((current) => appendUniqueFiles(current, incoming));
    event.target.value = '';
  };

  const attachFile = (file: File): void => {
    setAttachments((current) => appendUniqueFiles(current, [file]));
  };

  const removeAttachment = (file: File): void => {
    setAttachments((current) => current.filter((candidate) => candidate !== file));
  };

  const handleSend = async (): Promise<void> => {
    if (!to.trim() || !body.trim() || !fromAccount?.email) {
      toast.error(t('mail.compose_missing_fields'));
      return;
    }
    setSending(true);
    try {
      const formData = buildMailFormData({
        attachments,
        bcc,
        body,
        cc,
        fromAccount,
        isReplyOrForward,
        signatureHtml,
        subject,
        to,
      });
      const smtpEmail = fromAccount.smtp_email || fromAccount.email;
      const result = mode && replyToMessageId
        ? await replyMailMultipart(
          replyToMessageId,
          smtpEmail,
          sourceFolder,
          formData,
        )
        : await sendMailMultipart(smtpEmail, formData);
      if (result.status !== 'success' && !('message_id' in result)) {
        toast.error(t('mail.send_error'));
        return;
      }
      if (draftIdRef.current) {
        void deleteMailDraft(draftIdRef.current).catch((error: unknown) => {
          logError('mail-composer.delete-sent-draft', error);
        });
        onDraftSaved?.();
      }
      toast.success(t('mail.sent_ok'));
      const editor = editorRef.current;
      if (editor) {
        editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: [] }]);
      }
      onSent?.();
      onClose();
    } catch (error) {
      logError('mail-composer.send', error);
      toast.error(t('mail.send_error'));
    } finally {
      setSending(false);
    }
  };

  const fetchCalendarResources = useCallback(async (): Promise<void> => {
    try {
      const [pages, integrations, tables] = await Promise.all([
        fetchVaultPages(),
        fetchCachedIntegrations(),
        fetchVaultTables(),
      ]);
      setCalendarData({ integrations, pages, tables });
    } catch (error) {
      logError('mail-composer.calendar-resources', error);
      toast.error(t('mail.calendar_load_error', 'Error loading the calendar'));
    }
  }, [t]);

  const handleInsertAvailability = (): void => {
    setShowAvailability(true);
    if (calendarData.pages.length === 0) void fetchCalendarResources();
  };

  const insertEditorParagraph = (text: string): void => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.insertBlocks(
      [{ type: 'paragraph', content: text }],
      editor.getTextCursorPosition().block,
      'after',
    );
  };

  const handleSlotSelection = (selection: MailAvailabilitySelection): void => {
    const start = format(
      selection.start,
      selection.allDay ? 'd MMMM' : 'd MMMM HH:mm',
      { locale: ca },
    );
    const end = selection.end
      ? format(selection.end, selection.allDay ? 'd MMMM' : 'HH:mm', { locale: ca })
      : '';
    insertEditorParagraph(selection.allDay
      ? t('mail.availability_day', { date: start })
      : t('mail.availability_range', { end, start }));
    setShowAvailability(false);
    toast.success(t('mail.availability_inserted'));
  };

  const handleInsertSnippet = (text: string): void => {
    insertEditorParagraph(text);
    setShowSnippets(false);
  };

  const handleAIAssist = async (): Promise<void> => {
    if (!subject && !body) {
      toast.error(t('mail.ai_needs_context'));
      return;
    }
    setAiGenerating(true);
    try {
      const result = await generateMailDraft(
        body,
        `Create a professional draft about: ${subject}`,
      );
      setBody(result.draft);
      toast.success(t('mail.ai_draft_ok'));
    } catch (error) {
      logError('mail-composer.ai-draft', error);
      toast.error(t('mail.ai_draft_error'));
    } finally {
      setAiGenerating(false);
    }
  };

  const handleRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleSend();
    } else if (event.shiftKey && event.key === 'Enter') {
      event.stopPropagation();
    }
  };

  return {
    account,
    accounts,
    aiGenerating,
    attachFile,
    attachments,
    bcc,
    calendarData,
    cc,
    editorInitialHtml,
    fromAccount,
    handleAIAssist,
    handleCloseRequest,
    handleFileSelect,
    handleInsertAvailability,
    handleInsertSnippet,
    handleRootKeyDown,
    handleSaveAndClose,
    handleSend,
    handleSlotSelection,
    isReplyOrForward,
    mode,
    onClose,
    quotedHtml,
    calendarRef,
    editorRef,
    fileInputRef,
    removeAttachment,
    selectedCalendarSources,
    sending,
    setBcc,
    setBody,
    setCalendarTitle,
    setCc,
    setFromAccount,
    setShowAvailability,
    setShowCcBcc,
    setShowCloseConfirm,
    setShowSnippets,
    setSubject,
    setTo,
    showAvailability,
    showCcBcc,
    showCloseConfirm,
    showSnippets,
    signatureHtml,
    snippets,
    subject,
    t,
    to,
  };
}


export type MailComposerController = ReturnType<typeof useMailComposerController>;
