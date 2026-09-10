import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { subscribeWindowEvent } from '../../../../shared/platform/browser-events';
import { mailMessageIdentity } from '../../mailIdentity';
import type { MailListMessage } from './mailListTypes';
import { DeferredMailMessagePreview } from './DeferredMailMessagePreview';

interface ActivePreview {
  readonly message: MailListMessage;
  readonly rect: DOMRect;
}

/** Keep one delayed, interactive preview open while crossing from its row. */
export function useMailMessagePreview(accountEmail?: string | null) {
  const [active, setActive] = useState<ActivePreview | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  const close = useCallback(() => {
    clearTimers();
    setActive(null);
  }, [clearTimers]);
  useEffect(() => {
    const unsubscribe = subscribeWindowEvent('resize', close);
    return () => { clearTimers(); unsubscribe(); };
  }, [clearTimers, close]);

  const openHover = (message: MailListMessage, rect: DOMRect): void => {
    clearTimers();
    openTimer.current = setTimeout(() => { setActive({ message, rect }); }, 350);
  };
  const scheduleClose = (): void => {
    clearTimers();
    closeTimer.current = setTimeout(() => { setActive(null); }, 180);
  };
  const preview = active ? (
    <Suspense fallback={null}>
      <DeferredMailMessagePreview
        key={mailMessageIdentity(active.message, accountEmail)}
        accountEmail={accountEmail}
        anchorRect={active.rect}
        message={active.message}
        onClose={close}
        onMouseEnter={clearTimers}
        onMouseLeave={scheduleClose}
      />
    </Suspense>
  ) : null;
  return { close, openHover, preview, scheduleClose };
}

export type MailMessagePreviewController = ReturnType<typeof useMailMessagePreview>;
