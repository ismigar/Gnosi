import { useTogglePersistence } from './useTogglePersistence';
import { useAreaHeadings } from './useAreaHeadings';
import { useCiteShortcut } from './useCiteShortcut';
import { useEditorDrop } from './useEditorDrop';
import { useEditorEmbedNavigation } from './useEmbedNavigation';
import type { EditorEffectsInputs } from './types';

/** Replaces the contiguous effects/navigation range preceding headingCacheRef. */
export function useEditorEffects(inputs: EditorEffectsInputs) {
    useTogglePersistence(inputs);
    const isAreaPage = useAreaHeadings(inputs);
    useCiteShortcut(inputs);
    useEditorDrop(inputs);
    const navigation = useEditorEmbedNavigation(inputs);
    return { ...navigation, isAreaPage };
}
