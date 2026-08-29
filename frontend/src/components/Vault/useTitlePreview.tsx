import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import { PageHoverCard } from './PageHoverCard';


const HOVER_OPEN_DELAY = 350;
const HOVER_CLOSE_DELAY = 180;


export interface TitlePreviewActiveState {
  readonly pageId: string;
  readonly rect: DOMRect;
  readonly viaKeyboard: boolean;
}


export interface TitlePreviewOptions {
  readonly onOpenPage?: (pageId: string) => void;
}


export interface TitlePreviewTriggerProps {
  readonly onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => void;
  readonly onMouseLeave: () => void;
}


export interface TitlePreviewController {
  readonly active: TitlePreviewActiveState | null;
  readonly cancelClose: () => void;
  readonly close: () => void;
  readonly getTitleProps: (pageId: string) => TitlePreviewTriggerProps;
  readonly openForKeyboard: (pageId: string, rect: DOMRect) => void;
  readonly openHover: (pageId: string, rect: DOMRect) => void;
  readonly preview: ReactNode;
  readonly scheduleClose: () => void;
}


/** Coordinate one delayed title preview per view. */
export function useTitlePreview({
  onOpenPage,
}: TitlePreviewOptions = {}): TitlePreviewController {
  const [active, setActive] = useState<TitlePreviewActiveState | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);

  const clearTimers = useCallback((): void => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => () => {
    clearTimers();
  }, [clearTimers]);

  const close = useCallback((): void => {
    clearTimers();
    setActive(null);
  }, [clearTimers]);

  const openForKeyboard = useCallback((pageId: string, rect: DOMRect): void => {
    if (!pageId) return;
    clearTimers();
    setActive({ pageId, rect, viaKeyboard: true });
  }, [clearTimers]);

  const scheduleClose = useCallback((): void => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => {
      setActive(null);
    }, HOVER_CLOSE_DELAY);
  }, [clearTimers]);

  const openHover = useCallback((pageId: string, rect: DOMRect): void => {
    if (!pageId) return;
    clearTimers();
    openTimer.current = window.setTimeout(() => {
      setActive({ pageId, rect, viaKeyboard: false });
    }, HOVER_OPEN_DELAY);
  }, [clearTimers]);

  const getTitleProps = useCallback((pageId: string): TitlePreviewTriggerProps => ({
    onMouseEnter: (event) => {
      openHover(pageId, event.currentTarget.getBoundingClientRect());
    },
    onMouseLeave: () => {
      if (openTimer.current !== null) {
        window.clearTimeout(openTimer.current);
        openTimer.current = null;
      }
      scheduleClose();
    },
  }), [openHover, scheduleClose]);

  const preview = active ? (
    <PageHoverCard
      pageId={active.pageId}
      anchorRect={active.rect}
      viaKeyboard={active.viaKeyboard}
      onClose={close}
      onOpenPage={onOpenPage}
      onMouseEnter={clearTimers}
      onMouseLeave={scheduleClose}
    />
  ) : null;

  return {
    active,
    cancelClose: clearTimers,
    close,
    getTitleProps,
    openForKeyboard,
    openHover,
    preview,
    scheduleClose,
  };
}


export default useTitlePreview;
