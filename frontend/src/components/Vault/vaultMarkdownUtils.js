import { defaultUrlTransform } from 'react-markdown';
import { withActiveVault } from '../../lib/fileResource';

/* -------------------------------------------------------------------------- */
/*  Wikilinks: sentinel + conversió a markdown clicable (compartit Vault)      */
/* -------------------------------------------------------------------------- */
// Substitueix `[[target]]`, `[[target|alias]]`, `[[target#section]]` i
// `[[target#section|alias]]` per un link markdown amb un sentinel a l'href.
// El renderer de l'element `a` (a VaultMarkdown) reconeix el sentinel i
// renderitza un `WikilinkInline` real (mateix component que fa servir l'editor),
// de manera que el markdown renderitzat té wikilinks clicables com a la pàgina.
// Sense això el ReactMarkdown deixa els claudàtors com a text pla.
//
// El sentinel NO pot dur `__` (markdown-it ho interpreta com a bold i trenca
// la URL dins `](...)`) i ha de passar el `urlTransform` de react-markdown:
// per defecte sanititza protocols desconeguts a `""`, cosa que deixava
// `<a href="">` → clic obria una pestanya nova a l'origin. Per això registrem
// `wikilinkUrlTransform`, que el deixa passar intacte.
export const WIKILINK_HREF_SENTINEL = 'gnosi-wikilink:';
// Sentinel per a text acolorit heretat (`<span style="color/background-color">`):
// el render de l'element `a` de VaultMarkdown el torna a un `<span>` amb el color.
// Definit aquí perquè `wikilinkUrlTransform` (a sota) el deixi passar intacte.
export const STYLE_HREF_SENTINEL = 'gnosi-style:';
const WIKILINK_RE = /\[\[([^\][|#]+)(?:#([^\][|]+))?(?:\|([^\][]+))?\]\]/g;

export const convertWikilinksToMd = (md) => {
    if (!md || typeof md !== 'string') return md;
    return md.replace(WIKILINK_RE, (_, target, section, alias) => {
        const fullTarget = (target || '').trim() + (section ? `#${section.trim()}` : '');
        const displayTitle = (alias || (section ? `${target}#${section}` : target) || '').trim();
        // Evitem `[`/`]` al text del link i `(` `)` a l'href perquè no
        // trenquin la sintaxi markdown del link.
        const safeTitle = displayTitle.replace(/[\][]/g, '');
        // `encodeURIComponent` NO codifica `(` ni `)`; uns parèntesis SENSE
        // balancejar al títol trencaven el link Markdown (un `)` el tanca abans
        // d'hora i un `(` impedeix que es parsegi). Els codifiquem explícitament
        // a %28/%29 — WikilinkInline ja decodifica l'href, així que la diana es
        // resol igual.
        const safeHref = encodeURIComponent(fullTarget)
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29');
        return `[${safeTitle}](${WIKILINK_HREF_SENTINEL}${safeHref})`;
    });
};

// react-markdown sanititza per defecte qualsevol href amb un protocol que no
// reconeix (els nostres `gnosi-wikilink:` / `gnosi-style:` inclosos) substituint-lo
// per `""`. Aquest transform deixa passar els sentinels intactes i delega la resta
// al defecte.
export const wikilinkUrlTransform = (url) => (
    typeof url === 'string'
        && (url.startsWith(WIKILINK_HREF_SENTINEL) || url.startsWith(STYLE_HREF_SENTINEL))
        ? url
        : defaultUrlTransform(url)
);

/* -------------------------------------------------------------------------- */
/*  HTML inline heretat del serialitzador (color de text/fons, subratllat…)    */
/* -------------------------------------------------------------------------- */
// El serialitzador del Vault (markdown-mapper) desa el color de text/fons INLINE
// com a `<span style="color:…;background-color:…">…</span>`, el subratllat com a
// `<u>…</u>`, els salts tous com a `<br>` i el color de BLOC com a `<div style>`.
// L'editor (BlockNote / markdown-it) ho reinterpreta, però react-markdown SENSE
// rehype-raw escapa aquest HTML i el mostrava CRU al preview / feed / pàgina
// compartida. Aquí el reconvertim a construccions que react-markdown SÍ que
// renderitza: els spans de color a un link amb sentinel `gnosi-style:` (el render
// de l'element `a` a VaultMarkdown el torna a un `<span>` amb el color), i la
// resta al seu equivalent markdown/text. (`STYLE_HREF_SENTINEL` es defineix a dalt,
// vora el sentinel de wikilink, perquè `wikilinkUrlTransform` el pugui deixar passar.)

// Només acceptem colors "segurs" (hex, rgb/rgba o un nom CSS simple). Qualsevol
// altra cosa (`url(...)`, `expression(...)`, `javascript:…`) es descarta. A més,
// el render final aplica un OBJECTE d'estil de React, de manera que no hi ha
// superfície d'injecció encara que un valor rar s'esmunyís.
const SAFE_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|[a-z]+)$/i;

// Extreu el valor d'una propietat de color d'una cadena `style`. El límit
// `(?:^|;)` evita que `color` casi amb la cua de `background-color`.
function pickStyleColor(styleStr, prop) {
    const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`, 'i');
    const m = re.exec(styleStr || '');
    if (!m) return null;
    const val = m[1].trim();
    return SAFE_COLOR_RE.test(val) ? val : null;
}

// Codifica el payload d'estil perquè viatgi dins l'href d'un link markdown sense
// trencar-lo (ni espais ni `(` `)`, que tancarien el link abans d'hora). Mirall
// de la codificació de convertWikilinksToMd.
function encodeStylePayload(color, bg) {
    const parts = [];
    if (color) parts.push(`c=${color}`);
    if (bg) parts.push(`b=${bg}`);
    return encodeURIComponent(parts.join('&')).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

// Converteix un color CSS (hex #rgb/#rrggbb[aa] o rgb()/rgba()) a {r,g,b}. Els
// colors amb nom no els sabem mesurar → null (deixem el text heretat).
function parseCssColorToRgb(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    let m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) { const h = m[1]; return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) }; }
    m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
    if (m) { const h = m[1]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; }
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
    if (m) return { r: +m[1], g: +m[2], b: +m[3] };
    return null;
}

// Color de text llegible sobre un fons donat: fosc sobre fons clar, clar sobre
// fons fosc (brillantor YIQ). Els ressaltats heretats de Notion són tons CLARS
// pensats per a mode clar; en mode FOSC el text clar del tema quedava il·legible
// a sobre. Fixem el text segons el FONS (independent del tema), com fa Notion.
function readableTextForBg(bg) {
    const rgb = parseCssColorToRgb(bg);
    if (!rgb) return null;
    const yiq = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
    return yiq >= 140 ? '#1f2933' : '#f2f2f2';
}

// Descodifica el payload d'un href `gnosi-style:` a un objecte d'estil de React.
// Revalida cada color (defensa en profunditat: no confiem que l'href no s'hagi
// manipulat).
export function decodeStylePayload(href) {
    if (typeof href !== 'string') return {};
    let raw = href.slice(STYLE_HREF_SENTINEL.length);
    try { raw = decodeURIComponent(raw); } catch { /* deixem el cru */ }
    const style = {};
    for (const kv of raw.split('&')) {
        const [k, v] = kv.split('=');
        if (!v || !SAFE_COLOR_RE.test(v)) continue;
        if (k === 'c') style.color = v;
        else if (k === 'b') style.backgroundColor = v;
    }
    // Amb fons però sense color de text explícit, forcem un text que contrasti amb
    // el fons perquè sigui llegible tant en mode clar com FOSC (si no, el ressaltat
    // clar de Notion + text clar del tema fosc quedava invisible).
    if (style.backgroundColor && !style.color) {
        const fg = readableTextForBg(style.backgroundColor);
        if (fg) style.color = fg;
    }
    return style;
}

export const convertInlineHtmlToMd = (md) => {
    if (!md || typeof md !== 'string') return md;
    let out = md;
    // Salts tous (`<br>` / `<br>\n`) → salt de línia dur (dos espais + newline).
    out = out.replace(/<br\s*\/?>(?:\r?\n)?/gi, '  \n');
    // Spans de color → link amb sentinel (preserva el color a través del render de `a`).
    out = out.replace(/<span\b[^>]*?\sstyle="([^"]*)"[^>]*>([\s\S]*?)<\/span>/gi, (_m, style, text) => {
        const color = pickStyleColor(style, 'color');
        const bg = pickStyleColor(style, 'background-color');
        if (!color && !bg) return text; // cap color reconegut → només el text interior
        // Els `[` `]` del text trencarien la sintaxi del link; els traiem (el text
        // acolorit sol ser una etiqueta/paraula curta, no markdown complex).
        const safeText = text.replace(/[\][]/g, '');
        return `[${safeText}](${STYLE_HREF_SENTINEL}${encodeStylePayload(color, bg)})`;
    });
    // Subratllat i divs de color de BLOC: sense equivalent net al preview →
    // conservem el contingut interior i descartem l'embolcall.
    out = out.replace(/<\/?u>/gi, '');
    out = out.replace(/<div\b[^>]*\sstyle="[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, '$1');
    return out;
};

/* -------------------------------------------------------------------------- */
/*  Normalització d'URLs d'assets del Vault                                    */
/* -------------------------------------------------------------------------- */
export function normalizeAssetUrl(url, vaultOverride) {
    if (typeof url !== 'string') return '';
    const v = url.trim();
    if (!v) return '';
    // Les URLs servides del vault porten el vault actiu (withActiveVault) perquè
    // l'`<img>` natiu resolgui el vault correcte sense capçalera X-Vault-Id;
    // les remotes es deixen intactes. `vaultOverride` força un vault concret
    // (pàgina compartida pública: el visitant no té el vault a localStorage).
    //
    // Una URL «externa» es reconeix pel seu ESQUEMA (`xxx:` — http, https,
    // data, blob…) o per ser protocol-relative (`//host/…`), NO pel prefix
    // "http". `startsWith('http')` classificava malament un asset local amb
    // nom que comença per "http" (`http-headers.png` → es retornava cru →
    // imatge trencada) i alhora enviava els `data:`/`blob:` (imatges enganxades
    // inline) al fallback del vault, corrompent-los.
    if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//')) return v;
    if (v.startsWith('/')) return withActiveVault(v, vaultOverride);
    if (v.startsWith('Assets/')) return withActiveVault(`/api/vault/assets/${v.substring(7)}`, vaultOverride);
    return withActiveVault(`/api/vault/assets/${v}`, vaultOverride);
}
