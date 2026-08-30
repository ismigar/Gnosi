import type { FootnoteInlineProps } from '../FootnoteInline';

type FootnoteEditor = NonNullable<FootnoteInlineProps['editor']>;
type FootnoteDocument = NonNullable<FootnoteEditor['document']>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}
function isArray(value: unknown): value is readonly unknown[] { return Array.isArray(value); }

/** Read-only numbering projection. No document blocks or stored content are changed. */
export function footnoteDocument(value: unknown): FootnoteDocument {
    if (!isArray(value)) return [];
    return value.flatMap(block => {
        if (!isRecord(block)) return [];
        const content = isArray(block.content) ? block.content.flatMap(item => {
            if (!isRecord(item) || typeof item.type !== 'string') return [];
            const id = isRecord(item.props) && typeof item.props.id === 'string' ? item.props.id : '';
            return [{ type: item.type, props: { id } }];
        }) : [];
        return [{ content, children: footnoteDocument(block.children) }];
    });
}
