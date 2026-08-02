/**
 * useFileLinkInterceptor
 *
 * Captures smart resource links inside the editor. Local files are routed to
 * Gnosi's file opener, while generated citation links resolve their persisted
 * evidence and open the source at the exact location.
 *
 * Why this is needed: modern browsers block file:// when navigating
 * from an http(s) page. Also, BlockNote/Tiptap (extension-link)
 * strips the href of any disallowed protocol (file: isn't one of them), so
 * in the editor blocks the internal href is the sentinel
 *   https://gnosi-file-protocol.local/...
 * (which does pass validation). Here we detect both forms (file:// and
 * the sentinel, including the legacy sentinel `__gnosi_file_protocol__`), stop
 * propagation, and call the backend with the path converted to a real file://.
 *
 * Strategy: Listener delegated on window and document (capture phase) to
 * catch mousedown/mouseup/click/auxclick before any other handler.
 * We need to intercept `mouseup` because ProseMirror (BlockNote/Tiptap) fires
 * the Tiptap link handler inside `mouseup` (not `click`) and does
 * `window.open(href, target)` there — before the `click` event arrives. If
 * we only intercepted `click`, it would already be too late.
 *
 * The previous version had a second layer with a subtree-wide MutationObserver
 * on document.body to normalize every relevant <a> (target="_self",
 * remove rel) and attach direct listeners to it. This layer was redundant
 * (capture phase on window is always the FIRST handler, immune to
 * third-party stopPropagation) and had a catastrophic cost: opening a
 * page with many blocks (60+) and file:// links, BlockNote/ProseMirror
 * would emit a flood of DOM mutations on the initial render that saturated the
 * main thread — Chrome would mark the tab as "not responding" before
 * the content became visible. Removed.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FILE_PROTOCOL_SENTINEL, sentinelToFileUrl } from '../components/Vault/markdown-mapper';
import { citationParamsFromHref, isCitationHref } from '../lib/citationDeepLink';
import { openCitation, openFileResource } from '../lib/fileResource';

// We intercept BOTH mouse* and pointer* events. Tiptap/ProseMirror can
// fire the link handler (which calls `window.open(href, target)`)
// inside a `pointerdown`/`pointerup` in modern browsers: if we only
// listened for mouse* events, the pointer event would arrive first and open a
// new tab at the `gnosi-file-protocol.local` sentinel before our
// `preventDefault`.
const POINTER_EVENTS = [
    'pointerdown', 'pointerup',
    'mousedown', 'mouseup',
    'click', 'auxclick',
];
const LEGACY_FILE_SENTINEL = 'https://__gnosi_file_protocol__';
const CORRUPTED_FILE_SENTINEL = 'https://**gnosi_file_protocol**';

const isLocalFileHref = (href) => {
    if (!href) return false;
    if (/^file:/i.test(href)) return true;
    if (href.startsWith(FILE_PROTOCOL_SENTINEL)) return true;
    if (href.startsWith(LEGACY_FILE_SENTINEL)) return true;
    if (href.startsWith(CORRUPTED_FILE_SENTINEL)) return true;
    return false;
};

const toBackendPath = (href) => {
    if (!href) return '';
    if (/^file:/i.test(href)) return href;
    if (href.startsWith(CORRUPTED_FILE_SENTINEL)) {
        return 'file://' + href.slice(CORRUPTED_FILE_SENTINEL.length);
    }
    return sentinelToFileUrl(href);
};

const citationTextFromAnchor = (anchor) => {
    const quote = anchor?.closest?.('blockquote');
    if (!quote) return '';
    const copy = quote.cloneNode(true);
    for (const link of copy.querySelectorAll('a')) {
        if (isCitationHref(link.getAttribute('href') || '')) link.remove();
    }
    return String(copy.textContent || '').trim().replace(/[—–-]\s*$/, '').trim();
};

export function useFileLinkInterceptor() {
    const { t } = useTranslation();
    const navigate = useNavigate();

    useEffect(() => {
        // Avoids firing the call more than once for the same gesture
        // (mousedown + mouseup + click es dispararien en cadena).
        let lastOpenedAt = 0;

        const findSmartAnchor = (e) => {
            const a = e.target?.closest?.('a');
            if (!a) return null;
            const href = a.getAttribute('href') || '';
            if (isLocalFileHref(href)) return { anchor: a, href, kind: 'file' };
            if (isCitationHref(href)) return { anchor: a, href, kind: 'citation' };
            return null;
        };

        // LAYER 1: handlers on window and document in the capture phase
        const winHandler = (e) => {
            const found = findSmartAnchor(e);
            if (!found) return;
            // Cmd/Ctrl-click keeps the native behavior for local file URLs.
            // Citation sentinels must always stay inside Gnosi.
            if ((e.metaKey || e.ctrlKey) && found.kind === 'file') return;
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }
            // Only trigger the opening once per gesture. We pick `click`
            // as the definitive moment (mousedown/mouseup only block
            // propagation so ProseMirror doesn't catch it).
            const now = Date.now();
            if (e.type === 'click' || e.type === 'auxclick') {
                if (now - lastOpenedAt > 250) {
                    lastOpenedAt = now;
                    if (found.kind === 'citation') {
                        const query = citationParamsFromHref(found.href);
                        const resourceId = query?.get('res');
                        if (resourceId) {
                            void openCitation(resourceId, query.get('page'), {
                                navigate,
                                citation: {
                                    ...Object.fromEntries(query.entries()),
                                    highlightText: citationTextFromAnchor(found.anchor),
                                },
                                t,
                            });
                        }
                    } else {
                        const backendPath = toBackendPath(found.href);
                        // PDF/EPUB/HTML → embedded viewer (Zotero reader); others →
                        // OS app. The routing lives in openFileResource so the
                        // "Open" button on file fields behaves the same way.
                        openFileResource(backendPath, { navigate, t });
                    }
                }
            }
        };
        for (const evt of POINTER_EVENTS) {
            window.addEventListener(evt, winHandler, true);
            document.addEventListener(evt, winHandler, true);
        }

        return () => {
            for (const evt of POINTER_EVENTS) {
                window.removeEventListener(evt, winHandler, true);
                document.removeEventListener(evt, winHandler, true);
            }
        };
    }, [t, navigate]);
}

export default useFileLinkInterceptor;
