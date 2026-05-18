import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../lib/toast';

const HOST_URL = '/zotero-reader/host.html';

const toFilesystemPath = (src) => {
    if (!src) return '';
    if (/^file:\/\//i.test(src)) {
        try { return decodeURIComponent(src.slice(7)); }
        catch { return src.slice(7); }
    }
    return src;
};

/**
 * Embed del visor Zotero (zotero/reader) dins una pestanya del Vault.
 *
 * Arquitectura:
 *   - L'iframe carrega `public/zotero-reader/host.html`, un thin shell que
 *     embeda el bundle web del reader (AGPL-3.0) i exposa un protocol
 *     postMessage minimal cap aquest component React.
 *   - El PDF es serveix via `/api/vault/local-file/{token}` (mateix endpoint
 *     que el visor pdf.js propi). Així reaprofitem el warmup d'OneDrive,
 *     materialització i caché del backend.
 *   - Les anotacions es persisteixen via `/api/vault/pdf-annotations` igual
 *     que abans, però el format ara és el natiu de Zotero (rects en
 *     coords PDF + pageIndex 0-based). Hi ha un adaptador transparent.
 *
 * Per què iframe i no muntatge directe del bundle:
 *   - El bundle del reader pesa ~3MB minified + 800KB de vendors. Posar-lo
 *     a la SPA de Gnosi penalitza l'arrencada per a tots els usuaris,
 *     fins i tot els que mai obren un PDF.
 *   - El bundle defineix globals (`window.createReader`, `window._reader`)
 *     i utilitza React i ReactDOM en mode global — col·lidiria amb el
 *     React 18 del Vault. Iframe els aïlla.
 */
/**
 * Tipus de document que el reader Zotero pot mostrar:
 *  - 'pdf'      : PDF (default)
 *  - 'epub'     : EPUB
 *  - 'snapshot' : pàgina HTML guardada localment (.html / .htm)
 *
 * El bundle web carregat porta els tres rendering paths integrats.
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

export function ZoteroReaderTab({ src, title: titleProp, onClose, embedded = false, kind: kindProp }) {
    const { t } = useTranslation();
    const iframeRef = useRef(null);
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
    // Tots aquests signals han de coincidir abans d'enviar UN únic
    // missatge `init`. El reader Zotero rebutja `createReader` cridada
    // dues vegades ("Reader is already initialized"), així que cal
    // garantir idempotència via initSentRef.
    const hostReadyRef = useRef(false);
    const initSentRef = useRef(false);
    // Anotacions vives durant la sessió. Les guardem com a ref (no state)
    // perquè ja no les renderitzem nosaltres — el reader Zotero ho fa
    // tot, nosaltres només persistim. ESLint no es queixa de variables
    // no llegides.
    const annotationsRef = useRef([]);
    // Mapeig zoteroId → dbId (numèric). Necessari perquè:
    //  - Quan rebem `delete-annotations` amb un id de Zotero (anotació
    //    creada en aquesta sessió), poguem trobar el dbId del POST recent.
    //  - Evitar duplicats: si el reader envia `save-annotations` amb la
    //    mateixa anotació (id Zotero) dues vegades, la segona ha de ser
    //    PATCH no POST.
    const zoteroToDbIdRef = useRef(new Map());

    // --- Registrar el PDF al backend per obtenir la URL servible ---
    useEffect(() => {
        let cancelled = false;
        setError(null); setPdfUrl(null);
        if (!rawSrc) {
            setError(t('pdf.no_src', { defaultValue: 'No hi ha cap PDF per mostrar' }));
            return undefined;
        }
        if (/^https?:\/\//i.test(rawSrc) || rawSrc.startsWith('/api/')) {
            setPdfUrl(rawSrc);
            return undefined;
        }
        const filePath = toFilesystemPath(rawSrc);
        (async () => {
            try {
                const res = await fetch('/api/vault/local-file/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_path: filePath }),
                });
                if (!res.ok) {
                    const detail = await res.text().catch(() => '');
                    if (!cancelled) setError(`No s'ha pogut obrir el PDF: ${detail || 'HTTP ' + res.status}`);
                    return;
                }
                const data = await res.json();
                if (!cancelled) setPdfUrl(data.url);
            } catch (err) {
                if (!cancelled) setError(`No s'ha pogut obrir el PDF: ${err?.message || err}`);
            }
        })();
        return () => { cancelled = true; };
    }, [rawSrc, t]);

    // --- Carregar anotacions existents al mount ---
    // Reset complet quan rawSrc canvia: si el mateix component es reutilitza
    // a la ruta `/vault/pdf?src=...` per a un document diferent, no ens
    // hem de quedar amb anotacions del document anterior. També tornem
    // `initSentRef` a false perquè s'enviï un init nou al iframe.
    useEffect(() => {
        annotationsRef.current = [];
        zoteroToDbIdRef.current = new Map();
        initSentRef.current = false;
        if (!rawSrc) return undefined;
        let cancelled = false;
        setAnnotationsLoaded(false);
        (async () => {
            try {
                const res = await fetch(`/api/vault/pdf-annotations?source_uri=${encodeURIComponent(rawSrc)}`);
                if (cancelled) return;
                if (res.ok) {
                    const data = await res.json();
                    if (!cancelled && Array.isArray(data)) {
                        const mapped = data.map(pdfAnnotationToZotero);
                        annotationsRef.current = mapped;
                        // Populem el mapeig: les anotacions persistides ja
                        // tenen el seu dbId implícit a l'id Zotero (`gnosi:N`).
                        for (const a of mapped) {
                            if (typeof a.id === 'string' && a.id.startsWith('gnosi:')) {
                                zoteroToDbIdRef.current.set(a.id, Number(a.id.slice(6)));
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn('zotero-reader: load annotations failed', err);
            } finally {
                if (!cancelled) setAnnotationsLoaded(true);
            }
        })();
        return () => { cancelled = true; };
    }, [rawSrc]);

    // --- Enviar init al iframe (UN ÚNIC cop) quan tot estigui llest ---
    // Tres signals han de coincidir: host-ready, pdfUrl carregat,
    // annotations carregades (GET resolt). initSentRef evita re-envios.
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
                annotations: annotationsRef.current,
                options: {
                    authorName: 'User',
                    readOnly: false,
                },
            },
        }, '*');
    }, [pdfUrl, annotationsLoaded, kind]);

    useEffect(() => {
        sendInitIfReady();
    }, [sendInitIfReady]);

    // --- Listener de postMessage del iframe ---
    // Guarda d'origen: el handler només ha d'acceptar missatges que venen
    // del NOSTRE iframe (mateixa origin que la finestra principal). Sense
    // això, qualsevol altre window/iframe del navegador podria emetre un
    // `save-annotations` i triggerar escriptures a la BD.
    useEffect(() => {
        const onMsg = (ev) => {
            // Origin del missatge ha de ser el mateix domain. El bundle
            // viu a /zotero-reader/host.html, mateixa origin que el
            // frontend principal.
            if (ev.origin !== window.location.origin) return;
            // I el window emissor ha de ser el nostre iframe. Així cap
            // altre frame del navegador (popup, devtools, extension) pot
            // suplantar missatges.
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

    // --- Persistència bidireccional ---
    // Zotero envia LLISTES d'anotacions a cada save (no diffs). Per a cada
    // anotació:
    //   - Si el seu id és `gnosi:N` o existeix al `zoteroToDbIdRef`,
    //     l'anotació ja viu a la BD → PATCH amb el dbId.
    //   - Altrament, és nova → POST. Després enviem `update-annotations`
    //     al iframe per substituir l'id de Zotero pel `gnosi:N`. Així
    //     els saves següents (en la mateixa sessió) la reconeixeran com
    //     a existent i no crearan duplicats; i un delete posterior amb
    //     l'id Zotero original també hi pot trobar el dbId al mapeig.
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
                    await fetch(`/api/vault/pdf-annotations/${dbId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            color: body.color,
                            text: body.text,
                            comment: body.comment,
                            rects: body.rects,
                        }),
                    });
                } else {
                    const res = await fetch('/api/vault/pdf-annotations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    if (res.ok) {
                        const created = await res.json();
                        const newId = `gnosi:${created.id}`;
                        zoteroToDbIdRef.current.set(ann.id, created.id);
                        // També guardem el `newId` al mapeig per si arriba
                        // un save posterior amb l'id ja convertit.
                        zoteroToDbIdRef.current.set(newId, created.id);
                        idUpdates.push({ oldId: ann.id, newId });
                    }
                }
            } catch (err) {
                console.warn('zotero-reader: persist save failed', err);
            }
        }
        // Si hem creat noves anotacions, notifiquem el iframe perquè
        // actualitzi els id en memòria. Així `delete-annotations` i futurs
        // `save-annotations` portaran ja l'id `gnosi:N`.
        if (idUpdates.length > 0) {
            const iframeWin = iframeRef.current?.contentWindow;
            iframeWin?.postMessage({
                target: 'zotero-reader',
                type: 'update-annotation-ids',
                idMap: idUpdates,
            }, '*');
        }
    }, [rawSrc]);

    const persistDeleteAnnotations = useCallback(async (ids) => {
        for (const id of ids) {
            if (typeof id !== 'string') continue;
            // Resolem el dbId: explícit (`gnosi:N`), del mapeig (anotació
            // creada en aquesta sessió i encara amb id Zotero), o saltem.
            let dbId = null;
            if (id.startsWith('gnosi:')) {
                dbId = Number(id.slice('gnosi:'.length));
            } else if (zoteroToDbIdRef.current.has(id)) {
                dbId = zoteroToDbIdRef.current.get(id);
            }
            if (dbId == null) continue;
            try {
                await fetch(`/api/vault/pdf-annotations/${dbId}`, { method: 'DELETE' });
                // Netejar el mapeig perquè no quedi `gnosi:N` apuntant a
                // un row inexistent si l'usuari recrea amb el mateix id
                // (improbable, però defensiu).
                zoteroToDbIdRef.current.delete(id);
                zoteroToDbIdRef.current.delete(`gnosi:${dbId}`);
            } catch (err) {
                console.warn('zotero-reader: delete failed', err);
            }
        }
    }, []);

    const openExternal = async () => {
        const filePath = toFilesystemPath(rawSrc);
        if (!filePath) return;
        try {
            const res = await fetch('/api/vault/open-local-path', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: `file://${filePath}` }),
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
        } catch (err) {
            toast.error(`No s'ha pogut obrir externament: ${err.message}`);
        }
    };

    const toolbar = (
        <div className="flex items-center gap-2 px-3 py-2 shrink-0"
             style={{ background: '#3c3f41', borderBottom: '1px solid #222' }}>
            {!embedded && onClose && (
                <button onClick={onClose}
                    title={t('pdf.back', { defaultValue: 'Enrere' })}
                    className="w-8 h-8 flex items-center justify-center rounded text-white/80 hover:bg-white/10">
                    <ArrowLeft size={16} />
                </button>
            )}
            <div className="text-white/90 text-[13px] font-medium truncate max-w-[60vw]" title={filename}>
                {filename}
            </div>
            {!readerReady && !error && (
                <span className="text-white/40 text-[11px] ml-2 italic">
                    {t('pdf.loading', { defaultValue: 'Carregant…' })}
                </span>
            )}
            <button onClick={openExternal}
                title={t('pdf.open_external', { defaultValue: "Obre amb l'app del sistema" })}
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
                    // Permisos necessaris perquè el reader treballi: clipboard
                    // (copy d'extractes), downloads (export PDF imprès),
                    // fullscreen (per al control fullscreen propi del reader).
                    allow="clipboard-write; clipboard-read; fullscreen"
                />
            )}
        </div>
    );
}

// =============================================================================
// Adaptadors d'anotació entre el format Zotero (que el reader fa servir) i
// el format que persistim a la BD (`pdf_annotations`).
//
// Format BD:    { id, source_uri, page, type, color, rects: [{x,y,w,h}],
//                 text, comment, tags, created_at, updated_at }
//                 - rects en coords NORMALITZADES 0-1 amb origen top-left
//                 - page 1-indexed
//
// Format Zotero: { id, type, color, sortIndex, pageLabel, dateCreated,
//                  dateModified, authorName, isAuthorNameAuthoritative,
//                  text, comment, tags,
//                  position: { pageIndex, rects: [[x1,y1,x2,y2], ...] } }
//                  - rects en coords PDF (origen bottom-left, en punts)
//                  - pageIndex 0-indexed
//
// La conversió de coordenades requereix conèixer les dimensions de la
// pàgina, que NO tenim quan només persistim a la BD. Solució: emmagatzemar
// el JSON Zotero sencer al camp `comment` (com a JSON serialitzat amb
// prefix __ZOTERO__), i mantenir `text`, `page`, `color`, `type` per a
// filtres ràpids. La conversió de coords es deixa al reader Zotero.
// =============================================================================

const ZOTERO_BLOB_PREFIX = '__ZOTERO_JSON__';

function pdfAnnotationToZotero(dbAnn) {
    // Si el comment porta el blob Zotero, l'aprofitem (ple de detalls que
    // no replicàvem a la BD).
    if (dbAnn.comment && dbAnn.comment.startsWith(ZOTERO_BLOB_PREFIX)) {
        try {
            const parsed = JSON.parse(dbAnn.comment.slice(ZOTERO_BLOB_PREFIX.length));
            return { ...parsed, id: `gnosi:${dbAnn.id}` };
        } catch { /* fall through to reconstruction */ }
    }
    // Reconstrucció lossy per a anotacions creades amb el visor pdf.js antic.
    // Coords normalitzades (origen TL) → coords Zotero (origen BL) requereix
    // dimensions reals de la pàgina que no tenim aquí. Sense això el reader
    // no podrà mostrar-les visualment, però sí surten al sidebar. Es millorarà
    // a la propera obertura quan l'usuari les desa de nou.
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
            rects: [], // pèrdua acceptable: Zotero les recalcularà al re-highlight
        },
    };
}

function zoteroToPdfAnnotation(zAnn, sourceUri) {
    return {
        source_uri: sourceUri,
        page: (zAnn.position?.pageIndex ?? 0) + 1,
        type: zAnn.type || 'highlight',
        color: zAnn.color || '#ffeb3b',
        // Rects buit perquè conservem-les dins el blob (vegeu comment).
        // La BD només les volia per al overlay del visor antic.
        rects: [],
        text: zAnn.text || null,
        // Serialitzem TOT el JSON Zotero per a fidelitat completa.
        // En recuperar-la, l'extraurem amb el prefix.
        comment: ZOTERO_BLOB_PREFIX + JSON.stringify(zAnn),
        tags: Array.isArray(zAnn.tags) && zAnn.tags.length > 0
            ? zAnn.tags.map(t => (typeof t === 'string' ? t : t.name)).join(',')
            : null,
    };
}

/**
 * Wrapper de pàgina autònoma per al deep-link `/vault/pdf?src=...`. S'usa
 * quan algú entra al reader des de fora del VaultDashboard (link directe,
 * navegador en una nova pestanya, etc.). Dins el VaultDashboard, el
 * ZoteroReaderTab es renderitza com a pestanya integrada via
 * `gnosi:open-pdf` capturat.
 */
export function ZoteroReaderPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
    const rawSrc = params.get('src') || '';
    const kindParam = params.get('kind') || undefined;
    return (
        <ZoteroReaderTab
            src={rawSrc}
            kind={kindParam}
            onClose={() => navigate(-1)}
            embedded={false}
        />
    );
}

export default ZoteroReaderTab;
