import type { PartialBlock } from '@blocknote/core';


interface MailHtmlParser {
    tryParseHTMLToBlocks(html: string): PartialBlock[];
}


/** Isolates BlockNote's unresolved implementation generics from strict app code. */
export function parseMailHtml(
    editor: MailHtmlParser,
    html: string,
): PartialBlock[] {
    return editor.tryParseHTMLToBlocks(html);
}


export function blockHasContent(block: Readonly<{ readonly content?: unknown }>): boolean {
    const { content } = block;
    if (Array.isArray(content)) return content.length > 0;
    return content !== null && content !== undefined && content !== '';
}
