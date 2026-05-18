/**
 * useFileLinkInterceptor
 *
 * Captura clicks a enllaços que apunten a fitxers locals i els redirigeix
 * al backend perquè els obri amb el shell del sistema (Finder/Explorer).
 *
 * Per què cal: els navegadors moderns bloquegen file:// quan es naveguen
 * des d'una pàgina http(s). A més, BlockNote/Tiptap (extension-link)
 * blanqueja l'href de qualsevol protocol no permès (file: no hi és), pel
 * que als blocs de l'editor el href intern és el sentinel
 *   https://gnosi-file-protocol.local/...
 * (que sí passa la validació). Aquí detectem ambdues formes (file:// i
 * sentinel, incloent el sentinel legacy `__gnosi_file_protocol__`), aturem
 * la propagació, i cridem el backend amb la ruta convertida a file:// real.
 *
 * Estratègia: Listener delegat a window i document (capture phase) per
 * agafar mousedown/mouseup/click/auxclick abans que cap altre handler.
 * Cal interceptar `mouseup` perquè ProseMirror (BlockNote/Tiptap) dispara
 * el handler del link Tiptap dins del `mouseup` (no del `click`) i fa
 * `window.open(href, target)` allà — abans que arribi l'event `click`. Si
 * només interceptem `click`, ja és tard.
 *
 * Versió anterior tenia una segona capa amb MutationObserver subtree-wide
 * sobre document.body per normalitzar cada <a> rellevant (target="_self",
 * remove rel) i posar-li listeners directes. Aquesta capa era redundant
 * (capture phase a window és sempre el PRIMER handler, immune a
 * stopPropagation de tercers) i tenia un cost catastròfic: en obrir una
 * pàgina amb molts blocs (60+) i enllaços file://, BlockNote/ProseMirror
 * emetien una allau de mutacions DOM al render inicial que saturaven el
 * thread principal — Chrome marcava la pestanya com a "no respon" abans
 * que el contingut fos visible. Eliminada.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '../lib/toast';
import { useTranslation } from 'react-i18next';
import { FILE_PROTOCOL_SENTINEL, sentinelToFileUrl } from '../components/Vault/markdown-mapper';

// Tipus de document que el visor integrat de Gnosi (Zotero reader)
// pot obrir. Retorna null si l'href no és un format suportat — en aquest
// cas, l'interceptor delega al shell del SO.
const DOCUMENT_KIND_BY_EXT = {
    pdf: 'pdf',
    epub: 'epub',
    html: 'snapshot',
    htm: 'snapshot',
};

const documentKindForHref = (href) => {
    if (!href) return null;
    const clean = href.split('?')[0].split('#')[0].toLowerCase();
    const m = clean.match(/\.([a-z0-9]+)$/);
    if (!m) return null;
    return DOCUMENT_KIND_BY_EXT[m[1]] || null;
};

// Interceptem TANT mouse* com pointer* events. Tiptap/ProseMirror pot
// disparar el handler del link (que crida `window.open(href, target)`)
// dins d'un `pointerdown`/`pointerup` en navegadors moderns: si només
// escoltéssim els mouse*, el pointer arribaria abans i obriria una
// pestanya nova al sentinel `gnosi-file-protocol.local` abans del nostre
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

export function useFileLinkInterceptor() {
    const { t } = useTranslation();
    const navigate = useNavigate();

    useEffect(() => {
        // Si el backend no pot obrir la ruta (típicament perquè corre dins
        // un contenidor Docker Linux i no té accés al Finder/Explorer del
        // host), copiem la ruta del fitxer al portapapers i avisem l'usuari
        // amb un toast accionable. L'usuari pot llavors fer Cmd+Shift+G al
        // Finder i enganxar.
        const fallbackToClipboard = async (href) => {
            // Converteix file:// → ruta de sistema neta per al portapapers
            let plain = href;
            if (/^file:\/\//i.test(href)) {
                try { plain = decodeURIComponent(href.slice(7)); }
                catch { plain = href.slice(7); }
            }
            try {
                await navigator.clipboard.writeText(plain);
                toast.success(
                    t('editor.local_open_clipboard', {
                        defaultValue: 'Ruta copiada: {{path}}\nObre Finder i fes Cmd+Maj+G per enganxar-la.',
                        path: plain,
                    }),
                    { duration: 6000 }
                );
            } catch {
                toast.error(`${plain}`, { duration: 8000 });
            }
        };

        const openViaBackend = async (href) => {
            try {
                const res = await fetch('/api/vault/open-local-path', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: href }),
                });
                if (res.ok) return;
                // Backend ha respost però no ha pogut obrir (404 si manca
                // l'endpoint, 500 si manca xdg-open/open al contenidor, etc.)
                await fallbackToClipboard(href);
            } catch (err) {
                console.error('[file-link] open-local-path error', err);
                await fallbackToClipboard(href);
            }
        };

        // Evita disparar la trucada més d'un cop pel mateix gest
        // (mousedown + mouseup + click es dispararien en cadena).
        let lastOpenedAt = 0;

        const findFileAnchor = (e) => {
            const a = e.target?.closest?.('a');
            if (!a) return null;
            const href = a.getAttribute('href') || '';
            if (!isLocalFileHref(href)) return null;
            return { a, href };
        };

        // CAPA 1: handlers a window i document en fase de captura
        const winHandler = (e) => {
            const found = findFileAnchor(e);
            if (!found) return;
            // Cmd/Ctrl-click manté el comportament natiu (per si l'usuari vol forçar)
            if (e.metaKey || e.ctrlKey) return;
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }
            // Només dispara l'obertura un cop per gest. Triem el `click`
            // com a moment definitiu (els mousedown/mouseup només bloquegen
            // la propagació perquè no l'agafi ProseMirror).
            const now = Date.now();
            if (e.type === 'click' || e.type === 'auxclick') {
                if (now - lastOpenedAt > 250) {
                    lastOpenedAt = now;
                    const backendPath = toBackendPath(found.href);
                    // PDFs, EPUBs i snapshots HTML s'obren al visor integrat
                    // (Zotero reader) en lloc de delegar al shell del SO.
                    // Estratègia:
                    //   1) emetem `gnosi:open-pdf` (nom retingut per compat)
                    //      amb `kind` al detail. VaultDashboard l'agafa i
                    //      afegeix una pestanya. El capturador crida
                    //      preventDefault per senyalitzar que l'ha gestionat.
                    //   2) si ningú no l'ha gestionat (fora del Vault),
                    //      fallback a `/vault/pdf?src=...&kind=...` (la ruta
                    //      acaba al ZoteroReaderPage que serveix qualsevol
                    //      tipus suportat).
                    const docKind = documentKindForHref(backendPath);
                    if (docKind) {
                        const filename = (() => {
                            try {
                                const path = decodeURIComponent(backendPath.replace(/^file:\/\//i, ''));
                                return path.split('/').pop() || 'document';
                            } catch {
                                return 'document';
                            }
                        })();
                        const evt = new CustomEvent('gnosi:open-pdf', {
                            detail: { src: backendPath, title: filename, kind: docKind },
                            cancelable: true,
                        });
                        const handled = !window.dispatchEvent(evt);
                        if (!handled) {
                            const qs = new URLSearchParams({ src: backendPath, kind: docKind });
                            navigate(`/vault/pdf?${qs.toString()}`);
                        }
                    } else {
                        openViaBackend(backendPath);
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
