import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import type { GnosiEditor } from './schema';
import type { ApplyViewSection } from './page-editor/types';

function sectionText(value: unknown): string { return String(value); }

export function useViewSection(editor: GnosiEditor, applyViewSectionRef?: RefObject<ApplyViewSection | null>) {
    const anchorRef = useRef<string | null>(null);
    const capturePageViewAnchor = useCallback((id: string | null) => { anchorRef.current = id; }, []);
    const applyViewSection = useCallback<ApplyViewSection>((section, editingBlock) => {
        const props = { view_id: sectionText(section.view_id || ''), heading: sectionText(section.heading || ''), heading_level: sectionText(section.heading_level || 1), section: '' };
        if (!props.view_id) {
            const rest = { ...section }; delete rest.view_id; delete rest.heading; delete rest.heading_level;
            props.section = JSON.stringify(rest);
        }
        try {
            if (editingBlock?.id) { editor.updateBlock(editingBlock.id, { type: 'gnosi_view', props }); return; }
            const anchor = (anchorRef.current && editor.getBlock(anchorRef.current)) || editor.getTextCursorPosition().block;
            editor.insertBlocks([{ type: 'gnosi_view', props }], anchor, 'after');
        } catch (error) { console.warn('applyViewSection: could not apply the gnosi_view block', error); }
        finally { anchorRef.current = null; }
    }, [editor]);
    useLayoutEffect(() => {
        if (!applyViewSectionRef) return;
        applyViewSectionRef.current = applyViewSection;
        return () => { if (applyViewSectionRef.current === applyViewSection) applyViewSectionRef.current = null; };
    }, [applyViewSection, applyViewSectionRef]);
    return capturePageViewAnchor;
}
