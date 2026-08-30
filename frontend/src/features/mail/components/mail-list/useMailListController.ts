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
import { useModalKeyboard } from '../../../../hooks/useModalKeyboard';
import { subscribeWindowEvent } from '../../../../shared/platform/browser-events';
import {
  effectiveMailListConfig,
  groupMailListMessages,
  mailFolderTitleKey,
  processMailListMessages,
  threadMailListMessages,
} from './mailListModel';
import type {
  ContextMenuState,
  InlineTagPickerState,
  MailListProps,
} from './mailListTypes';
import { useMailListActions } from './useMailListActions';
import { useMailListData } from './useMailListData';


export function useMailListController(props: MailListProps) {
  const { t } = useTranslation();
  const accounts = useMemo(() => props.accounts ?? [], [props.accounts]);
  const searchQuery = props.searchQuery ?? '';
  const isComposing = props.isComposing ?? false;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [hoveredMailId, setHoveredMailId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [inlineTagPicker, setInlineTagPicker] = useState<InlineTagPickerState | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [messageTags, setMessageTags] = useState<Record<string, string[]>>({});
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const flatMessagesRef = useRef<ReturnType<typeof threadMailListMessages>>([]);
  const isComposingRef = useRef(isComposing);

  const data = useMailListData({
    account: props.account,
    accounts,
    category: props.category,
    folder: props.folder,
    listRefreshToken: props.listRefreshToken,
    onMessagesLoaded: props.onMessagesLoaded,
    readMailId: props.readMailId,
    removedMailId: props.removedMailId,
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
    flatMessagesRef.current = threadedMessages;
  }, [threadedMessages]);
  useEffect(() => {
    isComposingRef.current = isComposing;
  }, [isComposing]);

  useEffect(() => {
    let active = true;
    if (data.messages.length > 0) {
      void getBatchMessageTags(data.messages.map((message) => message.id))
        .then((value) => {
          if (active) setMessageTags(value);
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
      setFocusedIndex(-1);
      setSelectedIds(new Set());
      setUnreadOnly(false);
    });
    return () => {
      active = false;
    };
  }, [accounts, props.account, props.category, props.folder]);

  useEffect(() => {
    if (!props.selectedMailId) return;
    const index = flatMessagesRef.current.findIndex(
      (message) => message.id === props.selectedMailId,
    );
    if (index >= 0) {
      queueMicrotask(() => {
        setFocusedIndex(index);
      });
    }
  }, [data.messages, props.selectedMailId]);

  useEffect(() => {
    if (focusedIndex < 0) return;
    listRef.current
      ?.querySelector(`[data-mail-index="${String(focusedIndex)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  const toggleSelect = useCallback((
    event: Pick<ReactMouseEvent<HTMLElement>, 'stopPropagation'>,
    id: string,
  ): void => {
    event.stopPropagation();
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((): void => {
    setSelectedIds((current) => (
      current.size === data.messages.length
        ? new Set()
        : new Set(data.messages.map((message) => message.id))
    ));
  }, [data.messages]);

  const {
    handleBatchActionWithConfirm,
    handleInlineAction,
  } = actions;
  const { onSelectMail } = props;
  useEffect(() => subscribeWindowEvent('keydown', (event) => {
    if (isComposingRef.current) return;
    const active = document.activeElement;
    const isInteractive = active instanceof HTMLElement && (
      ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(active.tagName)
      || active.isContentEditable
    );
    const isDeleteKey = event.key === 'Delete' || event.key === 'Backspace';
    if (isInteractive && !(isDeleteKey && selectedIds.size > 0)) return;
    const flat = flatMessagesRef.current;
    const viewer = document.querySelector('[data-role="mail-viewer-scroll"]');
    if (viewer instanceof HTMLElement && event.key === 'ArrowDown') {
      event.preventDefault();
      viewer.scrollBy({ behavior: 'smooth', top: 120 });
      return;
    }
    if (viewer instanceof HTMLElement && event.key === 'ArrowUp') {
      event.preventDefault();
      viewer.scrollBy({ behavior: 'smooth', top: -120 });
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusedIndex((index) => Math.min(index + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === ' ') {
      event.preventDefault();
      const message = flat[focusedIndex];
      if (focusedIndex >= 0 && focusedIndex < flat.length && message) {
        setSelectedIds((current) => {
          const next = new Set(current);
          if (next.has(message.id)) next.delete(message.id);
          else next.add(message.id);
          return next;
        });
      }
    } else if (event.key === 'Enter' && focusedIndex >= 0) {
      const message = flat[focusedIndex];
      if (message) onSelectMail(message);
    } else if (isDeleteKey && selectedIds.size > 0) {
      handleBatchActionWithConfirm('trash');
    } else if (isDeleteKey && focusedIndex >= 0) {
      const message = flat[focusedIndex];
      if (message) {
        void handleInlineAction({ stopPropagation: () => undefined }, 'trash', message);
        setFocusedIndex((index) => Math.min(index, flat.length - 2));
      }
    }
  }), [
    handleBatchActionWithConfirm,
    handleInlineAction,
    focusedIndex,
    onSelectMail,
    selectedIds,
  ]);

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
      focusedIndex,
      folderTitleKey: mailFolderTitleKey(props.folder, props.category),
      groupedMessages,
      hoveredMailId,
      inlineTagPicker,
      isComposing,
      loading: data.loading,
      loadingMore: data.loadingMore,
      messageTags,
      messages: data.messages,
      onSelectMail,
      processedMessages,
      saveMessageTags,
      selectAll,
      selectedIds,
      setContextMenu,
      setFocusedIndex,
      setHoveredMailId,
      setInlineTagPicker,
      setMessageTags,
      setSelectedIds,
      setUnreadOnly,
      syncing: data.syncing,
      tags,
      threadedMessages,
      toggleSelect,
      unreadOnly,
    },
  };
}


export type MailListController = ReturnType<typeof useMailListController>['view'];
