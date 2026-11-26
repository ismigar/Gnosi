import type { StoredHomeBlock } from '../../shared/api/home-canvas';
import { OPTIONAL_BLOCKS } from './apps/catalog';

const CORE_BLOCKS = [
    { kind: 'board', titleKey: 'home_canvas.board', appKey: 'common.knowledge', plugins: [], route: '/vault' },
    { kind: 'agenda', titleKey: 'home_canvas.agenda', appKey: 'sidebar.nav_calendar', plugins: ['calendar'], route: '/calendar' },
    { kind: 'graph', titleKey: 'home_canvas.graph', appKey: 'sidebar.nav_graph', plugins: [], route: '/graph' },
    { kind: 'audio', titleKey: 'home_canvas.audio', appKey: 'sidebar.nav_reader', plugins: ['feeds-reader', 'ai-platform'], route: '/reader' },
] as const;

export const HOME_BLOCKS = [...CORE_BLOCKS, ...OPTIONAL_BLOCKS] as const;
export type BlockDefinition = (typeof HOME_BLOCKS)[number];
export type HomeBlockKind = BlockDefinition['kind'];
export type HomeBlock = StoredHomeBlock & { readonly kind: HomeBlockKind };
export interface HomeBlockProps {
    readonly block: HomeBlock;
    readonly editing: boolean;
    readonly onConfigure: (settings: Readonly<Record<string, string>>) => void;
}

export function makeBlock(kind: HomeBlockKind, id: string): HomeBlock {
    return { id, kind, width: kind === 'board' || kind === 'graph' ? 2 : 1, height: 1, settings: {} };
}

export const DEFAULT_BLOCKS = CORE_BLOCKS.map(({ kind }) => makeBlock(kind, 'initial-' + kind));

export function displayedBlocks(blocks: readonly StoredHomeBlock[], available: readonly BlockDefinition[]) {
    return blocks.flatMap(block => {
        const definition = available.find(item => item.kind === block.kind);
        return definition ? [{ definition, block: { ...block, kind: definition.kind } }] : [];
    });
}

export function canAddBlock(kind: HomeBlockKind, blocks: readonly StoredHomeBlock[]): boolean {
    return kind === 'board' || kind === 'graph' || !blocks.some(block => block.kind === kind);
}

export function moveBlock(blocks: readonly StoredHomeBlock[], id: string, targetId: string): readonly StoredHomeBlock[] {
    const from = blocks.findIndex(block => block.id === id);
    const to = blocks.findIndex(block => block.id === targetId);
    if (from < 0 || to < 0 || from === to) return blocks;
    const moved = [...blocks];
    moved.splice(to, 0, ...moved.splice(from, 1));
    return moved;
}
