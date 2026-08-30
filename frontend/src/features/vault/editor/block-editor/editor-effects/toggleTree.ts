import type { EditorBlock, GnosiEditor } from '../schema';

export function containsBlockId(block: EditorBlock, id: string): boolean {
    return block.id === id || block.children.some((child) => containsBlockId(child, id));
}

export function findSiblings(id: string, blocks: EditorBlock[]): EditorBlock[] | null {
    if (blocks.some((block) => block.id === id)) return blocks;
    for (const block of blocks) {
        const found = block.children.length ? findSiblings(id, block.children) : null;
        if (found) return found;
    }
    return null;
}

function legacyLevel(value: unknown): number { return Number(value) || 1; }

function headingLevel(block: EditorBlock): number | null {
    return block.type === 'heading' ? legacyLevel(block.props.level) : null;
}

/** A single heading moves its following section through the next peer heading. */
export function withHeadingSection(blocks: EditorBlock[], document: EditorBlock[]): EditorBlock[] {
    if (blocks.length !== 1) return blocks;
    const [heading] = blocks;
    if (!heading) return blocks;
    const level = headingLevel(heading);
    if (level === null) return blocks;
    const siblings = findSiblings(heading.id, document);
    const start = siblings?.indexOf(heading) ?? -1;
    if (!siblings || start < 0) return blocks;
    const section = [heading];
    for (const next of siblings.slice(start + 1)) {
        const nextLevel = headingLevel(next);
        if (nextLevel !== null && nextLevel <= level) break;
        section.push(next);
    }
    return section;
}

export type ToggleEditor = Pick<GnosiEditor, 'document' | 'getBlock' | 'transact' | 'removeBlocks' | 'insertBlocks' | 'updateBlock'>;

export function nestIntoToggle(editor: ToggleEditor, targetId: string, draggedIds: string[]): boolean {
    const dragged = withHeadingSection(draggedIds.map((id) => editor.getBlock(id)).filter((block) => block !== undefined), editor.document);
    if (!dragged.length || dragged.some((block) => containsBlockId(block, targetId))) return false;
    const target = editor.getBlock(targetId);
    if (!target) return false;
    // Keep removal and reinsertion in one transaction/undo step with stable ids.
    editor.transact(() => {
        editor.removeBlocks(dragged.map((block) => block.id));
        const firstChild = target.children[0];
        if (firstChild) editor.insertBlocks(dragged, firstChild.id, 'before');
        else editor.updateBlock(targetId, { children: dragged });
    });
    return true;
}
