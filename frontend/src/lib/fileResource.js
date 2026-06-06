/**
 * fileResource — utilitats compartides per a valors de camps de tipus `files`
 * (i per a l'interceptor d'enllaços de fitxer del Vault).
 *
 * Centralitza COM Gnosi obre un fitxer perquè el comportament sigui idèntic
 * tant si l'usuari clica un enllaç dins d'una pàgina (useFileLinkInterceptor)
 * com si clica el botó "Obrir" d'un camp de fitxers (FileFieldValue):
 *   - PDF / EPUB / HTML  → visor integrat (Zotero reader) via event
 *     `gnosi:open-pdf`; fora del Vault, fallback a la ruta `/vault/pdf`.
 *   - URL remota o servida (/api/…) → pestanya nova del navegador.
 *   - Fitxer local d'un altre tipus → app per defecte del SO
 *     (`/api/vault/open-local-path`), amb còpia al portapapers si el backend
 *     no pot obrir-lo (típic dins Docker sense accés al Finder).
 */
import { toast } from './toast';

// Tipus de document que el visor integrat (Zotero reader) sap mostrar.
const DOCUMENT_KIND_BY_EXT = { pdf: 'pdf', epub: 'epub', html: 'snapshot', htm: 'snapshot' };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|flac|ogg|aac)(\?|#|$)/i;

const isRemoteOrServed = (src) => /^https?:\/\//i.test(src) || src.startsWith('/api/');

/** Retorna el `kind` del visor Zotero per a un href, o null si no és suportat. */
export function documentKindForHref(href) {
    if (!href) return null;
    const clean = String(href).split('?')[0].split('#')[0].toLowerCase();
    const m = clean.match(/\.([a-z0-9]+)$/);
    if (!m) return null;
    return DOCUMENT_KIND_BY_EXT[m[1]] || null;
}

/** Classificació grollera per triar icona / thumbnail al chip. */
export function fileKindFromValue(value) {
    const v = String(value || '').trim().toLowerCase();
    if (!v) return 'file';
    if (v.startsWith('data:image/') || IMAGE_EXT.test(v)) return 'image';
    if (documentKindForHref(v)) return 'document';
    if (VIDEO_EXT.test(v)) return 'video';
    if (AUDIO_EXT.test(v)) return 'audio';
    if (/^https?:\/\//i.test(v)) return 'url';
    return 'file';
}

/**
 * Converteix un valor emmagatzemat en una URL servible pel backend
 * (`/api/vault/assets/…`) si és un path relatiu al vault o ja és servit/remot.
 * Retorna '' per a paths locals absoluts o `file://` (que el navegador no pot
 * carregar directament — s'obren via visor/SO).
 */
export function toServedAssetUrl(rawValue) {
    if (!rawValue || typeof rawValue !== 'string') return '';
    const value = rawValue.trim();
    if (!value) return '';
    if (value.startsWith('/api/')) return value;
    if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
    if (value.startsWith('Assets/')) return `/api/vault/assets/${value.slice('Assets/'.length)}`;
    if (value.startsWith('../Assets/')) return `/api/vault/assets/${value.slice('../Assets/'.length)}`;
    if (value.startsWith('./Assets/')) return `/api/vault/assets/${value.slice('./Assets/'.length)}`;
    const assetsIdx = value.indexOf('/Assets/');
    if (assetsIdx >= 0) return `/api/vault/assets/${value.slice(assetsIdx + '/Assets/'.length)}`;
    // Path relatiu dins del vault (ex: "Articles/foo.pdf") → servit des d'assets.
    // Excloem rutes amb `..`: l'endpoint d'assets bloqueja el path-traversal i
    // un `../Recursos/x.pdf` produiria una URL malformada. Aquestes (sovint
    // referències legacy) cauen a '' i s'obren com a fitxer local (o fallen
    // honestament si ja no existeixen) en comptes de navegar a una URL trencada.
    if (!value.startsWith('/') && !value.includes('://') && !value.includes('..')) {
        return `/api/vault/assets/${value.replace(/^\.\//, '')}`;
    }
    return '';
}

/** URL d'imatge servible per a thumbnail, o '' si el valor no és una imatge servible. */
export function toAssetPreviewUrl(value) {
    const v = String(value || '').trim().toLowerCase();
    const isImage = v.startsWith('data:image/') || IMAGE_EXT.test(v);
    if (!isImage) return '';
    return toServedAssetUrl(value);
}

/**
 * Heurística: el NOM d'un camp suggereix que el seu valor és una imatge (una
 * ruta/URL d'imatge), p. ex. "Imatge", "Cover", "Foto", "Thumbnail".
 *
 * Compartida entre la cel·la de taula (`VaultTable`) i el panell de propietats
 * (`BlockEditor`) perquè la detecció sigui IDÈNTICA als dos llocs: un camp de
 * tipus `text` anomenat "Imatge" s'ha de comportar igual a la taula i al detall.
 *
 * Exclou noms que denoten TEXT *sobre* la imatge (alt, peu, descripció,
 * llegenda, caption): p. ex. "Imatge Alt Text" conté prosa, no una ruta, i ha
 * de seguir sent un camp de text. La decisió final de mostrar miniatura la pren
 * qui crida comprovant que el VALOR resol a una imatge servible
 * ([[toAssetPreviewUrl]]); aquesta funció només mira el nom.
 */
export function isImageFieldName(name) {
    const s = String(name || '');
    if (/\balt\b|\btext\b|\bcaption\b|\bpeu\b|\bllegenda\b|\bleyenda\b|descrip/i.test(s)) return false;
    return /(image|imatge|cover|thumbnail|thumb|foto|imagen)/i.test(s);
}

/**
 * Camp imatge COMPOST: el valor pot ser un string (ruta, retrocompatible) o un
 * mapa `{ src, alt, title, caption, credit }`. Aquests helpers normalitzen la
 * lectura perquè tots els consumidors funcionin amb totes dues formes.
 */

/** Extreu la RUTA/URL d'un valor de camp imatge (string | {src} | array). */
export function getImageSrc(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return getImageSrc(value[0]);
    if (typeof value === 'object') return String(value.src || value.url || value.path || '');
    return '';
}

/** Desglossa un valor de camp imatge a `{ src, alt, title, caption, credit }`. */
export function parseImageField(value) {
    const src = getImageSrc(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return {
            src,
            alt: String(value.alt || ''),
            title: String(value.title || ''),
            caption: String(value.caption || ''),
            credit: String(value.credit || ''),
        };
    }
    return { src, alt: '', title: '', caption: '', credit: '' };
}

/**
 * Construeix el valor a desar a partir de `src` + extres (alt/title/caption/credit).
 * Si no hi ha cap extra significatiu, retorna un STRING pla (frontmatter net i
 * retrocompatible); altrament un mapa compost.
 */
export function buildImageValue(src, extras = {}) {
    const out = { src: String(src || '').trim() };
    for (const k of ['alt', 'title', 'caption', 'credit']) {
        const v = extras[k];
        if (v != null && String(v).trim() !== '') out[k] = String(v).trim();
    }
    return Object.keys(out).length === 1 ? out.src : out;
}

/**
 * Inversa de `toServedAssetUrl` per a assets del vault: converteix una URL
 * servida `/api/vault/assets/<path>` de tornada a la ruta relativa del vault
 * (`<path>`) per desar-la al camp. Qualsevol altra URL (remota, data:) o ruta
 * ja relativa es manté tal qual.
 */
export function servedUrlToVaultPath(url) {
    const v = String(url || '');
    const prefix = '/api/vault/assets/';
    return v.startsWith(prefix) ? v.slice(prefix.length) : v;
}

// Formata un autor {nom, cognom1, cognom2} segons l'accessor del token del patró:
//   .cognom → "Cognom1 Cognom2"; .nom → "Nom"; cap/altre → "Nom Cognom1 Cognom2".
function formatAuthorToken(a, accessor) {
    if (!a || typeof a !== 'object') return '';
    const cognoms = [a.cognom1, a.cognom2].map(s => (s || '').trim()).filter(Boolean).join(' ');
    const nom = (a.nom || '').trim();
    if (accessor === 'cognom1') return (a.cognom1 || '').trim();
    if (accessor === 'cognom2') return (a.cognom2 || '').trim();
    if (accessor === 'cognom' || accessor === 'cognoms') return cognoms;
    if (accessor === 'nom') return nom;
    return [nom, cognoms].filter(Boolean).join(' ');
}

/**
 * Interpola un patró de nom (ex: "{Authors} - {Any} - {Títol}") amb els valors
 * de la fila. Els camps buits/inexistents s'ometen i es netegen els separadors
 * penjats. La sanitització final del nom la fa el backend.
 */
export function interpolateNamePattern(pattern, meta = {}) {
    if (!pattern || typeof pattern !== 'string') return '';
    // Resol un camp del patró contra la metadata. Primer coincidència exacta;
    // si no, sense distingir majúscules (un camp `title` es persisteix amb la
    // clau canònica `title` en minúscula tot i que la propietat es digui
    // "Title", així `{Title}` ha de resoldre igualment).
    const lookup = (field) => {
        const key = (field || '').trim();
        if (!key) return undefined;
        if (meta && Object.prototype.hasOwnProperty.call(meta, key)) return meta[key];
        const lower = key.toLowerCase();
        for (const k of Object.keys(meta || {})) {
            if (k.toLowerCase() === lower) return meta[k];
        }
        return undefined;
    };
    let out = pattern.replace(/\{([^{}]+)\}/g, (_, token) => {
        const [rawField, accessor] = token.trim().split('.');
        const v = lookup(rawField);
        if (v === undefined || v === null) return '';
        // Camp autoria: array d'objectes {nom, cognom1, cognom2} → format per accessor.
        if (Array.isArray(v) && v.some(a => a && typeof a === 'object' && ('cognom1' in a || 'cognom2' in a || 'nom' in a))) {
            return v.map(a => formatAuthorToken(a, (accessor || '').trim())).filter(Boolean).join(', ');
        }
        const s = Array.isArray(v) ? v.join(', ') : String(v);
        return s.trim();
    });
    out = out
        .replace(/\s{2,}/g, ' ')
        .replace(/\s*-\s*-\s*/g, ' - ')
        .replace(/^[\s\-–—_]+|[\s\-–—_]+$/g, '')
        .replace(/[<>:"/\\|?*]/g, '')
        .trim();
    return out;
}

/** Nom de fitxer net a partir d'un target (path, file:// o URL). */
export function filenameFromTarget(target) {
    if (!target) return '';
    const noProto = String(target).replace(/^file:\/\//i, '');
    const clean = noProto.split('?')[0].split('#')[0];
    const base = clean.split('/').pop().split('\\').pop() || clean;
    try { return decodeURIComponent(base); } catch { return base; }
}

/**
 * Divideix el valor d'un camp `files` en entrades individuals.
 * Accepta array (multi-fitxer) o string única; extreu el target d'enllaços
 * markdown `[nom](target)`. No partim per comes per no trencar paths que en
 * continguin: el camp `files` desa una ruta per valor.
 */
export function parseFileEntries(value) {
    if (value === undefined || value === null) return [];
    const list = Array.isArray(value) ? value : [value];
    const out = [];
    for (const raw of list) {
        const text = String(raw || '').trim();
        if (!text) continue;
        const md = text.match(/\[([^\]]*)\]\(([^)]+)\)/);
        if (md) {
            const target = md[2].trim();
            out.push({ target, label: md[1].trim() || filenameFromTarget(target) });
        } else {
            out.push({ target: text, label: filenameFromTarget(text) });
        }
    }
    return out;
}

async function copyPathToClipboard(target, t) {
    let plain = target;
    if (/^file:\/\//i.test(target)) {
        try { plain = decodeURIComponent(target.slice(7)); } catch { plain = target.slice(7); }
    }
    try {
        await navigator.clipboard.writeText(plain);
        toast.success(
            t('editor.local_open_clipboard', {
                defaultValue: 'Ruta copiada: {{path}}\nObre Finder i fes Cmd+Maj+G per enganxar-la.',
                path: plain,
            }),
            { duration: 6000 },
        );
    } catch {
        toast.error(`${plain}`, { duration: 8000 });
    }
}

async function openViaSystem(target, t) {
    try {
        const res = await fetch('/api/vault/open-local-path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: target }),
        });
        if (res.ok) return;
        await copyPathToClipboard(target, t);
    } catch (err) {
        console.error('[file-resource] open-local-path error', err);
        await copyPathToClipboard(target, t);
    }
}

/**
 * Obre un target de fitxer amb el routing intel·ligent de Gnosi.
 *
 * @param {string} target  Path absolut, file://, o URL (http/https o /api/…).
 * @param {object} opts
 * @param {string} [opts.title]    Títol per a la pestanya del visor.
 * @param {function} [opts.navigate]  `useNavigate()` (fallback fora del Vault).
 * @param {function} [opts.t]      `t` de i18next (missatges del portapapers).
 */
export function openFileResource(target, { title, navigate, t = (k, o) => (o?.defaultValue ?? k) } = {}) {
    if (!target) return;
    const src = String(target).trim();

    const docKind = documentKindForHref(src);
    if (docKind) {
        const evt = new CustomEvent('gnosi:open-pdf', {
            detail: { src, title: title || filenameFromTarget(src), kind: docKind },
            cancelable: true,
        });
        const handled = !window.dispatchEvent(evt);
        if (!handled) {
            const qs = new URLSearchParams({ src, kind: docKind }).toString();
            if (navigate) navigate(`/vault/pdf?${qs}`);
            else window.open(`/vault/pdf?${qs}`, '_blank', 'noopener');
        }
        return;
    }

    if (isRemoteOrServed(src)) {
        window.open(src, '_blank', 'noopener');
        return;
    }

    // Fitxer local d'un tipus no suportat pel visor → app del SO.
    const fileUrl = /^file:\/\//i.test(src) ? src : `file://${src}`;
    openViaSystem(fileUrl, t);
}
