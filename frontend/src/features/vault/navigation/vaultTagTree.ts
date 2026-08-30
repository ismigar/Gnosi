export interface TagNote {
    readonly id: string;
    readonly metadata?: Readonly<Record<string, unknown>> | null;
    readonly title?: string | null;
}


export interface TagTreeNode {
    readonly children: Map<string, TagTreeNode>;
    readonly fullPath: string;
    readonly name: string;
    readonly pages: Map<string, TagNote>;
}


function createTagTreeNode(name: string, fullPath: string): TagTreeNode {
    return {
        children: new Map<string, TagTreeNode>(),
        fullPath,
        name,
        pages: new Map<string, TagNote>(),
    };
}


export function noteTags(note: TagNote): string[] {
    const raw = note.metadata?.tags;
    if (raw == null || raw === '') return [];
    const values: readonly (string | number | boolean)[] = Array.isArray(raw)
        ? raw.filter((value): value is string | number | boolean => (
            typeof value === 'string'
            || typeof value === 'number'
            || typeof value === 'boolean'
        ))
        : typeof raw === 'string'
            ? raw.split(',')
            : typeof raw === 'number' || typeof raw === 'boolean'
                ? [raw]
                : [];
    return values
        .map((tag) => String(tag).replace(/^#/, '').trim())
        .filter(Boolean);
}


export function buildTagTree(notes: readonly TagNote[]): TagTreeNode {
    const root = createTagTreeNode('', '');
    for (const note of notes) {
        for (const tag of noteTags(note)) {
            const parts = tag.split('/').map((part) => part.trim()).filter(Boolean);
            let node = root;
            let path = '';
            for (const part of parts) {
                path = path ? `${path}/${part}` : part;
                let child = node.children.get(part);
                if (!child) {
                    child = createTagTreeNode(part, path);
                    node.children.set(part, child);
                }
                node = child;
                node.pages.set(note.id, note);
            }
        }
    }
    return root;
}


export function tagNoteIcon(note: TagNote): string | undefined {
    const icon = note.metadata?.icon;
    return typeof icon === 'string' && icon ? icon : undefined;
}
