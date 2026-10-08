function isNode(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Hide Markdown HTML comments without touching code examples or stored text. */
export function remarkHideComments() {
    return (tree: unknown): void => {
        const visit = (value: unknown): void => {
            if (!isNode(value) || !Array.isArray(value.children)) return;
            const children: unknown[] = value.children;
            value.children = children.filter(child => {
                if (!isNode(child)) return true;
                if (child.type === 'html' && typeof child.value === 'string') {
                    child.value = child.value.replace(/<!--[\s\S]*?-->/gu, '');
                    if (typeof child.value === 'string' && !child.value.trim()) return false;
                }
                visit(child);
                return true;
            });
        };
        visit(tree);
    };
}
