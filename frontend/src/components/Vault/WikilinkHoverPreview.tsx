import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';

import {
  fetchVaultPagePreview,
  type VaultPagePreview,
} from '../../shared/api/vaults';
import { IconRenderer } from './IconRenderer';
import { VaultMarkdown } from './VaultMarkdown';
import {
  adaptiveHoverPreviewStyle,
  isHoverPreviewScrollable,
  positionHoverPreview,
  scrollHoverPreviewByKey,
} from './hoverPreviewLayout';
import {
  readWikilinkPreviewCache,
  writeWikilinkPreviewCache,
} from './wikilinkPreviewCache';


const PREVIEW_STYLE = adaptiveHoverPreviewStyle({
  maxHeight: 420,
  maxWidth: 440,
  minWidth: 260,
});


export interface WikilinkHoverAnchorRect {
  readonly bottom: number;
  readonly left: number;
  readonly top: number;
}


export interface WikilinkHoverPreviewProps {
  readonly anchorRect?: WikilinkHoverAnchorRect | null;
  readonly onMouseEnter?: () => void;
  readonly onMouseLeave?: () => void;
  readonly pageId: string;
}


interface PreviewState {
  readonly data: VaultPagePreview | null;
  readonly error: boolean;
  readonly loading: boolean;
  readonly pageId: string;
}


interface LegacyPagePreview extends VaultPagePreview {
  readonly content?: unknown;
}


function initialPreviewState(pageId: string): PreviewState {
  const data = readWikilinkPreviewCache(pageId);
  return { data, error: false, loading: !data, pageId };
}


function previewString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}


function previewBody(data: VaultPagePreview): string {
  const legacyData = data as LegacyPagePreview;
  return previewString(data.body_md)
    || previewString(legacyData.content)
    || previewString(data.excerpt);
}


/** Show a full-record popup while a resolved wikilink is hovered. */
export function WikilinkHoverPreview({
  pageId,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: WikilinkHoverPreviewProps) {
  const { t } = useTranslation();
  const [requestState, setRequestState] = useState<PreviewState>(
    () => initialPreviewState(pageId),
  );
  const state = requestState.pageId === pageId
    ? requestState
    : initialPreviewState(pageId);
  const [popupPosition, setPopupPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const cached = readWikilinkPreviewCache(pageId);
    let cancelled = false;
    if (cached) {
      queueMicrotask(() => {
        if (!cancelled) {
          setRequestState({
            data: cached,
            error: false,
            loading: false,
            pageId,
          });
        }
      });
      return () => {
        cancelled = true;
      };
    }

    const controller = new AbortController();
    void fetchVaultPagePreview(pageId, { full: true }, controller.signal)
      .then((preview) => {
        if (controller.signal.aborted) return;
        writeWikilinkPreviewCache(pageId, preview);
        setRequestState({
          data: preview,
          error: false,
          loading: false,
          pageId,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setRequestState({ data: null, error: true, loading: false, pageId });
      });
    return () => {
      controller.abort();
    };
  }, [pageId]);

  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!anchorRect || !popup) return;
    setPopupPosition(positionHoverPreview(
      anchorRect,
      popup.getBoundingClientRect(),
      { height: window.innerHeight, width: window.innerWidth },
    ));
  }, [anchorRect, state.data, state.error, state.loading]);

  useEffect(() => {
    const popup = popupRef.current;
    const scrollElement = scrollRef.current;
    if (
      popup?.matches(':hover')
      && scrollElement
      && !scrollElement.contains(document.activeElement)
      && isHoverPreviewScrollable(scrollElement)
    ) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      scrollElement.focus({ preventScroll: true });
    }
  }, [popupPosition, state.data, state.loading]);

  if (!anchorRect) return null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (scrollHoverPreviewByKey(scrollRef.current, event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const handlePopupMouseEnter = (): void => {
    onMouseEnter?.();
    const scrollElement = scrollRef.current;
    if (
      scrollElement
      && !scrollElement.contains(document.activeElement)
      && isHoverPreviewScrollable(scrollElement)
    ) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      scrollElement.focus({ preventScroll: true });
    }
  };

  const handlePopupMouseLeave = (): void => {
    onMouseLeave?.();
    const scrollElement = scrollRef.current;
    if (!scrollElement?.contains(document.activeElement)) return;

    const previousFocus = previousFocusRef.current;
    previousFocusRef.current = null;
    if (
      previousFocus
      && previousFocus !== document.body
      && previousFocus.isConnected
    ) {
      previousFocus.focus({ preventScroll: true });
    } else {
      scrollElement.blur();
    }
  };

  const data = state.data;
  const title = previewString(data?.title)
    || t('common.untitled', 'Untitled');
  const cover = previewString(data?.cover);
  const icon = previewString(data?.icon);
  const body = data ? previewBody(data) : '';
  const popup = (
    <div
      ref={popupRef}
      role="dialog"
      aria-label={title}
      data-testid="wikilink-hover-preview"
      className="fixed z-[var(--z-popover)] flex flex-col bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700/60 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      style={popupPosition
        ? {
            ...PREVIEW_STYLE,
            left: popupPosition.left,
            opacity: 1,
            pointerEvents: 'auto',
            top: popupPosition.top,
          }
        : {
            ...PREVIEW_STYLE,
            left: -9_999,
            opacity: 0,
            pointerEvents: 'none',
            top: -9_999,
          }}
      onMouseEnter={handlePopupMouseEnter}
      onMouseLeave={handlePopupMouseLeave}
      onKeyDown={handleKeyDown}
    >
      {!state.loading && !state.error && cover && (
        <div
          className="h-16 bg-cover bg-center shrink-0"
          style={{ backgroundImage: `url("${cover}")` }}
        />
      )}
      {!state.loading && !state.error && data && (
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 shrink-0">
          {icon
            ? <IconRenderer icon={icon} size={16} className="flex-shrink-0" />
            : <FileText size={14} className="text-slate-400 flex-shrink-0" />}
          <h4 className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
            {title}
          </h4>
        </div>
      )}
      <div
        ref={scrollRef}
        tabIndex={-1}
        className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-4 outline-none custom-scrollbar"
      >
        {state.loading && (
          <div className="flex items-center gap-2 pt-4 text-sm text-slate-500">
            <div className="w-3 h-3 border-2 border-slate-300 border-t-[var(--gnosi-primary)] rounded-full animate-spin" />
            <span>{t('common.loading', 'Loading...')}</span>
          </div>
        )}
        {state.error && (
          <div className="flex items-center gap-2 pt-4 text-sm text-slate-500 dark:text-slate-400">
            <FileText size={14} />
            <span>{t('wikilink.preview_error', 'Could not load the page')}</span>
          </div>
        )}
        {!state.loading && !state.error && data && (
          body
            ? (
                <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed feed-md break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:[overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_code]:break-words [&_code]:[overflow-wrap:anywhere] [&_code]:overflow-x-hidden [&_table]:table [&_table]:w-full [&_table]:table-fixed [&_th]:break-words [&_th]:[overflow-wrap:anywhere] [&_td]:break-words [&_td]:[overflow-wrap:anywhere]">
                  <VaultMarkdown md={body} imageTitle={title} />
                </div>
              )
            : (
                <p className="text-xs text-slate-400 italic">
                  {t('wikilink.empty_page', 'Empty page')}
                </p>
              )
        )}
      </div>
    </div>
  );

  return createPortal(popup, document.body);
}


export default WikilinkHoverPreview;
