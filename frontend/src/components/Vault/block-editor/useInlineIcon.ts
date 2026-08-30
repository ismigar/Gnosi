import { useCallback, useState } from 'react';
import type { IconPickerProps } from '../IconPicker';
import type { GnosiEditor } from './schema';

export function useInlineIcon(editor: GnosiEditor) {
    const [inlineIconPickerAnchor, setAnchor] = useState<IconPickerProps['anchorRect']>(null);
    const openInlineIconPicker = useCallback(() => {
        try {
            const view = editor.prosemirrorView;
            const from = view.state.selection.from;
            const coords = Number.isFinite(from) ? view.coordsAtPos(from) : null;
            setAnchor(coords ? { left: coords.left, top: coords.top, bottom: coords.bottom } : { left: 24, top: 24, bottom: 24 });
        } catch { setAnchor({ left: 24, top: 24, bottom: 24 }); }
    }, [editor]);
    const closeInlineIconPicker = useCallback(() => { setAnchor(null); try { editor.focus(); } catch { /* unmounted editor */ } }, [editor]);
    const insertInlineIcon = useCallback((icon: string) => {
        const value = icon.trim(); if (!value) return;
        setAnchor(null);
        try {
            const image = value.startsWith('lucide:') || value.startsWith('http') || value.startsWith('/') || value.startsWith('Assets/') || value.startsWith('data:') || value.includes('.');
            editor.insertInlineContent(image ? [{ type: 'inlineIcon', props: { value } }, ' '] : `${value} `);
            editor.focus();
        } catch (error) { console.warn('Inline icon picker: could not insert the selected icon', error); }
    }, [editor]);
    return { inlineIconPickerAnchor, openInlineIconPicker, closeInlineIconPicker, insertInlineIcon };
}
