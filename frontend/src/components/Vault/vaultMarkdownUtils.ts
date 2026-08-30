import { defaultUrlTransform } from 'react-markdown';
import type { CSSProperties } from 'react';
import { withActiveVault } from '../../lib/fileResource';

interface RgbColor {
    readonly b: number;
    readonly g: number;
    readonly r: number;
}

type InlineStyle = Pick<CSSProperties, 'backgroundColor' | 'color'>;

/* -------------------------------------------------------------------------- */
/*  Wikilinks: sentinel + conversion to clickable markdown (shared Vault)      */
/* -------------------------------------------------------------------------- */
// Replaces `[[target]]`, `[[target|alias]]`, `[[target#section]]` and
// `[[target#section|alias]]` with a markdown link with a sentinel in the href.
// The `a` element renderer (in VaultMarkdown) recognizes the sentinel and
// renders a real `WikilinkInline` (the same component the editor uses),
// so that the rendered markdown has clickable wikilinks just like the page.
// Without this, ReactMarkdown leaves the brackets as plain text.
//
// The sentinel must NOT contain `__` (markdown-it interprets it as bold and breaks
// the URL inside `](...)`) and it must pass react-markdown's `urlTransform`:
// by default sanitizes unknown protocols to `""`, which left
// `<a href="">` → clicking opened a new tab at the origin. That's why we register
// `wikilinkUrlTransform`, which lets it pass through untouched.
export const WIKILINK_HREF_SENTINEL = 'gnosi-wikilink:';
// Sentinel for legacy colored text (`<span style="color/background-color">`):
// VaultMarkdown's `a` element render turns it back into a `<span>` with the color.
// Defined here so that `wikilinkUrlTransform` (below) lets it pass through intact.
export const STYLE_HREF_SENTINEL = 'gnosi-style:';

// Citation deep link (NotebookLM-style): `[p. N](gnosi-cite:?res=<id>&page=N)`
// stored in a Cervell note's body. Clicking it opens the source resource's PDF
// at that page. Persisted in the .md (unlike the wikilink/style sentinels, which
// are injected only at render time), so it must survive the URL transform.
export const CITE_HREF_SENTINEL = 'gnosi-cite:';
const WIKILINK_RE = /\[\[([^\][|#]+)(?:#([^\][|]+))?(?:\|([^\][]+))?\]\]/g;

export const convertWikilinksToMd = (md?: string | null): string | null | undefined => {
    if (!md || typeof md !== 'string') return md;
    return md.replace(WIKILINK_RE, (
        _match: string,
        target: string,
        section?: string,
        alias?: string,
    ) => {
        const fullTarget = (target || '').trim() + (section ? `#${section.trim()}` : '');
        const displayTitle = (alias || (section ? `${target}#${section}` : target) || '').trim();
        // We avoid `[`/`]` in the link text and `(` `)` in the href so it doesn't
        // break the link's markdown syntax.
        const safeTitle = displayTitle.replace(/[\][]/g, '');
        // `encodeURIComponent` does NOT encode `(` or `)`; parentheses that are not
        // balanced in the title broke the Markdown link (a `)` closes it too
        // early, and a `(` prevents it from being parsed). We encode them explicitly
        // to %28/%29 — WikilinkInline already decodes the href, so the target
        // resolves the same.
        const safeHref = encodeURIComponent(fullTarget)
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29');
        return `[${safeTitle}](${WIKILINK_HREF_SENTINEL}${safeHref})`;
    });
};

// react-markdown sanitizes by default any href with a protocol that isn't
// recognizes (including our `gnosi-wikilink:` / `gnosi-style:`) by substituting it
// `""`. This transform lets the sentinels pass through intact and delegates the rest
// to the default.
export const wikilinkUrlTransform = (url: string): string => (
    url.startsWith(WIKILINK_HREF_SENTINEL)
            || url.startsWith(STYLE_HREF_SENTINEL)
            || url.startsWith(CITE_HREF_SENTINEL)
        ? url
        : defaultUrlTransform(url)
);

/* -------------------------------------------------------------------------- */
/*  Inline HTML inherited from the serializer (text/background color, underline…)    */
/* -------------------------------------------------------------------------- */
// The Vault serializer (markdown-mapper) saves the text/background color INLINE
// as `<span style="color:…;background-color:…">…</span>`, underline as
// `<u>…</u>`, soft breaks as `<br>` and BLOCK color as `<div style>`.
// The editor (BlockNote / markdown-it) reinterprets it, but react-markdown WITHOUT
// rehype-raw escapes this HTML and used to show it RAW in the preview / feed / shared
// page. Here we convert it back into constructs that react-markdown DOES
// render: color spans into a link with a `gnosi-style:` sentinel (the render
// of the `a` element in VaultMarkdown turns it back into a `<span>` with the color), and the
// everything else to its markdown/text equivalent. (`STYLE_HREF_SENTINEL` is defined above,
// sits next to the wikilink sentinel, so `wikilinkUrlTransform` can let it pass.)

// We only accept "safe" colors (hex, rgb/rgba, or a simple CSS name). Anything
// else (`url(...)`, `expression(...)`, `javascript:…`) is discarded. Moreover,
// the final render applies a React style OBJECT, so there is no
// injection surface even if some odd value slipped through.
const SAFE_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|[a-z]+)$/i;

// Extracts the value of a color property from a `style` string. The boundary
// `(?:^|;)` keeps `color` from matching the tail of `background-color`.
function pickStyleColor(styleStr: string | undefined, prop: string): string | null {
    const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`, 'i');
    const m = re.exec(styleStr || '');
    if (!m) return null;
    const val = m[1]?.trim();
    if (!val) return null;
    return SAFE_COLOR_RE.test(val) ? val : null;
}

// Encodes the style payload so it can travel inside a markdown link's href without
// break it (no spaces or `(` `)`, which would close the link prematurely). Mirror
// interfering with convertWikilinksToMd's encoding.
function encodeStylePayload(color: string | null, bg: string | null): string {
    const parts: string[] = [];
    if (color) parts.push(`c=${color}`);
    if (bg) parts.push(`b=${bg}`);
    return encodeURIComponent(parts.join('&')).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

// Converts a CSS color (hex #rgb/#rrggbb[aa] or rgb()/rgba()) to {r,g,b}. The
// we don't know how to measure named colors → null (we leave the inherited text).
function parseCssColorToRgb(v: unknown): RgbColor | null {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m?.[1]) {
        const h = m[1];
        return {
            r: Number.parseInt(h.charAt(0).repeat(2), 16),
            g: Number.parseInt(h.charAt(1).repeat(2), 16),
            b: Number.parseInt(h.charAt(2).repeat(2), 16),
        };
    }
    m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
    if (m?.[1]) {
        const h = m[1];
        return {
            r: Number.parseInt(h.slice(0, 2), 16),
            g: Number.parseInt(h.slice(2, 4), 16),
            b: Number.parseInt(h.slice(4, 6), 16),
        };
    }
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
    if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
    return null;
}

// Readable text color over a given background: dark over a light background, light over
// a dark background (YIQ brightness). Highlights inherited from Notion are LIGHT tones
// designed for light mode; in DARK mode the theme's light text became illegible
// on top. We set the text based on the BACKGROUND (theme-independent), like Notion does.
function readableTextForBg(bg: unknown): string | null {
    const rgb = parseCssColorToRgb(bg);
    if (!rgb) return null;
    const yiq = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    return yiq >= 140 ? '#1f2933' : '#f2f2f2';
}

// Decodes the payload of a `gnosi-style:` href into a React style object.
// Revalidates each color (defense in depth: we don't trust that the href hasn't been
// manipulated).
export function decodeStylePayload(href: unknown): InlineStyle {
    if (typeof href !== 'string') return {};
    let raw = href.slice(STYLE_HREF_SENTINEL.length);
    try { raw = decodeURIComponent(raw); } catch { /* we leave it raw */ }
    const style: InlineStyle = {};
    for (const kv of raw.split('&')) {
        const [k, v] = kv.split('=');
        if (!v || !SAFE_COLOR_RE.test(v)) continue;
        if (k === 'c') style.color = v;
        else if (k === 'b') style.backgroundColor = v;
    }
    // With a background but no explicit text color, we force text that contrasts with
    // the background so it's readable in both light and DARK mode (otherwise, the highlight
    // light-colored from Notion + light text from the dark theme ended up invisible).
    if (style.backgroundColor && !style.color) {
        const fg = readableTextForBg(style.backgroundColor);
        if (fg) style.color = fg;
    }
    return style;
}

export const convertInlineHtmlToMd = (md?: string | null): string | null | undefined => {
    if (!md || typeof md !== 'string') return md;
    let out = md;
    // Soft breaks (`<br>` / `<br>\n`) → hard line break (two spaces + newline).
    out = out.replace(/<br\s*\/?>(?:\r?\n)?/gi, '  \n');
    // Color spans → link with a sentinel (preserves the color through the `a` render).
    out = out.replace(/<span\b[^>]*?\sstyle="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi, (
        _match: string,
        style: string,
        text: string,
    ) => {
        const color = pickStyleColor(style, 'color');
        const bg = pickStyleColor(style, 'background-color');
        if (!color && !bg) return text; // no recognized color → just the inner text
        // The `[` `]` in the text would break the link's syntax; we strip them (colored
        // text tends to be a short tag/word, not complex markdown).
        const safeText = text.replace(/[\][]/g, '');
        return `[${safeText}](${STYLE_HREF_SENTINEL}${encodeStylePayload(color, bg)})`;
    });
    // Underline and BLOCK color divs: no clean equivalent in the preview →
    // we keep the inner content and discard the wrapper.
    out = out.replace(/<\/?u>/gi, '');
    out = out.replace(/<div\b[^>]*\sstyle="[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, '$1');
    return out;
};

function addActiveVault(url: string, vaultOverride?: string | null): string {
    const result: unknown = withActiveVault(url, vaultOverride);
    return typeof result === 'string' ? result : url;
}

/* -------------------------------------------------------------------------- */
/*  Normalization of Vault asset URLs                                    */
/* -------------------------------------------------------------------------- */
export function normalizeAssetUrl(url: unknown, vaultOverride?: string | null): string {
    if (typeof url !== 'string') return '';
    const v = url.trim();
    if (!v) return '';
    // URLs served from the vault carry the active vault (withActiveVault) so that
    // the native `<img>` resolves the correct vault without an X-Vault-Id header;
    // remote ones are left untouched. `vaultOverride` forces a specific vault
    // (public shared page: the visitor has no persisted active vault).
    //
    // An "external" URL is recognized by its SCHEME (`xxx:` — http, https,
    // data, blob…) or for being protocol-relative (`//host/…`), NOT by the prefix
    // "http". `startsWith('http')` was misclassifying a local asset with
    // name that starts with "http" (`http-headers.png` → it was returned raw →
    // broken image) and was also sending `data:`/`blob:` (pasted images
    // inline) in the vault fallback, corrupting them.
    if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//')) return v;
    if (v.startsWith('/')) return addActiveVault(v, vaultOverride);
    if (v.startsWith('Assets/')) {
        return addActiveVault(`/api/vault/assets/${v.substring(7)}`, vaultOverride);
    }
    return addActiveVault(`/api/vault/assets/${v}`, vaultOverride);
}
