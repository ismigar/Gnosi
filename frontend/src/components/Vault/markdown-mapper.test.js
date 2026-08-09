import { describe, expect, it, vi } from 'vitest';
import { blocksToRichMarkdown, richMarkdownToBlocks } from './markdown-mapper';

const createParser = () => ({
    tryParseMarkdownToBlocks: vi.fn(async (markdown) => {
        if (markdown.startsWith('# ')) {
            return [{
                type: 'heading',
                props: {
                    backgroundColor: 'default',
                    textColor: 'default',
                    textAlignment: 'left',
                    level: 1,
                },
                content: [{ type: 'text', text: markdown.slice(2), styles: {} }],
                children: [],
            }];
        }
        return [{
            type: 'paragraph',
            props: { backgroundColor: 'default', textColor: 'default' },
            content: [{ type: 'text', text: markdown, styles: {} }],
            children: [],
        }];
    }),
});

describe('Markdown block color round-trip', () => {
    it('keeps a styled heading wrapper after save and reload', async () => {
        const editor = createParser();
        const source = '<div style="background-color: pink;"># 📌 Resum general:</div>';

        const loaded = await richMarkdownToBlocks(source, editor);
        expect(loaded[0].props.backgroundColor).toBe('pink');

        const saved = blocksToRichMarkdown(loaded, editor);
        expect(saved).toBe(source);

        const reloaded = await richMarkdownToBlocks(saved, editor);
        expect(reloaded[0].props.backgroundColor).toBe('pink');
    });

    it('does not interpret styled HTML inside a fenced code block', async () => {
        const editor = createParser();
        const source = '```html\n<div style="background-color: pink;">literal</div>\n```';

        const loaded = await richMarkdownToBlocks(source, editor);

        expect(loaded[0].props.backgroundColor).toBe('default');
        expect(editor.tryParseMarkdownToBlocks).toHaveBeenCalledWith(source);
    });
});
