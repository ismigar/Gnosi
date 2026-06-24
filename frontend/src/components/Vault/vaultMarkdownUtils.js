import { defaultUrlTransform } from 'react-markdown';

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
// reconeix (el nostre `gnosi-wikilink:` inclòs) substituint-lo per `""`. Aquest
// transform deixa passar el sentinel intacte i delega la resta al defecte.
export const wikilinkUrlTransform = (url) => (
    typeof url === 'string' && url.startsWith(WIKILINK_HREF_SENTINEL)
        ? url
        : defaultUrlTransform(url)
);

/* -------------------------------------------------------------------------- */
/*  Normalització d'URLs d'assets del Vault                                    */
/* -------------------------------------------------------------------------- */
export function normalizeAssetUrl(url) {
    if (typeof url !== 'string') return '';
    const v = url.trim();
    if (!v) return '';
    if (v.startsWith('http') || v.startsWith('/')) return v;
    if (v.startsWith('Assets/')) return `/api/vault/assets/${v.substring(7)}`;
    return `/api/vault/assets/${v}`;
}
