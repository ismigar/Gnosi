import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useMailTags } from '../../hooks/useMailTags';
import { useModalKeyboard } from '../../../../shared/hooks/useModalKeyboard';
import {
  effectiveMailListConfig,
  groupMailListMessages,
  mailFolderTitleKey,
  mailListMessageIdentity,
  mapMailTagsByIdentity,
  processMailListMessages,
  threadMailListMessages,
} from './mailListModel';
import type {
  ContextMenuState,
  InlineTagPickerState,
  MailListMessage,
  MailListProps,
} from './mailListTypes';
import { useMailListActions } from './useMailListActions';
import { useMailListData } from './useMailListData';
import { useMailListNavigation } from './useMailListNavigation';


export function useMailListController(props: MailListProps) {
  const { t } = useTranslation();
  const accounts = useMemo(() => props.accounts ?? [], [props.accounts]);
  const searchQuery = props.searchQuery ?? '';
  const isComposing = props.isComposing ?? false;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [inlineTagPicker, setInlineTagPicker] = useState<InlineTagPickerState | null>(null);
  const [messageTags, setMessageTags] = useState<Record<string, string[]>>({});
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const data = useMailListData({
    account: props.account,
    accountsLoading: props.accountsLoading ?? false,
    accounts,
    category: props.category,
    folder: props.folder,
    listRefreshToken: props.listRefreshToken,
    onMessagesLoaded: props.onMessagesLoaded,
    readMail: props.readMail,
    removedMail: props.removedMail,
  });
  const {
    createTag,
    deleteTag,
    getBatchMessageTags,
    setMessageTags: saveMessageTags,
    tags,
  } = useMailTags();
  const actions = useMailListActions({
    account: props.account,
    clearCurrentMemoryCache: data.clearCurrentMemoryCache,
    emails: data.emails,
    enabledAccounts: data.enabledAccounts,
    fetchMessages: data.fetchMessages,
    folder: props.folder,
    messages: data.messages,
    onBatchDone: props.onBatchDone,
    onRecordAction: props.onRecordAction,
    purgeMessageFromCaches: data.purgeMessageFromCaches,
    purgeMessagesFromCaches: data.purgeMessagesFromCaches,
    selectedIds,
    setLoading: data.setLoading,
    setMessages: data.setMessages,
    setSelectedIds,
    t,
  });

  const effectiveConfig = useMemo(
    () => effectiveMailListConfig(props.activeView),
    [props.activeView],
  );
  const processedMessages = useMemo(() => processMailListMessages(data.messages, {
    activeTagId: props.activeTagId,
    activeView: props.activeView,
    config: effectiveConfig,
    folder: props.folder,
    messageTags,
    searchQuery,
    unreadOnly,
  }), [
    data.messages,
    effectiveConfig,
    messageTags,
    props.activeTagId,
    props.activeView,
    props.folder,
    searchQuery,
    unreadOnly,
  ]);
  const threadedMessages = useMemo(
    () => threadMailListMessages(processedMessages),
    [processedMessages],
  );
  const groupedMessages = useMemo(
    () => groupMailListMessages(
      threadedMessages,
      effectiveConfig.groupBy,
      (key, fallback) => fallback === undefined ? t(key) : t(key, fallback),
    ),
    [effectiveConfig.groupBy, t, threadedMessages],
  );

  useEffect(() => {
    let active = true;
    if (data.messages.length > 0) {
      void getBatchMessageTags(data.messages)
        .then((value) => {
          if (active) setMessageTags(mapMailTagsByIdentity(data.messages, value));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [data.messages, getBatchMessageTags]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSelectedIds(new Set());
      setUnreadOnly(false);
    });
    return () => {
      active = false;
    };
  }, [accounts, props.account, props.category, props.folder]);

  const toggleSelect = useCallback((
    event: Pick<ReactMouseEvent<HTMLElement>, 'stopPropagation'>,
    message: MailListMessage,
  ): void => {
    event.stopPropagation();
    const identity = mailListMessageIdentity(message);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(identity)) next.delete(identity);
      else next.add(identity);
      return next;
    });
  }, []);

  const selectAll = useCallback((): void => {
    setSelectedIds((current) => (
      current.size === data.messages.length
        ? new Set()
        : new Set(data.messages.map(mailListMessageIdentity))
    ));
  }, [data.messages]);

  const navigationMessages = useMemo(() => Object.values(groupedMessages).flat(), [groupedMessages]);
  const navigation = useMailListNavigation({
    blocked: isComposing || contextMenu !== null || inlineTagPicker !== null
      || actions.moveMenu !== null || actions.batchMoveMenu !== null || actions.confirmConfig.isOpen,
    listRef,
    messages: navigationMessages,
    onSelectMail: props.onSelectMail,
    onTrashMessage: message => {
      void actions.handleInlineAction({ stopPropagation: () => undefined }, 'trash', message);
    },
    onTrashSelected: () => { actions.handleBatchActionWithConfirm('trash'); },
    scope: JSON.stringify([
      accounts.map(account => account.email), props.account?.email, props.category,
      props.folder, props.activeTagId, props.activeView, searchQuery, unreadOnly,
    ]),
    selectedIds,
    selectedMailIdentity: props.selectedMailIdentity,
    setSelectedIds,
  });

  const hasMoreRef = useRef(data.hasMore);
  const loadingMoreRef = useRef(data.loadingMore);
  const loadMoreRef = useRef(data.loadMore);
  useEffect(() => {
    hasMoreRef.current = data.hasMore;
    loadingMoreRef.current = data.loadingMore;
    loadMoreRef.current = data.loadMore;
  }, [data.hasMore, data.loadMore, data.loadingMore]);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && hasMoreRef.current && !loadingMoreRef.current) {
        loadMoreRef.current();
      }
    }, { threshold: 0.1 });
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, []);

  const setListElement = useCallback((element: HTMLDivElement | null): void => {
    listRef.current = element;
  }, []);
  const setSentinelElement = useCallback((element: HTMLDivElement | null): void => {
    sentinelRef.current = element;
  }, []);

  useModalKeyboard({
    isOpen: actions.moveMenu !== null,
    onClose: () => {
      actions.setMoveMenu(null);
    },
  });
  useModalKeyboard({
    isOpen: actions.batchMoveMenu !== null,
    onClose: () => {
      actions.setBatchMoveMenu(null);
    },
  });
  useModalKeyboard({
    isOpen: contextMenu !== null,
    onClose: () => {
      setContextMenu(null);
    },
  });

  return {
    setListElement,
    setSentinelElement,
    view: {
      ...actions,
      contextMenu,
      createTag,
      deleteTag,
      effectiveConfig,
      fetchMessages: data.fetchMessages,
      focusedIndex: navigation.focusedIndex,
      folderTitleKey: mailFolderTitleKey(props.folder, props.category),
      groupedMessages,
      inlineTagPicker,
      isComposing,
      loading: data.loading,
      loadingMore: data.loadingMore,
      messageTags,
      messages: data.messages,
      onSelectMail: navigation.selectMail,
      processedMessages,
      retryUnavailable: data.retryUnavailable,
      saveMessageTags,
      selectAll,
      selectedIds,
      setContextMenu,
      setInlineTagPicker,
      setMessageTags,
      setSelectedIds,
      setUnreadOnly,
      syncing: data.syncing,
      tags,
      threadedMessages: navigationMessages,
      toggleSelect,
      unavailableAccountCount: data.unavailableAccountCount,
      unreadOnly,
    },
  };
}


export type MailListController = ReturnType<typeof useMailListController>['view'];
