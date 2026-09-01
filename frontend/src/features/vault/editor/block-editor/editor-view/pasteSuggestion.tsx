import type { ClipboardEvent } from 'react';
import { toast } from '../../../../../shared/notifications/toast';
import type { PartialEditorBlock } from '../schema';
import { errorMessage, pastedText } from './values';
import type { EditorViewProps } from './types';

type PasteInputs = Pick<EditorViewProps, 'editor' | 't' | 'detectEmbeddableUrl'>;

/** Files remain owned by the parent's native capture listener; text pastes continue normally. */
export function suggestPastedFrame(event: ClipboardEvent<HTMLDivElement>, { editor, t, detectEmbeddableUrl }: PasteInputs): void {
    const text = pastedText(event.clipboardData);
    const kind = detectEmbeddableUrl(text);
    if (!kind) return;
    const url = text.trim();
    const insertFrame = () => {
        try {
            const anchor = editor.getTextCursorPosition().block;
            const block: PartialEditorBlock = { type: 'embed', props: { url, caption: '' } };
            editor.insertBlocks([block], anchor, 'after');
        } catch (error) {
            console.warn('paste→frame insert failed:', errorMessage(error));
        }
    };
    toast.custom(notification => (
        <div className="px-4 py-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-lg flex items-center gap-3 max-w-md">
            <div className="text-xs text-[var(--text-secondary)]">
                {kind === 'pdf'
                    ? t('editor.paste_pdf_detected', { defaultValue: 'PDF detected. Do you want to see it embedded as a frame?' })
                    : t('editor.paste_video_detected', { defaultValue: 'Video detected. Do you want to see it embedded as a frame?' })}
            </div>
            <button onClick={() => { insertFrame(); toast.dismiss(notification.id); }}
                className="px-3 py-1.5 rounded-md bg-[var(--gnosi-primary)] text-white text-xs font-medium hover:opacity-90 shrink-0">
                {t('editor.paste_convert_frame', { defaultValue: 'Insert frame' })}
            </button>
            <button onClick={() => { toast.dismiss(notification.id); }}
                className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] shrink-0">
                {t('common.dismiss', { defaultValue: 'Dismiss' })}
            </button>
        </div>
    ), { duration: 8000 });
}
