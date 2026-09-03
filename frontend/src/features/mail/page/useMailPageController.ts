import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../shared/notifications/notifyError';
import { toast } from '../../../shared/notifications/toast';
import { useMediaQuery } from '../../../shared/hooks/useMediaQuery';
import {
  fetchIntegrations,
  type IntegrationsDocument,
} from '../../../shared/api/integrations';
import {
  fetchMailCounts,
  moveMailMessage,
  type MailCounts,
  type MailView,
} from '../../../shared/api/mail';
import { queryClient } from '../../../shared/api/query-client';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { MailUndoToast } from './MailUndoToast';
import {
  isSameMailMessage,
  mailMessageIdentity,
  type MailIdentityMessage,
} from '../mailIdentity';
import {
  adjacentMail,
  buildMailAccountCatalog,
  draftComposeData,
  isVaultDraft,
  mailAccountAddress,
  mergeMailCounts,
  type MailAccount,
  type MailComposeData,
  type MailPageMessage,
  type MailUndoAction,
  type MailUndoExtra,
} from './mailPageModel';


const INTEGRATIONS_QUERY_KEY = ['integrations'] as const;


function fetchCachedIntegrations() {
  return queryClient.query({
    queryFn: ({ signal }: { readonly signal: AbortSignal }) => fetchIntegrations(signal),
    queryKey: INTEGRATIONS_QUERY_KEY,
    retry: false,
    staleTime: 500,
  });
}


interface MailboxSidebarState {
  readonly compact: boolean;
  readonly open: boolean;
}


type BooleanAction = boolean | ((current: boolean) => boolean);


export interface MailPageController {
  readonly accounts: readonly MailAccount[];
  readonly accountsLoading: boolean;
  readonly activeCategory: string | null;
  readonly activeFolder: string | null;
  readonly activeTagId: string | null;
  readonly activeView: MailView | null;
  readonly composeData: MailComposeData | null;
  readonly closeComposer: () => void;
  readonly counts: MailCounts;
  readonly handleActionDone: (
    mailId?: string,
    actionType?: string,
    email?: string,
    extra?: MailUndoExtra,
    mail?: MailPageMessage,
  ) => void;
  readonly handleCompose: () => void;
  readonly handleMailMoved: (mail: MailIdentityMessage) => void;
  readonly handleMailRead: (mail: MailIdentityMessage) => void;
  readonly handleMailSelected: (mail: MailPageMessage | null) => void;
  readonly handleOpenComposer: (data?: MailComposeData | null) => void;
  readonly handleRecordAction: (
    type: string,
    mailId: string,
    email: string,
    extra?: MailUndoExtra,
    mail?: MailPageMessage,
  ) => void;
  readonly handleSelectCategory: (category: string) => void;
  readonly handleSelectFolder: (folder: string) => void;
  readonly handleSelectTag: (tagId: string | null) => void;
  readonly handleSelectView: (view: MailView | null) => void;
  readonly identities: readonly MailAccount[];
  readonly isCompact: boolean;
  readonly isComposing: boolean;
  readonly listRefreshToken: number;
  readonly messages: readonly MailPageMessage[];
  readonly readMail: MailIdentityMessage | null;
  readonly refreshCounts: () => void;
  readonly removedMail: MailIdentityMessage | null;
  readonly searchQuery: string;
  readonly selectedAccount: MailAccount | null;
  readonly selectedMail: MailPageMessage | null;
  readonly setIsComposing: (isComposing: boolean) => void;
  readonly setListRefreshToken: (update: (current: number) => number) => void;
  readonly setMessages: (messages: readonly MailPageMessage[]) => void;
  readonly setSearchQuery: (query: string) => void;
  readonly setSelectedAccount: (account: MailAccount | null) => void;
  readonly setSelectedMail: (mail: MailPageMessage | null) => void;
  readonly setShowMailboxSidebar: (action: BooleanAction) => void;
  readonly showMailboxSidebar: boolean;
}


function initialMailboxSidebar(): boolean {
  return typeof window === 'undefined'
    || !window.matchMedia('(max-width: 767px)').matches;
}


export function useMailPageController(): MailPageController {
  const { t } = useTranslation();
  const isCompact = useMediaQuery('(max-width: 767px)');
  const [selectedMail, setSelectedMail] = useState<MailPageMessage | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<MailAccount | null>(null);
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState<string | null>('INBOX');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<MailView | null>(null);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [composeData, setComposeData] = useState<MailComposeData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [messages, setMessagesState] = useState<readonly MailPageMessage[]>([]);
  const [counts, setCounts] = useState<MailCounts>({});
  const [sidebarState, setSidebarState] = useState<MailboxSidebarState>(() => ({
    compact: isCompact,
    open: initialMailboxSidebar(),
  }));
  const [removedMail, setRemovedMail] = useState<MailIdentityMessage | null>(null);
  const [readMail, setReadMail] = useState<MailIdentityMessage | null>(null);
  const [listRefreshToken, setListRefreshToken] = useState(0);
  const [identities, setIdentities] = useState<MailAccount[]>([]);
  const [defaultAccount, setDefaultAccount] = useState<MailAccount | null>(null);
  const [loadAccountsError] = useState(() => t(
    'mail.load_accounts_error',
    'Could not load mail accounts',
  ));
  const undoRef = useRef<MailUndoAction | null>(null);

  const showMailboxSidebar = sidebarState.compact === isCompact
    ? sidebarState.open
    : !isCompact;
  const setShowMailboxSidebar = useCallback((action: BooleanAction) => {
    setSidebarState((currentState) => {
      const current = currentState.compact === isCompact
        ? currentState.open
        : !isCompact;
      return {
        compact: isCompact,
        open: typeof action === 'function' ? action(current) : action,
      };
    });
  }, [isCompact]);

  useEffect(() => {
    let active = true;
    void fetchCachedIntegrations()
      .then((document: IntegrationsDocument) => {
        if (!active) return;
        const catalog = buildMailAccountCatalog(document);
        setAccounts(catalog.accounts);
        setIdentities(catalog.identities);
        setSelectedAccount(catalog.selectedAccount);
        setDefaultAccount(catalog.defaultAccount);
      })
      .catch((error: unknown) => {
        if (!active) return;
        logError('mail.load-accounts', error);
        toast.error(loadAccountsError);
      })
      .finally(() => {
        if (active) setAccountsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadAccountsError]);

  const fetchCounts = useCallback(async (currentAccounts: readonly MailAccount[]) => {
    const emailList = selectedAccount?.email
      ? [selectedAccount.email]
      : currentAccounts
        .map(mailAccountAddress)
        .filter((email) => email.length > 0);
    if (emailList.length === 0) return;
    const results = await Promise.all(emailList.map((email) => (
      fetchMailCounts(email).catch((): MailCounts => ({}))
    )));
    setCounts(mergeMailCounts(results));
  }, [selectedAccount]);

  useEffect(() => {
    if (accounts.length === 0) return;
    void Promise.resolve().then(() => fetchCounts(accounts));
  }, [accounts, fetchCounts]);

  const executeUndo = useCallback(async () => {
    const action = undoRef.current;
    if (!action) return;
    undoRef.current = null;
    toast.dismiss('undo-toast');
    try {
      await moveMailMessage(action.mailId, action.email, {
        imap_folder: action.imap_folder,
        imap_uid: action.imap_uid,
        target_folder: 'INBOX',
      });
      setRemovedMail(null);
      setListRefreshToken((current) => current + 1);
      void fetchCounts(accounts);
      toast.success(t('mail.undo_success', 'Action undone'));
    } catch {
      toast.error(t('mail.undo_error', 'Could not undo'));
    }
  }, [accounts, fetchCounts, t]);

  const recordUndo = useCallback((
    type: string,
    mailId: string,
    email: string,
    extra: MailUndoExtra = {},
    mail?: MailPageMessage,
  ) => {
    const identity = mailMessageIdentity(mail ?? {
      account: email,
      id: mailId,
      imap_folder: extra.imap_folder,
      imap_uid: extra.imap_uid,
    });
    undoRef.current = { email, identity, mailId, type, ...extra };
    setTimeout(() => {
      if (undoRef.current?.identity === identity) undoRef.current = null;
    }, 8000);
    const label = type === 'trash'
      ? t('mail.undo_label_trashed', 'Deleted')
      : t('mail.undo_label_archived', 'Archived');
    toast(createElement(MailUndoToast, {
      label,
      onUndo: () => {
        void executeUndo();
      },
      undoLabel: t('common.undo', 'Undo'),
    }), { duration: 8000, id: 'undo-toast' });
  }, [executeUndo, t]);

  useEffect(() => subscribeWindowEvent('keydown', (event) => {
    if (
      (event.metaKey || event.ctrlKey)
      && (event.key === 'z' || event.key === 'Z')
      && !event.shiftKey
    ) {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement
        && (
          ['INPUT', 'TEXTAREA'].includes(activeElement.tagName)
          || activeElement.isContentEditable
        )
      ) return;
      event.preventDefault();
      void executeUndo();
    }
  }), [executeUndo]);

  useEffect(() => subscribeWindowEvent('keydown', (event) => {
    if (event.key === 'Escape' && !isComposing && selectedMail) {
      setSelectedMail(null);
    }
  }), [isComposing, selectedMail]);

  const handleMailRead = useCallback((mail: MailIdentityMessage) => {
    setReadMail(mail);
    void fetchCounts(accounts);
  }, [accounts, fetchCounts]);
  const refreshCounts = useCallback(() => {
    void fetchCounts(accounts);
  }, [accounts, fetchCounts]);
  const handleMailMoved = useCallback((mail: MailIdentityMessage) => {
    setRemovedMail(mail);
    setSelectedMail(null);
    void fetchCounts(accounts);
  }, [accounts, fetchCounts]);
  const handleActionDone = useCallback((
    mailId?: string,
    actionType?: string,
    email?: string,
    extra: MailUndoExtra = {},
    mail?: MailPageMessage,
  ) => {
    void fetchCounts(accounts);
    if (mail) {
      setSelectedMail(adjacentMail(messages, mail));
      setRemovedMail(mail);
    }
    if (
      mailId
      && email
      && (actionType === 'trash' || actionType === 'archive')
    ) recordUndo(actionType, mailId, email, extra, mail);
  }, [accounts, fetchCounts, messages, recordUndo]);

  const closeSidebarOnCompact = useCallback(() => {
    if (isCompact) setShowMailboxSidebar(false);
  }, [isCompact, setShowMailboxSidebar]);
  const handleSelectFolder = useCallback((folder: string) => {
    setActiveFolder(folder);
    setActiveCategory(null);
    setActiveView(null);
    setActiveTagId(null);
    setSelectedMail(null);
    closeSidebarOnCompact();
  }, [closeSidebarOnCompact]);
  const handleSelectTag = useCallback((tagId: string | null) => {
    setActiveTagId(tagId);
    setSelectedMail(null);
    closeSidebarOnCompact();
  }, [closeSidebarOnCompact]);
  const handleSelectCategory = useCallback((category: string) => {
    setActiveCategory(category);
    setActiveFolder(null);
    setActiveView(null);
    setSelectedMail(null);
    setIsComposing(false);
    closeSidebarOnCompact();
  }, [closeSidebarOnCompact]);
  const handleSelectView = useCallback((view: MailView | null) => {
    setActiveView(view);
    setActiveFolder(view ? null : 'INBOX');
    if (view) setActiveCategory(null);
    setSelectedMail(null);
    setIsComposing(false);
    closeSidebarOnCompact();
  }, [closeSidebarOnCompact]);
  const handleCompose = useCallback(() => {
    setSelectedMail(null);
    const effectiveAccount = selectedAccount ?? defaultAccount;
    const prefix = effectiveAccount?.subject_prefix || '';
    setComposeData(prefix ? { initialSubject: prefix } : null);
    setIsComposing(true);
    closeSidebarOnCompact();
  }, [closeSidebarOnCompact, defaultAccount, selectedAccount]);
  const handleOpenComposer = useCallback((data?: MailComposeData | null) => {
    setComposeData(data || null);
    setIsComposing(true);
    closeSidebarOnCompact();
  }, [closeSidebarOnCompact]);
  const closeComposer = useCallback(() => {
    setIsComposing(false);
    setComposeData(null);
  }, []);
  const handleMailSelected = useCallback((mail: MailPageMessage | null) => {
    if (mail && isVaultDraft(mail)) {
      setComposeData(draftComposeData(mail));
      setSelectedMail(null);
      setIsComposing(true);
      return;
    }
    setIsComposing(false);
    setSelectedMail(mail);
  }, []);
  const handleRecordAction = useCallback((
    type: string,
    mailId: string,
    email: string,
    extra: MailUndoExtra = {},
    mail?: MailPageMessage,
  ) => {
    recordUndo(type, mailId, email, extra, mail);
    if (
      (type === 'trash' || type === 'archive')
      && mail
      && isSameMailMessage(mail, selectedMail)
    ) {
      setSelectedMail(adjacentMail(messages, mail));
    }
  }, [messages, recordUndo, selectedMail]);

  return {
    accounts,
    accountsLoading,
    activeCategory,
    activeFolder,
    activeTagId,
    activeView,
    composeData,
    closeComposer,
    counts,
    handleActionDone,
    handleCompose,
    handleMailMoved,
    handleMailRead,
    handleMailSelected,
    handleOpenComposer,
    handleRecordAction,
    handleSelectCategory,
    handleSelectFolder,
    handleSelectTag,
    handleSelectView,
    identities,
    isCompact,
    isComposing,
    listRefreshToken,
    messages,
    readMail,
    refreshCounts,
    removedMail,
    searchQuery,
    selectedAccount,
    selectedMail,
    setIsComposing,
    setListRefreshToken,
    setMessages: setMessagesState,
    setSearchQuery,
    setSelectedAccount,
    setSelectedMail,
    setShowMailboxSidebar,
    showMailboxSidebar,
  };
}
