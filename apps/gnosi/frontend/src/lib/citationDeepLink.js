export const CITATION_PROTOCOL = 'gnosi-cite:';
export const CITATION_PROTOCOL_SENTINEL = 'https://gnosi-cite.local/';

export function protectCitationMarkdownLinks(markdown) {
    if (typeof markdown !== 'string' || !markdown.includes(CITATION_PROTOCOL)) return markdown;
    return markdown.replace(
        /\]\((<?)gnosi-cite:/g,
        (_match, angleBracket) => `](${angleBracket}${CITATION_PROTOCOL_SENTINEL}`,
    );
}

export function citationSentinelToHref(href) {
    if (typeof href !== 'string') return href;
    if (!href.startsWith(CITATION_PROTOCOL_SENTINEL)) return href;
    return CITATION_PROTOCOL + href.slice(CITATION_PROTOCOL_SENTINEL.length);
}

export function isCitationHref(href) {
    return typeof href === 'string'
        && (href.startsWith(CITATION_PROTOCOL) || href.startsWith(CITATION_PROTOCOL_SENTINEL));
}

export function citationParamsFromHref(href) {
    if (!isCitationHref(href)) return null;
    try {
        return new URL(citationSentinelToHref(href)).searchParams;
    } catch {
        return null;
    }
}
