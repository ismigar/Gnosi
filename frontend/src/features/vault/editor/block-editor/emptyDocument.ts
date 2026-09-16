import type { EditorBlock } from './schema';

/** Only an empty paragraph is the editor's initial placeholder. */
export function isEmptyDocument(document: readonly EditorBlock[]): boolean {
    if (document.length === 0) return true;
    if (document.length !== 1) return false;
    const block = document[0];
    return block?.type === 'paragraph'
        && block.content.length === 0
        && block.children.length === 0;
}
