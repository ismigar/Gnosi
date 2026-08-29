import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import {
  FILE_PROTOCOL_SENTINEL,
  sentinelToFileUrl,
} from '../components/Vault/markdown-mapper';
import { citationParamsFromHref, isCitationHref } from '../lib/citationDeepLink';
import { openCitation, openFileResource } from '../lib/fileResource';
import {
  subscribeDocumentEvent,
  subscribeWindowEvent,
} from '../shared/platform/browser-events';

const POINTER_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'auxclick',
] as const;
const LEGACY_FILE_SENTINEL = 'https://__gnosi_file_protocol__';
const CORRUPTED_FILE_SENTINEL = 'https://**gnosi_file_protocol**';

type SmartLinkKind = 'citation' | 'file';

interface SmartLink {
  readonly anchor: HTMLAnchorElement;
  readonly href: string;
  readonly kind: SmartLinkKind;
}

const convertSentinelToFileUrl = sentinelToFileUrl as unknown as (
  href: string,
) => string;

function isLocalFileHref(href: string): boolean {
  return /^file:/i.test(href)
    || href.startsWith(FILE_PROTOCOL_SENTINEL)
    || href.startsWith(LEGACY_FILE_SENTINEL)
    || href.startsWith(CORRUPTED_FILE_SENTINEL);
}

function toBackendPath(href: string): string {
  if (!href) return '';
  if (/^file:/i.test(href)) return href;
  if (href.startsWith(CORRUPTED_FILE_SENTINEL)) {
    return `file://${href.slice(CORRUPTED_FILE_SENTINEL.length)}`;
  }
  return convertSentinelToFileUrl(href);
}

function citationTextFromAnchor(anchor: HTMLAnchorElement): string {
  const quote = anchor.closest('blockquote');
  if (!quote) return '';
  const copy = quote.cloneNode(true);
  if (!(copy instanceof Element)) return '';
  for (const link of copy.querySelectorAll('a')) {
    if (isCitationHref(link.getAttribute('href') || '')) link.remove();
  }
  return copy.textContent.trim().replace(/[—–-]\s*$/, '').trim();
}

function findSmartAnchor(event: MouseEvent | PointerEvent): SmartLink | null {
  if (!(event.target instanceof Element)) return null;
  const anchor = event.target.closest('a');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  const href = anchor.getAttribute('href') || '';
  if (isLocalFileHref(href)) return { anchor, href, kind: 'file' };
  if (isCitationHref(href)) return { anchor, href, kind: 'citation' };
  return null;
}

export function useFileLinkInterceptor(): void {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    let lastOpenedAt = 0;
    const handleSmartLink = (event: MouseEvent | PointerEvent) => {
      const found = findSmartAnchor(event);
      if (!found) return;
      if ((event.metaKey || event.ctrlKey) && found.kind === 'file') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.type !== 'click' && event.type !== 'auxclick') return;
      const now = Date.now();
      if (now - lastOpenedAt <= 250) return;
      lastOpenedAt = now;
      if (found.kind === 'citation') {
        const query = citationParamsFromHref(found.href);
        const resourceId = query?.get('res');
        if (!query || !resourceId) return;
        void openCitation(resourceId, query.get('page'), {
          citation: {
            ...Object.fromEntries(query.entries()),
            highlightText: citationTextFromAnchor(found.anchor),
          },
          navigate,
          t,
        });
        return;
      }
      openFileResource(toBackendPath(found.href), { navigate, t });
    };

    const unsubscribers: Array<() => void> = [];
    for (const eventName of POINTER_EVENTS) {
      unsubscribers.push(
        subscribeWindowEvent(eventName, handleSmartLink, true),
        subscribeDocumentEvent(eventName, handleSmartLink, true),
      );
    }
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [navigate, t]);
}

export default useFileLinkInterceptor;
