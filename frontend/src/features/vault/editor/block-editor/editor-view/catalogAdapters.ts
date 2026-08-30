import type { buildColumnLayoutCatalog, buildTurnIntoCatalog } from '../../slashMenuUtils';
import type { GnosiEditor, PartialEditorBlock } from '../schema';

type ColumnAdapter = NonNullable<NonNullable<Parameters<typeof buildColumnLayoutCatalog>[0]>['editor']>;
type TurnAdapter = NonNullable<NonNullable<Parameters<typeof buildTurnIntoCatalog>[0]>['editor']>;

export function menuItemKey(item: object): unknown {
    return 'key' in item ? item.key : undefined;
}

function blockId(block: unknown): string {
    if (typeof block === 'string') return block;
    if (typeof block === 'object' && block !== null && 'id' in block && typeof block.id === 'string') return block.id;
    throw new TypeError('Slash menu block requires an id');
}

export function turnIntoUpdate(update: Parameters<TurnAdapter['updateBlock']>[1]): PartialEditorBlock {
    switch (update.type) {
        case 'paragraph': case 'bulletListItem': case 'numberedListItem': case 'checkListItem': case 'quote': case 'codeBlock':
            return { type: update.type, props: {} };
        case 'heading': {
            const level = update.props.level;
            if (level !== 1 && level !== 2 && level !== 3 && level !== 4 && level !== 5 && level !== 6) {
                throw new TypeError('Invalid heading level in slash catalog');
            }
            return { type: 'heading', props: { level, ...(update.props.isToggleable === true ? { isToggleable: true } : {}) } };
        }
        default:
            // The legacy catalog includes `toggle`, which is not registered in
            // the real schema. Keep its existing caught failure; do not silently
            // substitute a different serialized block type during extraction.
            throw new TypeError(`Unrecognized slash catalog block type: ${update.type}`);
    }
}

export function columnLayoutAdapter(editor: GnosiEditor): ColumnAdapter {
    return {
        getTextCursorPosition: () => editor.getTextCursorPosition(),
        insertBlocks(blocks, reference, placement) {
            const mutable: PartialEditorBlock[] = blocks.map(block => ({ type: block.type,
                children: block.children.map(column => ({ type: column.type,
                    children: column.children.map(child => ({ type: child.type })),
                })),
            }));
            editor.insertBlocks(mutable, blockId(reference), placement);
        },
    };
}

export function turnIntoAdapter(editor: GnosiEditor): TurnAdapter {
    return {
        getTextCursorPosition: () => editor.getTextCursorPosition(),
        focus() { editor.focus(); },
        setTextCursorPosition(block, placement) { editor.setTextCursorPosition(blockId(block), placement); },
        updateBlock(block, update) { editor.updateBlock(blockId(block), turnIntoUpdate(update)); },
    };
}
