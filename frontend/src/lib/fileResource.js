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

/** Clau (localStorage + cookie) on viu l'id del vault actiu. */
export const ACTIVE_VAULT_KEY = 'gnosi_active_vault';

/**
 * Id del vault actiu triat per l'usuari (mode multi-vault); null si cap.
 * Font única: localStorage `gnosi_active_vault` (el mateix que l'interceptor
 * d'axios propaga com a capçalera `X-Vault-Id`).
 */
export function getActiveVaultId() {
    try {
        return (typeof localStorage !== 'undefined' && localStorage.getItem(ACTIVE_VAULT_KEY)) || null;
    } catch {
        return null;
    }
}

/**
 * Escriu (o esborra) el vault actiu com a COOKIE same-origin.
 *
 * Per què cal a MÉS de la capçalera `X-Vault-Id`: la capçalera només l'afegeix
 * l'interceptor d'axios, així que TOTES les peticions que no passen per axios
 * queden sense senyal de vault i cauen al vault per defecte (Principal) al
 * backend: `fetch()` cru, mèdia natiu (`<img>/<video>/<audio>/<iframe>`),
 * `background-image` CSS, `EventSource`/SSE, `/api/chat` i fins i tot el
 * handshake del WebSocket. Una cookie same-origin viatja AUTOMÀTICAMENT a cada
 * petició al mateix origin → tanca tota aquesta classe sense tocar cada punt de
 * crida. El middleware la llegeix com a ÚLTIM fallback (capçalera > `?vault=` >
 * cookie), així un `X-Vault-Id` explícit (clonar Notion a un vault separat)
 * continua manant. `SameSite=Lax` i sense `Secure` perquè funcioni també en
 * HTTP local; l'app és same-origin (el proxy de Vite serveix `/api`).
 */
export function setActiveVaultCookie(id) {
    try {
        if (typeof document === 'undefined') return;
        if (id) {
            document.cookie = `${ACTIVE_VAULT_KEY}=${encodeURIComponent(id)}; path=/; SameSite=Lax; max-age=31536000`;
        } else {
            document.cookie = `${ACTIVE_VAULT_KEY}=; path=/; SameSite=Lax; max-age=0`;
        }
    } catch { /* document/cookie no disponible */ }
}

/**
 * Sincronitza la cookie del vault actiu amb el valor de localStorage (font de
 * veritat). Cal cridar-ho a l'ARRENCADA, abans del primer render, perquè els
 * `<img>` natius del primer pintat ja portin el vault. També és idempotent i
 * el pot cridar l'interceptor d'axios per mantenir la cookie fresca.
 */
export function syncActiveVaultCookie() {
    setActiveVaultCookie(getActiveVaultId());
}

/**
 * Afegeix el vault actiu com a query-param a una URL d'asset SERVIDA
 * (`/api/vault/…`).
 *
 * Per què cal: les peticions natives d'`<img>` (i `background-image`, etc.) NO
 * passen per axios, així que NO porten la capçalera `X-Vault-Id`. Sense cap
 * senyal de vault el backend cau al vault per defecte (Principal) i les
 * icones/imatges d'un vault no-default (p. ex. Notion) tornen 404 → imatge
 * trencada. El param `vault` és el fallback que el middleware llegeix quan no hi
 * ha capçalera. Idempotent; deixa intactes URLs remotes/`data:`/no-servides i,
 * si no hi ha cap vault triat, no toca res (compatibilitat enrere single-vault).
 *
 * `explicitVid` força un vault concret en comptes del vault actiu del
 * localStorage. Ho fa servir la pàgina compartida pública (`/s/token`): el
 * visitant anònim no té `gnosi_active_vault`, així que el vault del share ve del
 * backend i s'ha d'aplicar explícitament (i, si el visitant té el SEU propi
 * vault actiu, no s'ha d'usar el seu per als assets del share).
 */
export function withActiveVault(url, explicitVid) {
    if (typeof url !== 'string' || !url.startsWith('/api/vault/')) return url;
    if (/[?&]vault=/.test(url)) return url;
    const vid = explicitVid || getActiveVaultId();
    if (!vid) return url;
    return `${url}${url.includes('?') ? '&' : '?'}vault=${encodeURIComponent(vid)}`;
}

/**
 * Converteix un valor emmagatzemat en una URL servible pel backend
 * (`/api/vault/assets/…`) si és un path relatiu al vault o ja és servit/remot.
 * Retorna '' per a paths locals absoluts o `file://` (que el navegador no pot
 * carregar directament — s'obren via visor/SO). Les URLs servides porten el
 * vault actiu ([[withActiveVault]]) perquè l'`<img>` natiu resolgui el vault
 * correcte sense capçalera.
 */
export function toServedAssetUrl(rawValue) {
    if (!rawValue || typeof rawValue !== 'string') return '';
    const value = rawValue.trim();
    if (!value) return '';
    if (value.startsWith('/api/')) return withActiveVault(value);
    if (/^https?:\/\//i.test(value) || value.startsWith('data:')) return value;
    if (value.startsWith('Assets/')) return withActiveVault(`/api/vault/assets/${value.slice('Assets/'.length)}`);
    if (value.startsWith('../Assets/')) return withActiveVault(`/api/vault/assets/${value.slice('../Assets/'.length)}`);
    if (value.startsWith('./Assets/')) return withActiveVault(`/api/vault/assets/${value.slice('./Assets/'.length)}`);
    const assetsIdx = value.indexOf('/Assets/');
    if (assetsIdx >= 0) return withActiveVault(`/api/vault/assets/${value.slice(assetsIdx + '/Assets/'.length)}`);
    // Path relatiu dins del vault (ex: "Articles/foo.pdf") → servit des d'assets.
    // Excloem rutes amb `..`: l'endpoint d'assets bloqueja el path-traversal i
    // un `../Recursos/x.pdf` produiria una URL malformada. Aquestes (sovint
    // referències legacy) cauen a '' i s'obren com a fitxer local (o fallen
    // honestament si ja no existeixen) en comptes de navegar a una URL trencada.
    if (!value.startsWith('/') && !value.includes('://') && !value.includes('..')) {
        return withActiveVault(`/api/vault/assets/${value.replace(/^\.\//, '')}`);
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
    // Treu el query-param de vault (`?vault=…`, afegit per [[withActiveVault]] a
    // temps de render) perquè el valor DESAT quedi net i vault-agnòstic.
    return v.startsWith(prefix) ? v.slice(prefix.length).split('?')[0] : v;
}

/**
 * Parseja autors llegats en TEXT PLA a objectes {nom, cognom1, cognom2}.
 * Convencions: "Nom Cognom1 Cognom2" (ordre directe) o "Cognoms, Nom"
 * (invertit). Diversos autors separats per ";" o "&" — mai per coma sola
 * (la coma marca l'ordre invertit) ni per " y/i/and " (trencaria cognoms
 * compostos com "Ortega y Gasset").
 */
export function parseAuthorsString(text) {
    return String(text || '')
        .split(/\s*[;&]\s*/)
        .map(s => s.trim())
        .filter(Boolean)
        .map((chunk) => {
            const inverted = chunk.match(/^([^,]+),\s*(.+)$/);
            if (inverted) {
                const toks = inverted[1].trim().split(/\s+/);
                return { nom: inverted[2].trim(), cognom1: toks[0] || '', cognom2: toks.slice(1).join(' ') };
            }
            const toks = chunk.split(/\s+/);
            if (toks.length === 1) return { nom: '', cognom1: toks[0], cognom2: '' };
            if (toks.length === 2) return { nom: toks[0], cognom1: toks[1], cognom2: '' };
            return { nom: toks[0], cognom1: toks[1], cognom2: toks.slice(2).join(' ') };
        });
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
        // El NOM d'un camp pot contenir un punt (p. ex. "Núm. pàgines"): provem
        // primer el token SENCER com a camp i NOMÉS si no existeix interpretem el
        // que ve després del primer punt com a accessor (p. ex. {Authors.cognom1}).
        // Abans `split('.')` trencava sempre pel punt i un camp amb punt al nom
        // no es resolia mai (sortia buit al nom de fitxer).
        const trimmed = token.trim();
        let rawField = trimmed;
        let accessor = '';
        let v = lookup(rawField);
        if (v === undefined) {
            const dot = trimmed.indexOf('.');
            if (dot >= 0) {
                rawField = trimmed.slice(0, dot).trim();
                accessor = trimmed.slice(dot + 1).trim();
                v = lookup(rawField);
            }
        }
        if (v === undefined || v === null) return '';
        // Camp autoria: array d'objectes {nom, cognom1, cognom2} → format per accessor.
        if (Array.isArray(v) && v.some(a => a && typeof a === 'object' && ('cognom1' in a || 'cognom2' in a || 'nom' in a))) {
            return v.map(a => formatAuthorToken(a, (accessor || '').trim())).filter(Boolean).join(', ');
        }
        // Autoria llegada en STRING ("Ismael García Fernández"): si el patró
        // demana un accessor d'autor ({Authors.cognom1}), parseja el text en
        // lloc d'ignorar l'accessor — abans això produïa fitxers amb el nom
        // complet, divergint del patró i dels fitxers ja existents.
        const acc = (accessor || '').trim();
        if (acc && ['nom', 'cognom', 'cognoms', 'cognom1', 'cognom2'].includes(acc)) {
            const chunks = Array.isArray(v) ? v : [v];
            if (chunks.length && chunks.every(x => typeof x === 'string')) {
                const authors = chunks.flatMap(x => parseAuthorsString(x));
                if (authors.length) {
                    return authors.map(a => formatAuthorToken(a, acc)).filter(Boolean).join(', ');
                }
            }
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

/**
 * Clau canònica d'una entrada d'un camp `files` per a DEDUPLICACIÓ: el mateix
 * fitxer expressat com `file://` URL-encoded, ruta absoluta (de qualsevol de
 * les dues Macs), `~/<rel>` o URL servida (`/api/vault/biblioteca|raw|assets/`)
 * ha de donar la MATEIXA clau. No toca el disc: només normalitza el text.
 * Fitxers realment diferents (p. ex. noms distints dins Biblioteca) donen
 * claus distintes.
 */
export function fileTargetKey(value) {
    let s = String(value || '').trim();
    if (!s) return '';
    const md = s.match(/\[[^\]]*\]\(([^)]+)\)/);
    if (md) s = md[1].trim();
    if (/^file:\/\//i.test(s)) {
        s = s.replace(/^file:\/\//i, '');
        try { s = decodeURIComponent(s); } catch { /* es queda tal qual */ }
    }
    s = s.split('?')[0].split('#')[0].replace(/\\/g, '/');
    const served = s.match(/^\/api\/vault\/(biblioteca|raw|assets)\/(.+)$/);
    if (served) {
        let rel = served[2];
        try { rel = decodeURIComponent(rel); } catch { /* es queda tal qual */ }
        const root = served[1] === 'raw' ? 'vault' : served[1];
        if (served[1] === 'assets') return `assets/${rel.toLowerCase()}`;
        return `${root}/${rel.toLowerCase()}`;
    }
    // Treu el HOME concret: /Users/<usuari>/x i ~/x → /x (les dues Macs
    // comparteixen l'estructura sota el home).
    s = s.replace(/^~\//, '/').replace(/^\/Users\/[^/]+\//, '/');
    // Unifica qualsevol referència a Biblioteca amb la forma servida.
    const bib = s.match(/(?:^|\/)Biblioteca\/(.+)$/);
    if (bib) return `biblioteca/${bib[1].toLowerCase()}`;
    return s.toLowerCase();
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
