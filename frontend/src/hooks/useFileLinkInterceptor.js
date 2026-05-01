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
 * Estratègia (defensiva en profunditat):
 *   1) Listener delegat a window i document (capture phase) per agafar
 *      mousedown/mouseup/click/auxclick abans que cap altre handler.
 *      Cal interceptar `mouseup` perquè ProseMirror (BlockNote/Tiptap)
 *      dispara el handler del link Tiptap dins del `mouseup` (no del
 *      `click`) i fa `window.open(href, target)` allà — abans que arribi
 *      l'event `click`. Si només interceptem `click`, ja és tard.
 *   2) MutationObserver que normalitza cada <a> rellevant nou afegint
 *      listeners directes (resistent a stopPropagation tercer).
 */
import { useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { FILE_PROTOCOL_SENTINEL, sentinelToFileUrl } from '../components/Vault/markdown-mapper';

const NORMALIZED_ATTR = 'data-gnosi-file-link';
const POINTER_EVENTS = ['mousedown', 'mouseup', 'click', 'auxclick'];
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
                    openViaBackend(toBackendPath(found.href));
                }
            }
        };
        for (const evt of POINTER_EVENTS) {
            window.addEventListener(evt, winHandler, true);
            document.addEventListener(evt, winHandler, true);
        }

        // CAPA 2: MutationObserver normalitza cada <a> rellevant que apareix
        const normalizeAnchor = (a) => {
            if (!a || a.tagName !== 'A') return;
            if (a.getAttribute(NORMALIZED_ATTR) === '1') return;
            const href = a.getAttribute('href') || '';
            if (!isLocalFileHref(href)) return;
            a.setAttribute(NORMALIZED_ATTR, '1');
            a.setAttribute('target', '_self');
            a.removeAttribute('rel');
            const localHandler = (e) => {
                if (e.metaKey || e.ctrlKey) return;
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation();
                }
                if (e.type === 'click' || e.type === 'auxclick') {
                    const now = Date.now();
                    if (now - lastOpenedAt > 250) {
                        lastOpenedAt = now;
                        openViaBackend(toBackendPath(href));
                    }
                }
            };
            for (const evt of POINTER_EVENTS) {
                a.addEventListener(evt, localHandler);
            }
        };
        const scanRoot = (root) => {
            if (!root || !root.querySelectorAll) return;
            root.querySelectorAll(
                'a[href^="file:"], a[href^="FILE:"], a[href^="https://gnosi-file-protocol.local/"], a[href^="https://__gnosi_file_protocol__/"]'
            ).forEach(normalizeAnchor);
        };
        scanRoot(document.body);
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                m.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    if (node.tagName === 'A') normalizeAnchor(node);
                    scanRoot(node);
                });
                if (m.type === 'attributes' && m.target?.tagName === 'A') {
                    normalizeAnchor(m.target);
                }
            }
        });
        observer.observe(document.body, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['href'],
        });

        return () => {
            for (const evt of POINTER_EVENTS) {
                window.removeEventListener(evt, winHandler, true);
                document.removeEventListener(evt, winHandler, true);
            }
            observer.disconnect();
        };
    }, [t]);
}

export default useFileLinkInterceptor;
