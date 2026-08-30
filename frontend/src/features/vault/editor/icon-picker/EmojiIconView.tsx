import EmojiPicker, { Theme } from 'emoji-picker-react';

import type { EffectiveTheme } from '../../../../shared/hooks/useTheme';


interface EmojiIconViewProps {
    readonly effectiveTheme: EffectiveTheme;
    readonly onSelect: (emoji: string) => void;
}


export function EmojiIconView({ effectiveTheme, onSelect }: EmojiIconViewProps) {
    return (
        <div className="emoji-picker-container">
            <EmojiPicker
                autoFocusSearch
                height={400}
                onEmojiClick={(emojiData) => {
                    onSelect(emojiData.emoji);
                }}
                previewConfig={{ showPreview: false }}
                skinTonesDisabled
                theme={effectiveTheme === 'dark' ? Theme.DARK : Theme.LIGHT}
                width="100%"
            />
        </div>
    );
}
