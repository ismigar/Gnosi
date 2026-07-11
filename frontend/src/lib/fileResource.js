/**
 * fileResource — shared utilities for values of `files`-type fields
 * (and for the Vault's file link interceptor).
 *
 * Centralizes HOW Gnosi opens a file so the behavior is identical
 * whether the user clicks a link inside a page (useFileLinkInterceptor)
 * or clicks the "Open" button on a file field (FileFieldValue):
 *   - PDF / EPUB / HTML  → integrated viewer (Zotero reader) via the
 *     `gnosi:open-pdf` event; outside the Vault, fallback to the `/vault/pdf` route.
 *   - Remote or served URL (/api/…) → new browser tab.
 *   - Local file of another type → OS default app
 *     (`/api/vault/open-local-path`), with clipboard copy if the backend
 *     can't open it (typical inside Docker without Finder access).
 */
import { toast } from './toast';

// Document types that the integrated viewer (Zotero reader) can display.
const DOCUMENT_KIND_BY_EXT = { pdf: 'pdf', epub: 'epub', html: 'snapshot', htm: 'snapshot' };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|flac|ogg|aac)(\?|#|$)/i;

const isRemoteOrServed = (src) => /^https?:\/\//i.test(src) || src.startsWith('/api/');

/** Returns the Zotero viewer `kind` for a given href, or null if not supported. */
export function documentKindForHref(href) {
    if (!href) return null;
    const clean = String(href).split('?')[0].split('#')[0].toLowerCase();
    const m = clean.match(/\.([a-z0-9]+)$/);
    if (!m) return null;
    return DOCUMENT_KIND_BY_EXT[m[1]] || null;
}

/** Rough classification to choose icon / thumbnail for the chip. */
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

/** Key (localStorage + cookie) where the active vault's id lives. */
export const ACTIVE_VAULT_KEY = 'gnosi_active_vault';

/**
 * Id of the active vault chosen by the user (multi-vault mode); null if none.
 * Single source of truth: localStorage `gnosi_active_vault` (the same one the axios
 * interceptor propagates as the `X-Vault-Id` header).
 */
export function getActiveVaultId() {
    try {
        return (typeof localStorage !== 'undefined' && localStorage.getItem(ACTIVE_VAULT_KEY)) || null;
    } catch {
        return null;
    }
}

/**
 * Writes (or deletes) the active vault as a same-origin COOKIE.
 *
 * Why this is needed IN ADDITION to the `X-Vault-Id` header: the header is only added
 * by the axios interceptor, so ALL requests that don't go through axios
 * are left without a vault signal and fall back to the default vault (Principal) on the
 * backend: raw `fetch()`, native media (`<img>/<video>/<audio>/<iframe>`),
 * CSS `background-image`, `EventSource`/SSE, `/api/chat`, and even the
 * WebSocket handshake. A same-origin cookie AUTOMATICALLY travels with every
 * request to the same origin → this closes off that whole class without touching every call
 * site. The middleware reads it as a LAST fallback (header > `?vault=` >
 * cookie), so an explicit `X-Vault-Id` (cloning Notion into a separate vault)
 * still takes precedence. `SameSite=Lax` and no `Secure` so it also works on
 * local HTTP; the app is same-origin (the Vite proxy serves `/api`).
 */
export function setActiveVaultCookie(id) {
    try {
        if (typeof document === 'undefined') return;
        if (id) {
            document.cookie = `${ACTIVE_VAULT_KEY}=${encodeURIComponent(id)}; path=/; SameSite=Lax; max-age=31536000`;
        } else {
            document.cookie = `${ACTIVE_VAULT_KEY}=; path=/; SameSite=Lax; max-age=0`;
        }
    } catch { /* document/cookie not available */ }
}

/**
 * Synchronizes the active vault cookie with the localStorage value (source of
 * truth). Must be called at STARTUP, before the first render, so that
 * native `<img>` elements in the first paint already carry the vault. It is also idempotent and
 * the axios interceptor can call it to keep the cookie fresh.
 */
export function syncActiveVaultCookie() {
    setActiveVaultCookie(getActiveVaultId());
}

/**
 * Adds the active vault as a query-param to a SERVED asset URL
 * (`/api/vault/…`).
 *
 * Why this is needed: native `<img>` requests (and `background-image`, etc.) do NOT
 * go through axios, so they do NOT carry the `X-Vault-Id` header. Without any
 * vault signal the backend falls back to the default vault (Principal) and
 * icons/images from a non-default vault (e.g. Notion) return 404 → broken
 * image. The `vault` param is the fallback the middleware reads when there is no
 * header. Idempotent; leaves remote/`data:`/non-served URLs untouched and,
 * if no vault is chosen, doesn't touch anything (single-vault backward compatibility).
 *
 * `explicitVid` forces a specific vault instead of the active vault from
 * localStorage. This is used by the public shared page (`/s/token`): the
 * anonymous visitor has no `gnosi_active_vault`, so the share's vault comes from the
 * backend and must be applied explicitly (and, if the visitor has THEIR OWN
 * active vault, it must not be used for the share's assets).
 */
export function withActiveVault(url, explicitVid) {
    if (typeof url !== 'string' || !url.startsWith('/api/vault/')) return url;
    if (/[?&]vault=/.test(url)) return url;
    const vid = explicitVid || getActiveVaultId();
    if (!vid) return url;
    return `${url}${url.includes('?') ? '&' : '?'}vault=${encodeURIComponent(vid)}`;
}

/**
 * Converts a stored value into a URL servable by the backend
 * (`/api/vault/assets/…`) if it is a path relative to the vault or is already served/remote.
 * Returns '' for absolute local paths or `file://` (which the browser cannot
 * load directly — these are opened via viewer/OS). Served URLs carry the
 * active vault ([[withActiveVault]]) so the native `<img>` resolves the correct
 * vault without a header.
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
    // Relative path inside the vault (e.g. "Articles/foo.pdf") → served from assets.
    // We exclude paths with `..`: the assets endpoint blocks path traversal and
    // a `../Recursos/x.pdf` would produce a malformed URL. These (often
    // legacy references) fall back to '' and are opened as a local file (or fail
    // honestly if they no longer exist) instead of navigating to a broken URL.
    if (!value.startsWith('/') && !value.includes('://') && !value.includes('..')) {
        return withActiveVault(`/api/vault/assets/${value.replace(/^\.\//, '')}`);
    }
    return '';
}

/** Servable image URL for the thumbnail, or '' if the value is not a servable image. */
export function toAssetPreviewUrl(value) {
    const v = String(value || '').trim().toLowerCase();
    const isImage = v.startsWith('data:image/') || IMAGE_EXT.test(v);
    if (!isImage) return '';
    return toServedAssetUrl(value);
}

/**
 * Heuristic: the NAME of a field suggests its value is an image (an
 * image path/URL), e.g. "Imatge", "Cover", "Foto", "Thumbnail".
 *
 * Shared between the table cell (`VaultTable`) and the properties panel
 * (`BlockEditor`) so detection is IDENTICAL in both places: a field of
 * type `text` named "Imatge" must behave the same way in the table and in the detail view.
 *
 * Excludes names that denote TEXT *about* the image (alt, footer, description,
 * legend, caption): e.g. "Imatge Alt Text" contains prose, not a path, and must
 * remain a text field. The final decision to show a thumbnail is made by
 * the caller, by checking that the VALUE resolves to a servable image
 * ([[toAssetPreviewUrl]]); this function only looks at the name.
 */
export function isImageFieldName(name) {
    const s = String(name || '');
    if (/\balt\b|\btext\b|\bcaption\b|\bpeu\b|\bllegenda\b|\bleyenda\b|descrip/i.test(s)) return false;
    return /(image|imatge|cover|thumbnail|thumb|foto|imagen)/i.test(s);
}

/**
 * COMPOSITE image field: the value can be a string (path, backward-compatible) or a
 * `{ src, alt, title, caption, credit }` map. These helpers normalize
 * reading so that all consumers work with both forms.
 */

/** Extracts the PATH/URL from an image field value (string | {src} | array). */
export function getImageSrc(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return getImageSrc(value[0]);
    if (typeof value === 'object') return String(value.src || value.url || value.path || '');
    return '';
}

/** Breaks down an image field value into `{ src, alt, title, caption, credit }`. */
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
 * Builds the value to be saved from `src` + extras (alt/title/caption/credit).
 * If there is no meaningful extra, returns a plain STRING (clean, backward-compatible
 * frontmatter); otherwise a composite map.
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
 * Inverse of `toServedAssetUrl` for vault assets: converts a served
 * `/api/vault/assets/<path>` URL back to the vault-relative path
 * (`<path>`) so it can be saved in the field. Any other URL (remote, data:) or an
 * already-relative path is kept as-is.
 */
export function servedUrlToVaultPath(url) {
    const v = String(url || '');
    const prefix = '/api/vault/assets/';
    // Strips the vault query-param (`?vault=…`, added by [[withActiveVault]] in
    // render time) so the SAVED value stays clean and vault-agnostic.
    return v.startsWith(prefix) ? v.slice(prefix.length).split('?')[0] : v;
}

/**
 * Parses legacy authors in PLAIN TEXT into {nom, cognom1, cognom2} objects.
 * Conventions: "Name Surname1 Surname2" (direct order) or "Surnames, Name"
 * (inverted). Multiple authors separated by ";" or "&" — never by a single comma
 * (the comma marks inverted order) nor by " y/i/and " (would break compound
 * surnames like "Ortega y Gasset").
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

// Formats an author {nom, cognom1, cognom2} according to the pattern token's accessor:
//   .cognom → "Surname1 Surname2"; .nom → "Name"; none/other → "Name Surname1 Surname2".
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
 * Interpolates a name pattern (e.g. "{Authors} - {Any} - {Títol}") with the row's
 * values. Empty/nonexistent fields are omitted and dangling separators are
 * cleaned up. Final name sanitization is done by the backend.
 */
export function interpolateNamePattern(pattern, meta = {}) {
    if (!pattern || typeof pattern !== 'string') return '';
    // Resolves a pattern field against the metadata. First an exact match;
    // otherwise case-insensitively (a `title` field is persisted with the
    // canonical lowercase `title` key even though the property is called
    // "Title", so `{Title}` must resolve the same way).
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
        // The NAME of a field can contain a period (e.g. "No. pages"): we try
        // first the WHOLE token as a field and ONLY if it doesn't exist do we interpret
        // what comes after the first period as an accessor (e.g. {Authors.cognom1}).
        // Previously `split('.')` always split on the dot, and a field with a dot in its name
        // was never resolved (it came out empty in the filename).
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
        // Authorship field: array of {nom, cognom1, cognom2} objects → formatted per accessor.
        if (Array.isArray(v) && v.some(a => a && typeof a === 'object' && ('cognom1' in a || 'cognom2' in a || 'nom' in a))) {
            return v.map(a => formatAuthorToken(a, (accessor || '').trim())).filter(Boolean).join(', ');
        }
        // Legacy authorship as a STRING ("Ismael García Fernández"): if the pattern
        // requests an author accessor ({Authors.cognom1}), parses the text into
        // instead of ignoring the accessor — before, this produced files with the
        // full name, diverging from the pattern and from already-existing files.
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

/** Clean filename derived from a target (path, file:// or URL). */
export function filenameFromTarget(target) {
    if (!target) return '';
    const noProto = String(target).replace(/^file:\/\//i, '');
    const clean = noProto.split('?')[0].split('#')[0];
    const base = clean.split('/').pop().split('\\').pop() || clean;
    try { return decodeURIComponent(base); } catch { return base; }
}

/**
 * Splits the value of a `files` field into individual entries.
 * Accepts an array (multi-file) or a single string; extracts the target from
 * markdown links `[name](target)`. We don't split on commas so as not to break paths
 * that contain them: the `files` field stores one path per value.
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
 * Canonical key for a `files` field entry, for DEDUPLICATION: the same
 * file expressed as a `file://` URL-encoded, absolute path (from either
 * of the two Macs), `~/<rel>`, or served URL (`/api/vault/biblioteca|raw|assets/`)
 * must produce the SAME key. Doesn't touch disk: only normalizes the text.
 * Genuinely different files (e.g. different names inside Biblioteca) produce
 * different keys.
 */
export function fileTargetKey(value) {
    let s = String(value || '').trim();
    if (!s) return '';
    const md = s.match(/\[[^\]]*\]\(([^)]+)\)/);
    if (md) s = md[1].trim();
    if (/^file:\/\//i.test(s)) {
        s = s.replace(/^file:\/\//i, '');
        try { s = decodeURIComponent(s); } catch { /* stays as-is */ }
    }
    s = s.split('?')[0].split('#')[0].replace(/\\/g, '/');
    const served = s.match(/^\/api\/vault\/(biblioteca|raw|assets)\/(.+)$/);
    if (served) {
        let rel = served[2];
        try { rel = decodeURIComponent(rel); } catch { /* stays as-is */ }
        const root = served[1] === 'raw' ? 'vault' : served[1];
        if (served[1] === 'assets') return `assets/${rel.toLowerCase()}`;
        return `${root}/${rel.toLowerCase()}`;
    }
    // Strip the concrete HOME: /Users/<user>/x and ~/x → /x (both Macs
    // share the same structure under the home).
    s = s.replace(/^~\//, '/').replace(/^\/Users\/[^/]+\//, '/');
    // Unifies any reference to Biblioteca with the served form.
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
 * Opens a file target using Gnosi's smart routing.
 *
 * @param {string} target  Absolute path, file://, or URL (http/https or /api/…).
 * @param {object} opts
 * @param {string} [opts.title]    Title for the viewer tab.
 * @param {function} [opts.navigate]  `useNavigate()` (fallback outside the Vault).
 * @param {function} [opts.t]      i18next's `t` (clipboard messages).
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

    // Local file of a type not supported by the viewer → OS app.
    const fileUrl = /^file:\/\//i.test(src) ? src : `file://${src}`;
    openViaSystem(fileUrl, t);
}
