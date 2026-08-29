import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useApi } from '../../hooks/use-api';
import { toast } from '../../lib/toast';
import {
  createVaultInlineComment,
  deleteVaultInlineComment,
  fetchVaultInlineComments,
  updateVaultInlineComment,
  type VaultInlineComment,
} from '../../shared/api/vault-comments';
import { subscribeAppEvent } from '../../shared/platform/app-events';
import {
  browserViewportSize,
  subscribeDocumentEvent,
} from '../../shared/platform/browser-events';
import {
  InlineCommentsView,
  type ComposerPosition,
  type FloatingPosition,
} from './inline-comments/InlineCommentsView';


export interface InlineCommentsProps {
  readonly pageId: string | null;
}


function anchorElement(selection: Selection): Element | null {
  const anchor = selection.anchorNode;
  if (!anchor) return null;
  if (anchor.nodeType === Node.TEXT_NODE) return anchor.parentElement;
  return anchor instanceof Element ? anchor : null;
}


function mutationStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const errorRecord = error as Readonly<Record<string, unknown>>;
  if (typeof errorRecord.status === 'number') return errorRecord.status;
  const response = errorRecord.response;
  if (typeof response !== 'object' || response === null) return undefined;
  const responseRecord = response as Readonly<Record<string, unknown>>;
  return typeof responseRecord.status === 'number'
    ? responseRecord.status
    : undefined;
}


async function loadComments(pageId: string | null): Promise<VaultInlineComment[]> {
  if (!pageId) return [];
  try {
    return await fetchVaultInlineComments(pageId);
  } catch {
    return [];
  }
}


/** Comments anchored to an editor text selection. */
export default function InlineComments({ pageId }: InlineCommentsProps) {
  const { t } = useTranslation();
  const { role } = useApi();
  const canComment = role !== 'viewer';
  const [comments, setComments] = useState<VaultInlineComment[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [buttonPosition, setButtonPosition] = useState<FloatingPosition | null>(
    null,
  );
  const [composer, setComposer] = useState<ComposerPosition | null>(null);
  const [draft, setDraft] = useState('');
  const composeRef = useRef<HTMLTextAreaElement>(null);

  const refreshComments = useCallback(async (): Promise<void> => {
    setComments(await loadComments(pageId));
  }, [pageId]);

  useEffect(() => {
    let active = true;
    void loadComments(pageId).then((nextComments) => {
      if (active) setComments(nextComments);
    });
    return () => {
      active = false;
    };
  }, [pageId]);

  useEffect(() => subscribeAppEvent('gnosi:toggle-comments', () => {
    setPanelOpen((value) => !value);
  }), []);

  useEffect(() => {
    if (!pageId || !canComment) return undefined;
    const handleSelection = () => {
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
          setButtonPosition(null);
          return;
        }
        const element = anchorElement(selection);
        if (!element?.closest('.ProseMirror')) {
          setButtonPosition(null);
          return;
        }
        if (element.closest('[data-gnosi-portal]')) return;
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        setButtonPosition({
          left: rect.left + rect.width / 2 - 60,
          top: rect.top - 38,
        });
      }, 10);
    };
    const unsubscribeMouse = subscribeDocumentEvent('mouseup', handleSelection);
    const unsubscribeKey = subscribeDocumentEvent('keyup', handleSelection);
    return () => {
      unsubscribeMouse();
      unsubscribeKey();
    };
  }, [canComment, pageId]);

  const notifyMutationError = useCallback((
    error: unknown,
    key: string,
    fallback: string,
  ): void => {
    if (mutationStatus(error) === 403) {
      toast.error(t('errors.comment_forbidden', {
        defaultValue: 'Your role does not allow modifying comments',
      }));
      return;
    }
    toast.error(t(key, { defaultValue: fallback }));
  }, [t]);

  const startCompose = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    const selection = window.getSelection();
    const quote = selection?.toString().trim() ?? '';
    if (!selection || !quote) return;
    const element = anchorElement(selection);
    const blockId = element
      ?.closest('.bn-block[data-id]')
      ?.getAttribute('data-id') ?? '';
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setComposer({
      blockId,
      left: Math.min(rect.left, browserViewportSize().width - 320),
      quote,
      top: rect.bottom + 6,
    });
    setButtonPosition(null);
    setDraft('');
    setTimeout(() => {
      composeRef.current?.focus();
    }, 30);
  };

  const submitComment = async (): Promise<void> => {
    if (!pageId || !draft.trim() || !composer) return;
    try {
      await createVaultInlineComment(pageId, {
        block_id: composer.blockId,
        comment: draft.trim(),
        quote: composer.quote,
      });
      setComposer(null);
      setDraft('');
      setPanelOpen(true);
      void refreshComments();
    } catch (error: unknown) {
      notifyMutationError(
        error,
        'errors.comment_add',
        'Error afegint el comentari',
      );
    }
  };

  const resolveComment = async (comment: VaultInlineComment): Promise<void> => {
    if (!pageId) return;
    try {
      await updateVaultInlineComment(pageId, comment.id, {
        resolved: !comment.resolved,
      });
      void refreshComments();
    } catch (error: unknown) {
      notifyMutationError(
        error,
        'errors.comment_resolve',
        'Error actualitzant el comentari',
      );
    }
  };

  const removeComment = async (comment: VaultInlineComment): Promise<void> => {
    if (!pageId) return;
    try {
      await deleteVaultInlineComment(pageId, comment.id);
      void refreshComments();
    } catch (error: unknown) {
      notifyMutationError(
        error,
        'errors.comment_delete',
        'Error eliminant el comentari',
      );
    }
  };

  const goToComment = (comment: VaultInlineComment): void => {
    if (!comment.block_id) return;
    const element = document.querySelector<HTMLElement>(
      `.bn-block[data-id="${comment.block_id}"]`,
    );
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.style.transition = 'background-color .3s';
    element.style.backgroundColor = 'var(--gnosi-primary, #6366f1)22';
    setTimeout(() => {
      element.style.backgroundColor = '';
    }, 1200);
  };

  const handleComposerKeyDown = (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void submitComment();
    }
    if (event.key === 'Escape') setComposer(null);
  };

  if (!pageId) return null;
  return (
    <InlineCommentsView
      buttonPosition={buttonPosition}
      canComment={canComment}
      comments={comments}
      composeRef={composeRef}
      composer={composer}
      draft={draft}
      onCancelCompose={() => {
        setComposer(null);
      }}
      onClosePanel={() => {
        setPanelOpen(false);
      }}
      onComposerKeyDown={handleComposerKeyDown}
      onDraftChange={setDraft}
      onGoTo={goToComment}
      onRemove={(comment) => {
        void removeComment(comment);
      }}
      onResolve={(comment) => {
        void resolveComment(comment);
      }}
      onStartCompose={startCompose}
      onSubmit={() => {
        void submitComment();
      }}
      panelOpen={panelOpen}
    />
  );
}
