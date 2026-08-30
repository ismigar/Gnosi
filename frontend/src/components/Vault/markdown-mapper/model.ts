export interface MarkdownRecord {
    [key: string]: unknown;
}

export interface MarkdownBlock extends MarkdownRecord {
    children?: MarkdownBlock[];
    content?: unknown;
    id?: unknown;
    props?: MarkdownRecord;
    type?: string;
}

export interface InlineNode extends MarkdownRecord {
    content?: unknown;
    href?: unknown;
    props?: MarkdownRecord;
    styles?: MarkdownRecord;
    text?: unknown;
    type?: string;
}

export interface MarkdownParserEditor extends MarkdownRecord {
    tryParseMarkdownToBlocks(markdown: string): unknown;
}

export interface MarkdownSerializationContext {
    readonly footnoteDefinitions: string[];
    readonly footnoteOrder: Map<string, number>;
}

export function isRecord(value: unknown): value is MarkdownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

export function isMarkdownBlock(value: unknown): value is MarkdownBlock {
    if (!isRecord(value)) return false;
    return value.type === undefined || typeof value.type === 'string';
}

export function isInlineNode(value: unknown): value is InlineNode {
    if (!isRecord(value)) return false;
    return value.type === undefined || typeof value.type === 'string';
}

export function toBlockArray(value: unknown): MarkdownBlock[] | null {
    if (!isUnknownArray(value)) return null;
    const blocks: MarkdownBlock[] = [];
    for (const item of value) {
        if (!isMarkdownBlock(item)) return null;
        blocks.push(item);
    }
    return blocks;
}

export function toInlineArray(value: unknown): InlineNode[] | null {
    if (!isUnknownArray(value)) return null;
    const nodes: InlineNode[] = [];
    for (const item of value) {
        if (!isInlineNode(item)) return null;
        nodes.push(item);
    }
    return nodes;
}

export function isMarkdownParserEditor(value: unknown): value is MarkdownParserEditor {
    return isRecord(value) && typeof value.tryParseMarkdownToBlocks === 'function';
}

export function propsOf(value: MarkdownBlock | InlineNode): MarkdownRecord {
    return isRecord(value.props) ? value.props : {};
}

export function stylesOf(value: InlineNode): MarkdownRecord {
    return isRecord(value.styles) ? value.styles : {};
}

export function legacyString(value: unknown): string {
    const rendered: unknown = Reflect.apply(String, undefined, [value]);
    return typeof rendered === 'string' ? rendered : '';
}

export function legacyStringOrEmpty(value: unknown): string {
    return value ? legacyString(value) : '';
}

export function createSerializationContext(): MarkdownSerializationContext {
    return {
        footnoteDefinitions: [],
        footnoteOrder: new Map<string, number>(),
    };
}
