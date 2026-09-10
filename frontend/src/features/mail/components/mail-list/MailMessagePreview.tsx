import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { fetchMailMessage, type MailMessage } from '../../../../shared/api/mail';
import { ContactAvatar } from '../../../../shared/ui/avatars/ContactAvatar';
import {
  adaptiveHoverPreviewStyle,
  isHoverPreviewScrollable,
  positionHoverPreview,
  scrollHoverPreviewByKey,
} from '../../../../shared/ui/previews/hoverPreviewLayout';
import { MailBody } from '../MailBody';
import { cleanMailSender } from './mailListModel';
import type { MailListMessage } from './mailListTypes';

const CARD_STYLE = adaptiveHoverPreviewStyle({ maxHeight: 520, maxWidth: 520, minWidth: 300 });

interface MailMessagePreviewProps {
  readonly accountEmail?: string | null;
  readonly anchorRect: DOMRect;
  readonly message: MailListMessage;
  readonly onClose: () => void;
  readonly onMouseEnter: () => void;
  readonly onMouseLeave: () => void;
}

export default function MailMessagePreview({
  accountEmail, anchorRect, message, onClose, onMouseEnter, onMouseLeave,
}: MailMessagePreviewProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<MailMessage | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [position, setPosition] = useState<ReturnType<typeof positionHoverPreview> | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const email = message.account || message.account_email || accountEmail || undefined;

  useEffect(() => {
    const request = new AbortController();
    void fetchMailMessage(message.id, {
      email, folder: message.imap_folder || undefined,
    }, request.signal).then(result => {
      if (!request.signal.aborted) setData(result);
    }).catch(() => {
      if (!request.signal.aborted) setFailed(true);
    });
    return () => { request.abort(); };
  }, [attempt, email, message.id, message.imap_folder]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    let active = true;
    const update = (): void => {
      if (!active) return;
      const next = positionHoverPreview(anchorRect, card.getBoundingClientRect(), {
        height: window.innerHeight, width: window.innerWidth,
      });
      setPosition(current => current?.left === next.left && current.top === next.top ? current : next);
    };
    queueMicrotask(update);
    const observer = new ResizeObserver(update);
    observer.observe(card);
    return () => { active = false; observer.disconnect(); };
  }, [anchorRect]);

  const focusScroll = (): void => {
    const scroll = scrollRef.current;
    if (!scroll || scroll.contains(document.activeElement) || !isHoverPreviewScrollable(scroll)) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    scroll.focus({ preventScroll: true });
  };
  const restoreFocus = (): void => {
    const scroll = scrollRef.current;
    if (!scroll?.contains(document.activeElement)) return;
    if (previousFocus.current?.isConnected && previousFocus.current !== document.body) {
      previousFocus.current.focus({ preventScroll: true });
    } else scroll.blur();
    previousFocus.current = null;
  };
  const title = data?.subject || message.subject || t('common.untitled');

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={title}
      data-testid="mail-message-preview"
      className="fixed z-[var(--z-popover)] flex flex-col overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl"
      style={{ ...CARD_STYLE, width: CARD_STYLE.maxWidth, left: position?.left ?? -9999, top: position?.top ?? -9999 }}
      onMouseEnter={() => { onMouseEnter(); focusScroll(); }}
      onMouseLeave={() => { restoreFocus(); onMouseLeave(); }}
      onClick={event => { event.stopPropagation(); }}
      onKeyDown={event => {
        if (scrollHoverPreviewByKey(scrollRef.current, event.key)) {
          event.preventDefault();
          event.stopPropagation();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          restoreFocus();
          onClose();
        }
      }}
    >
      <div className="flex shrink-0 items-start gap-3 border-b border-[var(--border-primary)] px-4 py-3">
        <ContactAvatar name={cleanMailSender(message.sender)} email={message.sender} />
        <div className="min-w-0 break-words">
          <div className="text-sm font-semibold text-[var(--text-primary)]">{cleanMailSender(message.sender)}</div>
          <div className="text-xs text-[var(--text-secondary)]">{message.date}</div>
          <h4 className="mt-2 text-sm font-bold text-[var(--text-primary)]">{title}</h4>
        </div>
      </div>
      <div
        ref={scrollRef}
        data-role="mail-preview-scroll"
        tabIndex={0}
        className="custom-scrollbar flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-3 outline-none"
      >
        {!data && !failed && <p role="status" className="text-sm text-[var(--text-secondary)]">{t('common.loading')}</p>}
        {failed && <div role="status" className="text-sm text-[var(--text-secondary)]">
          <p>{t('mail.messages_temporarily_unavailable')}</p>
          <button type="button" className="mt-2 font-semibold text-[var(--gnosi-blue)]" onClick={() => {
            setFailed(false);
            setAttempt(current => current + 1);
          }}>{t('common.retry')}</button>
        </div>}
        {data && <MailBody
          bodyHtml={data.body_html}
          bodyText={data.body_text}
          email={data.account || email}
          folder={data.imap_folder || message.imap_folder}
          messageId={data.id}
          remoteImageBlockedLabel={t('mail.remote_image_blocked')}
          remoteImageOpenOriginalLabel={t('mail.remote_image_open_original')}
          remoteImageRecoveryLabel={t('mail.remote_image_recovery')}
          remoteImageRecoveringLabel={t('mail.remote_image_recovering')}
          remoteImageRetryLabel={t('common.retry')}
          remoteImageUnavailableDetail={t('mail.remote_image_unavailable_detail')}
          remoteImageBlockedDetail={t('mail.remote_image_blocked_detail')}
          remoteImageTimeoutDetail={t('mail.remote_image_timeout_detail')}
          remoteImageTooLargeDetail={t('mail.remote_image_too_large_detail')}
          remoteImageUnsupportedDetail={t('mail.remote_image_unsupported_detail')}
          remoteImageUnavailableLabel={t('mail.remote_image_unavailable')}
        />}
      </div>
    </div>,
    document.body,
  );
}
