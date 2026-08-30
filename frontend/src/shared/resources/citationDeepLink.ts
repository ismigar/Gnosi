export const CITATION_PROTOCOL = 'gnosi-cite:';
export const CITATION_PROTOCOL_SENTINEL = 'https://gnosi-cite.local/';


export function protectCitationMarkdownLinks(markdown: string): string;
export function protectCitationMarkdownLinks(markdown: unknown): unknown;
export function protectCitationMarkdownLinks(markdown: unknown): unknown {
  if (typeof markdown !== 'string' || !markdown.includes(CITATION_PROTOCOL)) return markdown;
  return markdown.replace(
    /\]\((<?)gnosi-cite:/g,
    (_match, angleBracket: string) => `](${angleBracket}${CITATION_PROTOCOL_SENTINEL}`,
  );
}


export function citationSentinelToHref(href: string): string;
export function citationSentinelToHref(href: unknown): unknown;
export function citationSentinelToHref(href: unknown): unknown {
  if (typeof href !== 'string' || !href.startsWith(CITATION_PROTOCOL_SENTINEL)) return href;
  return CITATION_PROTOCOL + href.slice(CITATION_PROTOCOL_SENTINEL.length);
}


export function isCitationHref(href: unknown): href is string {
  return typeof href === 'string'
    && (href.startsWith(CITATION_PROTOCOL) || href.startsWith(CITATION_PROTOCOL_SENTINEL));
}


export function citationParamsFromHref(href: unknown): URLSearchParams | null {
  if (!isCitationHref(href)) return null;
  try {
    return new URL(citationSentinelToHref(href)).searchParams;
  } catch {
    return null;
  }
}
