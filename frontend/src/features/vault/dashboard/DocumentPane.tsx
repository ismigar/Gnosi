import { useCallback, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { PaneVisibilityContext } from '../../../shared/ui/PaneVisibility';

export function DocumentPane({ children, paneId, visible, active, style }: {
  readonly children: ReactNode;
  readonly paneId: string;
  readonly visible: boolean;
  readonly active: boolean;
  readonly style: CSSProperties;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef(new Map<HTMLElement, { top: number; left: number }>());
  const previous = useRef({ visible, active });
  const restorationFrame = useRef<number | null>(null);
  const restoring = useRef(false);
  const cancelRestoration = useCallback(() => {
    if (restorationFrame.current !== null) cancelAnimationFrame(restorationFrame.current);
    restorationFrame.current = null;
    restoring.current = false;
  }, []);

  const rememberScroll = (element: HTMLElement) => {
    if (restoring.current) return;
    // Zero positions also matter when the user deliberately scrolls back up.
    if (element.scrollTop || element.scrollLeft || scrollRef.current.has(element)) {
      scrollRef.current.set(element, { top: element.scrollTop, left: element.scrollLeft });
    }
  };
  const rememberTarget = (target: EventTarget, focused: boolean) => {
    if (!visible || !(target instanceof HTMLElement) || !rootRef.current?.contains(target)) return;
    const card = target.closest<HTMLElement>('[data-pane-focus-return]');
    if (card || focused) focusRef.current = card || target;
    // Capture the current scroll synchronously before a citation switches tabs,
    // including a programmatic scroll whose scroll event has not fired yet.
    let ancestor: HTMLElement | null = target;
    while (ancestor && rootRef.current.contains(ancestor)) {
      rememberScroll(ancestor);
      ancestor = ancestor.parentElement;
    }
  };

  useLayoutEffect(() => {
    const returning = visible && (!previous.current.visible || (active && !previous.current.active));
    previous.current = { visible, active };
    if (!returning) return undefined;
    restoring.current = true;
    const positions = [...scrollRef.current];
    const restoreScroll = () => {
      for (const [element, position] of positions) {
        if (!rootRef.current?.contains(element)) {
          scrollRef.current.delete(element);
          continue;
        }
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      }
    };
    restoreScroll();
    const target = focusRef.current;
    if (active && target && rootRef.current?.contains(target)) target.focus({ preventScroll: true });
    // Hidden panes have no layout. Reapply after resize observers measure the
    // visible editor and its nested record views.
    restorationFrame.current = requestAnimationFrame(() => {
      restoreScroll();
      restorationFrame.current = null;
      restoring.current = false;
    });
    return cancelRestoration;
  }, [visible, active, cancelRestoration]);

  return <PaneVisibilityContext.Provider value={visible}>
    <div
      ref={rootRef}
      data-document-pane={paneId}
      hidden={!visible}
      inert={!visible}
      aria-hidden={!visible || undefined}
      className="flex flex-col overflow-hidden min-w-0 bg-[var(--bg-primary)]"
      style={{ ...style, display: visible ? undefined : 'none', flexShrink: 0 }}
      onFocusCapture={event => { rememberTarget(event.target, true); }}
      onPointerDownCapture={event => { cancelRestoration(); rememberTarget(event.target, false); }}
      onClickCapture={event => { cancelRestoration(); rememberTarget(event.target, false); }}
      onKeyDownCapture={cancelRestoration}
      onScrollCapture={event => {
        if (visible && event.target instanceof HTMLElement) rememberScroll(event.target);
      }}
    >
      <div className="flex-1 overflow-y-auto w-full min-w-0 h-full">{children}</div>
    </div>
  </PaneVisibilityContext.Provider>;
}
