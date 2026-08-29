import { vaultAppFromPath } from '../lib/vaultRouting';

export interface OutlineHeading {
    readonly id: string;
    readonly level: number;
    readonly text: string;
}

export interface OutlineNode extends OutlineHeading {
    readonly element: HTMLElement;
}

export interface OutlineSnapshot {
    readonly headings: OutlineHeading[];
    readonly nodes: OutlineNode[];
}

const ALLOWED_APPS = new Set(['knowledge', 'mail', 'reader']);

export function isOutlineRoute(path: string): boolean {
    return ALLOWED_APPS.has(vaultAppFromPath(path));
}

export function outlineHeadingId(text: string, index: number): string {
    const slug = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return `pout-${String(index)}-${slug}`;
}

export function hasScrollableAncestor(
    element: HTMLElement,
    container: HTMLElement,
): boolean {
    const stop = container.parentElement;
    let parent = element.parentElement;
    while (parent && parent !== stop) {
        const style = getComputedStyle(parent);
        const scrollsVertically = style.overflowY === 'auto'
            || style.overflowY === 'scroll';
        if (scrollsVertically && parent.scrollHeight > parent.clientHeight + 1) {
            return true;
        }
        parent = parent.parentElement;
    }
    return false;
}

export function outlineHeadingText(element: HTMLElement): string {
    const direct = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim();
    if (direct) return direct;

    const clone = element.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return '';
    clone.querySelectorAll('a, button').forEach((node) => {
        node.remove();
    });
    return clone.textContent.trim();
}

export function collectOutlineHeadings(container: HTMLElement): OutlineSnapshot {
    const headings: OutlineHeading[] = [];
    const nodes: OutlineNode[] = [];

    container.querySelectorAll<HTMLElement>('h1, h2, h3').forEach((element, index) => {
        if (element.closest('a, button')) return;
        if (element.offsetParent === null) return;
        if (!hasScrollableAncestor(element, container)) return;
        const text = outlineHeadingText(element);
        if (!text) return;
        const id = outlineHeadingId(text, index);
        const level = Number(element.tagName.slice(1));
        headings.push({ id, level, text });
        nodes.push({ element, id, level, text });
    });

    return { headings, nodes };
}
