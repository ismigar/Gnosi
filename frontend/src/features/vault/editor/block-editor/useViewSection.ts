import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import type { GnosiEditor } from './schema';
import type { ApplyViewSection } from './page-editor/types';

function sectionText(value: unknown): string { return String(value); }

export function useViewSection(editor: GnosiEditor, applyViewSectionRef?: RefObject<ApplyViewSection | null>) {
    const anchorRef = useRef<string | null>(null);
    const capturePageViewAnchor = useCallback((id: string | null) => { anchorRef.current = id; }, []);
    const applyViewSection = useCallback<ApplyViewSection>((section, editingBlock) => {
        const props = { section_id: sectionText(section.section_id || ''), view_id: sectionText(section.view_id || ''), heading: sectionText(section.heading || ''), heading_level: sectionText(section.heading_level || 1), section: '' };
        if (!props.view_id) {
            const rest = { ...section }; delete rest.view_id; delete rest.heading; delete rest.heading_level;
            props.section = JSON.stringify(rest);
        }
        if (editingBlock?.id) {
            editor.updateBlock(editingBlock.id, { type: 'gnosi_view', props });
            return { id: editingBlock.id, props };
        }
        const anchor = (anchorRef.current && editor.getBlock(anchorRef.current)) || editor.getTextCursorPosition().block;
        const [inserted] = editor.insertBlocks([{ type: 'gnosi_view', props }], anchor, 'after');
        if (inserted) {
            anchorRef.current = null;
            return { id: inserted.id, props };
        }
    }, [editor]);
    useLayoutEffect(() => {
        if (!applyViewSectionRef) return;
        applyViewSectionRef.current = applyViewSection;
        return () => { if (applyViewSectionRef.current === applyViewSection) applyViewSectionRef.current = null; };
    }, [applyViewSection, applyViewSectionRef]);
    return capturePageViewAnchor;
}
