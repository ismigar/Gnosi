import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';
import { getLocaleMeta } from '../../locales/registry';
import { uiLangToZoteroLocale } from './zoteroLocale';
import { transportFetch } from '../../shared/api/transports';

const HOST_URL = '/zotero-reader/host.html?v=20260802-citation-highlights-2';

const toFilesystemPath = (src) => {
    if (!src) return '';
    if (/^file:\/\//i.test(src)) {
        try { return decodeURIComponent(src.slice(7)); }
        catch { return src.slice(7); }
    }
    return src;
};

/**
 * Embed of the Zotero viewer (zotero/reader) inside a Vault tab.
 *
 * Architecture:
 *   - The iframe loads `public/zotero-reader/host.html`, a thin shell that
 *     embeds the reader's web bundle (AGPL-3.0) and exposes a minimal
 *     postMessage protocol to this React component.
 *   - The PDF is served via `/api/vault/local-file/{token}` (the same endpoint
 *     as our own pdf.js viewer). This way we reuse the OneDrive warmup,
 *     materialization, and backend cache.
 *   - Annotations are persisted via `/api/vault/pdf-annotations` just
 *     as before, but the format is now Zotero's native one (rects in
 *     PDF coords + 0-based pageIndex). There's a transparent adapter.
 *
 * Why iframe and not mounting the bundle directly:
 *   - The reader's bundle weighs ~3MB minified + 800KB of vendors. Adding it
 *     to Gnosi's SPA penalizes startup for all users,
 *     even those who never open a PDF.
 *   - The bundle defines globals (`window.createReader`, `window._reader`)
 *     and uses React and ReactDOM in global mode — it would collide with
 *     the Vault's React 18. The iframe isolates them.
 */
/**
 * Document types the Zotero reader can display:
 *  - 'pdf'      : PDF (default)
 *  - 'epub'     : EPUB
 *  - 'snapshot' : locally saved HTML page (.html / .htm)
 *
 * The loaded web bundle includes all three rendering paths built in.
 */
const KIND_BY_EXTENSION = {
    pdf: 'pdf',
    epub: 'epub',
    html: 'snapshot',
    htm: 'snapshot',
};

// eslint-disable-next-line react-refresh/only-export-components
export function detectKindFromSrc(src) {
    if (!src) return 'pdf';
    const clean = String(src).split('?')[0].split('#')[0].toLowerCase();
    const m = clean.match(/\.([a-z0-9]+)$/);
    return (m && KIND_BY_EXTENSION[m[1]]) || 'pdf';
}

export function ZoteroReaderTab({ src, title: titleProp, onClose, kind: kindProp, location: locationProp }) {
    const { t, i18n } = useTranslation();
    const iframeRef = useRef(null);
    // Language for the Zotero viewer. We recalculate it when the user changes the
    // language in Gnosi (re-mounting the component via key is typical, but
    // we detect it here in case the app doesn't do a full re-mount).
    const zoteroLanguage = useMemo(() => uiLangToZoteroLocale(i18n?.language), [i18n?.language]);
    const zoteroDirection = useMemo(
        () => getLocaleMeta(i18n?.language).direction,
        [i18n?.language]
    );
    const rawSrc = src || '';
    const kind = kindProp || detectKindFromSrc(rawSrc);
    const filename = useMemo(() => {
        if (titleProp) return titleProp;
        const path = toFilesystemPath(rawSrc);
        const parts = path.split('/');
        return parts[parts.length - 1] || `document.${kind === 'epub' ? 'epub' : (kind === 'snapshot' ? 'html' : 'pdf')}`;
    }, [rawSrc, titleProp, kind]);

    const [pdfUrl, setPdfUrl] = useState(null);
    const [error, setError] = useState(null);
    const [annotationsLoaded, setAnnotationsLoaded] = useState(false);
    const [readerReady, setReaderReady] = useState(false);
    // All these signals must match before sending a SINGLE
    // message `init`. The Zotero reader rejects `createReader` called
    // twice ("Reader is already initialized"), so we need to
    // guarantee idempotency via initSentRef.
    const hostReadyRef = useRef(false);
    const initSentRef = useRef(false);
    // Deep-link target (e.g. a citation's page). Kept as a ref so `init` can
    // read the freshest value without re-sending init (idempotency), and an
    // effect below re-navigates when it changes on an already-open reader.
    const locationRef = useRef(locationProp || null);
    // Live annotations during the session. We store them as a ref (not state)
    // because we no longer render them ourselves — the Zotero reader does
    // all of it, we only persist. ESLint doesn't complain about unused variables
    // no llegides.
    const annotationsRef = useRef([]);
    // Mapping zoteroId → dbId (numeric). Necessary because:
    //  - When we receive `delete-annotations` with a Zotero id (an annotation
    //    created in this session), we can find the dbId from the recent POST.
    //  - Avoid duplicates: if the reader sends `save-annotations` with the
    //    same annotation (Zotero id) twice, the second one must be
    //    PATCH no POST.
    const zoteroToDbIdRef = useRef(new Map());

    const fetchPersistedAnnotations = useCallback(async ({ signal } = {}) => {
        if (!rawSrc) return [];
        const res = await transportFetch(
            `/api/vault/pdf-annotations?source_uri=${encodeURIComponent(rawSrc)}`,
            { signal },
        );
        if (signal?.aborted) return null;
        if (!res.ok) return null;
        const data = await res.json();
        if (signal?.aborted) return null;
        if (!Array.isArray(data)) return [];
        const mapped = data.map(pdfAnnotationToZotero);
        annotationsRef.current = mapped;
        for (const annotation of mapped) {
            if (typeof annotation.id === 'string' && annotation.id.startsWith('gnosi:')) {
                zoteroToDbIdRef.current.set(annotation.id, Number(annotation.id.slice(6)));
            }
        }
        return mapped;
    }, [rawSrc]);

    // --- Register the PDF with the backend to get the servable URL ---
    useEffect(() => {
        let cancelled = false;
        setError(null); setPdfUrl(null);
        if (!rawSrc) {
            setError(t('pdf.no_src', { defaultValue: "There is no PDF to display" }));
            return undefined;
        }
        if (/^https?:\/\//i.test(rawSrc) || rawSrc.startsWith('/api/')) {
            setPdfUrl(rawSrc);
            return undefined;
        }
        const filePath = toFilesystemPath(rawSrc);
        (async () => {
            try {
                const res = await transportFetch('/api/vault/local-file/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_path: filePath }),
                });
                if (!res.ok) {
                    const detail = await res.text().catch(() => '');
                    if (!cancelled) setError(`Could not open the PDF: ${detail || 'HTTP ' + res.status}`);
                    return;
                }
                const data = await res.json();
                if (!cancelled) setPdfUrl(data.url);
            } catch (err) {
                if (!cancelled) setError(`Could not open the PDF: ${err?.message || err}`);
            }
        })();
        return () => { cancelled = true; };
    }, [rawSrc, t]);

    // --- Load existing annotations on mount ---
    // Full reset when rawSrc changes: if the same component is reused
    // on the `/vault/pdf?src=...` route for a different document, we don't
    // we must end up with annotations from the previous document. We also reset
    // `initSentRef` to false so a new init is sent to the iframe.
    useEffect(() => {
        annotationsRef.current = [];
        zoteroToDbIdRef.current = new Map();
        initSentRef.current = false;
        if (!rawSrc) return undefined;
        const controller = new AbortController();
        setAnnotationsLoaded(false);
        (async () => {
            try {
                await fetchPersistedAnnotations({ signal: controller.signal });
            } catch (err) {
                if (err?.name !== 'AbortError') {
                    console.warn('zotero-reader: load annotations failed', err);
                }
            } finally {
                if (!controller.signal.aborted) setAnnotationsLoaded(true);
            }
        })();
        return () => controller.abort();
    }, [rawSrc, fetchPersistedAnnotations]);

    // --- Send init to the iframe (ONLY ONCE) when everything is ready ---
    // Three signals must coincide: host-ready, pdfUrl loaded,
    // annotations loaded (GET resolved). initSentRef prevents re-sends.
    const sendInitIfReady = useCallback(() => {
        if (initSentRef.current) return;
        if (!hostReadyRef.current) return;
        if (!pdfUrl) return;
        if (!annotationsLoaded) return;
        const iframeWin = iframeRef.current?.contentWindow;
        if (!iframeWin) return;
        initSentRef.current = true;
        iframeWin.postMessage({
            target: 'zotero-reader',
            type: 'init',
            payload: {
                pdfUrl,
                kind,
                language: zoteroLanguage,
                direction: zoteroDirection,
                annotations: annotationsRef.current,
                // NotebookLM-style deep link: jump to this location (e.g. a
                // citation's page) once the reader is initialized.
                location: locationRef.current || null,
                options: {
                    authorName: 'User',
                    readOnly: false,
                },
            },
        }, window.location.origin);
    }, [pdfUrl, annotationsLoaded, kind, zoteroLanguage, zoteroDirection]);

    useEffect(() => {
        sendInitIfReady();
    }, [sendInitIfReady]);

    // Deep-link navigation: when the target location changes on an
    // already-ready reader (e.g. clicking a second citation while the same
    // PDF is open), tell the iframe to jump. On first open, `init` carries
    // the location, so this only fires for subsequent jumps.
    useEffect(() => {
        locationRef.current = locationProp || null;
        if (!locationProp || !readerReady) return;
        const iframeWin = iframeRef.current?.contentWindow;
        if (!iframeWin) return;
        iframeWin.postMessage({
            target: 'zotero-reader',
            type: 'navigate',
            location: locationProp,
        }, window.location.origin);
        // Processing may have created managed citation highlights after this
        // reader was opened. Refresh additively before reusing the same tab so
        // the persistent annotation appears without mounting a second iframe.
        const controller = new AbortController();
        void fetchPersistedAnnotations({ signal: controller.signal })
            .then((annotations) => {
                if (controller.signal.aborted || !annotations) return;
                iframeWin.postMessage({
                    target: 'zotero-reader',
                    type: 'set-annotations',
                    annotations,
                }, window.location.origin);
            })
            .catch((err) => {
                if (err?.name !== 'AbortError') {
                    console.warn('zotero-reader: refresh annotations failed', err);
                }
            });
        return () => controller.abort();
    }, [locationProp, readerReady, fetchPersistedAnnotations]);

    // --- Listener for the iframe's postMessage ---
    // Origin guard: the handler must only accept messages that come
    // from OUR iframe (same origin as the main window). Without
    // this, any other window/iframe in the browser could emit a
    // `save-annotations` i triggerar escriptures a la BD.
    useEffect(() => {
        const onMsg = (ev) => {
            // The message origin must be the same domain. The bundle
            // lives at /zotero-reader/host.html, same origin as the
            // frontend principal.
            if (ev.origin !== window.location.origin) return;
            // And the sending window must be our iframe. This way no
            // another browser frame (popup, devtools, extension) can
            // impersonate messages.
            if (!iframeRef.current || ev.source !== iframeRef.current.contentWindow) return;
            const data = ev.data || {};
            if (data.source !== 'zotero-reader') return;
            switch (data.type) {
                case 'host-ready':
                    hostReadyRef.current = true;
                    sendInitIfReady();
                    break;
                case 'ready':
                    setReaderReady(true);
                    break;
                case 'error':
                    setError(data.message || 'Reader error');
                    break;
                case 'save-annotations':
                    void persistSaveAnnotations(data.annotations || []);
                    break;
                case 'delete-annotations':
                    void persistDeleteAnnotations(data.ids || []);
                    break;
                case 'open-link':
                    if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer');
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('message', onMsg);
        return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sendInitIfReady]);

    // --- Bidirectional persistence ---
    // Zotero sends LISTS of annotations on every save (not diffs). For each
    // annotation:
    //   - If its id is `gnosi:N` or it exists in `zoteroToDbIdRef`,
    //     the annotation already lives in the DB → PATCH with the dbId.
    //   - Otherwise, it's new → POST. Then we send `update-annotations`
    //     to the iframe to replace the Zotero id with `gnosi:N`. This way
    //     subsequent saves (in the same session) will recognize it as
    //     existing and won't create duplicates; and a later delete with
    //     the original Zotero id can also find the dbId in the mapping.
    const persistSaveAnnotations = useCallback(async (zoteroAnnotations) => {
        const idUpdates = [];   // { oldId: zoteroId, newId: 'gnosi:N' }
        for (const ann of zoteroAnnotations) {
            let dbId = null;
            if (typeof ann.id === 'string' && ann.id.startsWith('gnosi:')) {
                dbId = Number(ann.id.slice('gnosi:'.length));
            } else if (typeof ann.id === 'string' && zoteroToDbIdRef.current.has(ann.id)) {
                dbId = zoteroToDbIdRef.current.get(ann.id);
            }
            const body = zoteroToPdfAnnotation(ann, rawSrc);
            try {
                if (dbId != null) {
                    const res = await transportFetch(`/api/vault/pdf-annotations/${dbId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            color: body.color,
                            text: body.text,
                            comment: body.comment,
                            rects: body.rects,
                        }),
                    });
                    if (!res.ok) {
                        // fetch doesn't throw for non-2xx. Without this a 403/500
                        // was being overlooked; now we see detail if the backend
                        // includes it in the body.
                        const detail = await res.text().catch(() => '');
                        console.warn('zotero-reader: PATCH failed', res.status, detail.slice(0, 200));
                    }
                } else {
                    const res = await transportFetch('/api/vault/pdf-annotations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    if (res.ok) {
                        const created = await res.json();
                        const newId = `gnosi:${created.id}`;
                        zoteroToDbIdRef.current.set(ann.id, created.id);
                        // We also store the `newId` in the mapping in case a
                        // a later save with the id already converted.
                        zoteroToDbIdRef.current.set(newId, created.id);
                        idUpdates.push({ oldId: ann.id, newId });
                    }
                }
            } catch (err) {
                console.warn('zotero-reader: persist save failed', err);
            }
        }
        // If we've created new annotations, we notify the iframe so it
        // updates the ids in memory. This way `delete-annotations` and future
        // `save-annotations` will already carry the `gnosi:N` id.
        if (idUpdates.length > 0) {
            const iframeWin = iframeRef.current?.contentWindow;
            iframeWin?.postMessage({
                target: 'zotero-reader',
                type: 'update-annotation-ids',
                idMap: idUpdates,
            }, window.location.origin);
        }
    }, [rawSrc]);

    const persistDeleteAnnotations = useCallback(async (ids) => {
        for (const id of ids) {
            if (typeof id !== 'string') continue;
            // We resolve the dbId: explicit (`gnosi:N`), from the mapping (an annotation
            // created in this session and still with a Zotero id), or we skip it.
            let dbId = null;
            if (id.startsWith('gnosi:')) {
                dbId = Number(id.slice('gnosi:'.length));
            } else if (zoteroToDbIdRef.current.has(id)) {
                dbId = zoteroToDbIdRef.current.get(id);
            }
            if (dbId == null) continue;
            try {
                const res = await transportFetch(`/api/vault/pdf-annotations/${dbId}`, { method: 'DELETE' });
                // 404 is acceptable (a race with another client that has already
                // deleted it) — we clean up the mapping anyway so that no
                // an orphan id. Other error statuses: we log and DO NOT touch the
                // mapping is left behind, so the next save can try to re-sync.
                if (res.ok || res.status === 404) {
                    zoteroToDbIdRef.current.delete(id);
                    zoteroToDbIdRef.current.delete(`gnosi:${dbId}`);
                } else {
                    const detail = await res.text().catch(() => '');
                    console.warn('zotero-reader: DELETE failed', res.status, detail.slice(0, 200));
                }
            } catch (err) {
                console.warn('zotero-reader: delete failed', err);
            }
        }
    }, []);

    const openExternal = async () => {
        const filePath = toFilesystemPath(rawSrc);
        if (!filePath) return;
        try {
            const res = await transportFetch('/api/vault/open-local-path', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: `file://${filePath}` }),
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
        } catch (err) {
            toast.error(t('pdf.open_external_error', "Could not open externally: {{message}}", { message: err.message }));
        }
    };

    const toolbar = (
        <div className="flex items-center gap-2 px-3 py-2 shrink-0"
             style={{ background: '#3c3f41', borderBottom: '1px solid #222' }}>
            {onClose && (
                <button onClick={onClose}
                    title={t('pdf.back', { defaultValue: "Back" })}
                    className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/10">
                    <ArrowLeft size={16} />
                </button>
            )}
            <div className="text-white/90 text-[13px] font-medium truncate max-w-[60vw]" title={filename}>
                {filename}
            </div>
            {!readerReady && !error && (
                <span className="text-white/40 text-[11px] ml-2 italic">
                    {t('pdf.loading', { defaultValue: "Loading…" })}
                </span>
            )}
            <button onClick={openExternal}
                title={t('pdf.open_external', { defaultValue: "Open with the system app" })}
                className="ml-auto w-7 h-7 flex items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white">
                <ExternalLink size={15} />
            </button>
        </div>
    );

    return (
        <div className="flex flex-col h-full" style={{ background: '#525659' }}>
            {toolbar}
            {error ? (
                <div className="p-12 text-center text-red-300 text-sm">{error}</div>
            ) : (
                <iframe
                    ref={iframeRef}
                    src={HOST_URL}
                    title={filename}
                    className="flex-1 border-0 w-full"
                    // Permissions needed for the reader to work: clipboard
                    // (copying excerpts), downloads (printed PDF export),
                    // fullscreen (for the reader's own fullscreen control).
                    allow="clipboard-write; clipboard-read; fullscreen"
                />
            )}
        </div>
    );
}

// =============================================================================
// Annotation adapters between the Zotero format (used by the reader) and
// the format we persist in the DB (`pdf_annotations`).
//
// Format BD:    { id, source_uri, page, type, color, rects: [{x,y,w,h}],
//                 text, comment, tags, created_at, updated_at }
//                 - rects in NORMALIZED 0-1 coords with top-left origin
//                 - page 1-indexed
//
// Format Zotero: { id, type, color, sortIndex, pageLabel, dateCreated,
//                  dateModified, authorName, isAuthorNameAuthoritative,
//                  text, comment, tags,
//                  position: { pageIndex, rects: [[x1,y1,x2,y2], ...] } }
//                  - rects en coords PDF (origen bottom-left, en punts)
//                  - pageIndex 0-indexed
//
// Coordinate conversion requires knowing the dimensions of the
// page, which we do NOT have when we only persist to the DB. Solution: store
// the entire Zotero JSON in the `comment` field (as serialized JSON with
// prefix __ZOTERO__), and keep `text`, `page`, `color`, `type` for
// quick filters. Coordinate conversion is left to the Zotero reader.
// =============================================================================

const ZOTERO_BLOB_PREFIX = '__ZOTERO_JSON__';

function pdfAnnotationToZotero(dbAnn) {
    // If the comment carries the Zotero blob, we make use of it (full of details that
    // we didn't replicate in the DB).
    if (dbAnn.comment && dbAnn.comment.startsWith(ZOTERO_BLOB_PREFIX)) {
        try {
            const parsed = JSON.parse(dbAnn.comment.slice(ZOTERO_BLOB_PREFIX.length));
            return { ...parsed, id: `gnosi:${dbAnn.id}` };
        } catch { /* fall through to reconstruction */ }
    }
    // Lossy reconstruction for annotations created with the old pdf.js viewer.
    // Coords normalitzades (origen TL) → coords Zotero (origen BL) requereix
    // the actual page dimensions that we don't have here. Without this the reader
    // won't be able to show them visually, but they do appear in the sidebar. This will improve
    // the next time it's opened when the user saves them again.
    return {
        id: `gnosi:${dbAnn.id}`,
        type: dbAnn.type || 'highlight',
        color: dbAnn.color || '#ffeb3b',
        sortIndex: '00000|0|0',
        pageLabel: String(dbAnn.page),
        dateCreated: dbAnn.created_at || new Date().toISOString(),
        dateModified: dbAnn.updated_at || dbAnn.created_at || new Date().toISOString(),
        authorName: '',
        isAuthorNameAuthoritative: true,
        text: dbAnn.text || '',
        comment: '',
        tags: [],
        position: {
            pageIndex: Math.max(0, (dbAnn.page || 1) - 1),
            rects: [], // acceptable loss: Zotero will recalculate them on re-highlight
        },
    };
}

function zoteroToPdfAnnotation(zAnn, sourceUri) {
    return {
        source_uri: sourceUri,
        page: (zAnn.position?.pageIndex ?? 0) + 1,
        type: zAnn.type || 'highlight',
        color: zAnn.color || '#ffeb3b',
        // Empty rects because we keep them inside the blob (see comment).
        // The DB only needed them for the old viewer's overlay.
        rects: [],
        text: zAnn.text || null,
        // We serialize the ENTIRE Zotero JSON for full fidelity.
        // When retrieving it, we'll extract it using the prefix.
        comment: ZOTERO_BLOB_PREFIX + JSON.stringify(zAnn),
        tags: Array.isArray(zAnn.tags) && zAnn.tags.length > 0
            ? zAnn.tags.map(t => (typeof t === 'string' ? t : t.name)).join(',')
            : null,
    };
}

/**
 * Standalone page wrapper for the `/vault/pdf?src=...` deep link. Used
 * when someone enters the reader from outside the VaultDashboard (direct link,
 * browser in a new tab, etc.). Inside the VaultDashboard,
 * ZoteroReaderTab renders as an integrated tab via
 * a captured `gnosi:open-pdf`.
 */
export function ZoteroReaderPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
    const rawSrc = params.get('src') || '';
    const kindParam = params.get('kind') || undefined;
    // Deep link: `?page=N` opens the document at that 1-based page.
    const pageParam = params.get('page');
    const locationParam = useMemo(
        () => (pageParam ? { pageNumber: String(pageParam) } : null),
        [pageParam]
    );
    return (
        <ZoteroReaderTab
            src={rawSrc}
            kind={kindParam}
            location={locationParam}
            onClose={() => navigate(-1)}
        />
    );
}

export default ZoteroReaderTab;
