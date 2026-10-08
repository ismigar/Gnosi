import i18n from '../i18n/i18n';
import { citationParamsFromHref } from '../resources/citationDeepLink';

export type PageTitleIndex = Readonly<Record<string, unknown>>;
function titleText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
        ? String(value) : '';
}
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const INTERNAL_PAGE = /(?:^|\/)(?:vault|@[^/]+\/knowledge)\/(?:page|dashboard)\/([^/?#]+)|(?:^|\/)api\/(?:vault|v1\/vaults\/[^/]+\/knowledge)\/pages\/([^/?#]+)/iu;

const untitled = (): string => i18n.t('editor.untitled', { defaultValue: 'Untitled' });
const decode = (value: string): string => {
    try { return decodeURIComponent(value); } catch { return value; }
};

/** Read an internal target while retaining its ID for navigation and storage. */
export function pageReferenceId(reference: string): string {
    const source = reference.trim();
    const citation = citationParamsFromHref(source);
    if (citation) return citation.get('res') || '';
    const raw = decode(source);
    const wiki = raw.match(/^!?\[\[([^\]]+)\]\]$/u);
    if (wiki?.[1]) {
        const parts = wiki[1].split('|');
        const id = parts.find(part => UUID_ONLY.test(part.trim()));
        return (id || parts[0] || '').split('#')[0]?.trim() || '';
    }
    const route = raw.match(INTERNAL_PAGE);
    return decode(route?.[1] || route?.[2] || raw.split('#')[0] || '').trim();
}

/** Resolve IDs embedded in derived titles as well as bare reference labels. */
export function readablePageTitle(value: string, index: PageTitleIndex = {}, fallback?: string): string {
    const title = value.trim();
    if (!title) return fallback ?? untitled();
    if (citationParamsFromHref(title) || INTERNAL_PAGE.test(title) || /^!?\[\[/u.test(title)) {
        return pageReferenceTitle(title, index, '', fallback);
    }
    return title.replace(UUID, id => {
        const resolved = titleText(index[id] || index[id.toLowerCase()]);
        // Do not follow circular or still-unresolved cached titles.
        return resolved && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(resolved)
            ? resolved : fallback ?? untitled();
    });
}

export function pageReferenceTitle(reference: string, index: PageTitleIndex = {}, hint: unknown = '', fallback?: string): string {
    const id = pageReferenceId(reference);
    const indexed = titleText(index[id] || index[id.toLowerCase()]);
    if (indexed && indexed !== reference) return readablePageTitle(indexed, index, fallback);
    const hintText = titleText(hint);
    if (hintText && hintText !== reference && !UUID_ONLY.test(hintText.trim())) return readablePageTitle(hintText, index, fallback);
    const wiki = reference.match(/^!?\[\[([^\]]+)\]\]$/u);
    if (wiki?.[1]) {
        const label = wiki[1].split('|').find(part => part.trim() && !UUID_ONLY.test(part.trim()));
        if (label) return readablePageTitle(label, index, fallback);
    }
    if (citationParamsFromHref(reference) || INTERNAL_PAGE.test(reference) || UUID_ONLY.test(id)) return fallback ?? untitled();
    return readablePageTitle(reference, index, fallback);
}

export function readablePageTitleIndex(index: PageTitleIndex): Record<string, string> {
    return Object.fromEntries(Object.entries(index).map(([id, title]) => [id, readablePageTitle(titleText(title), index)]));
}
