import type { EditorSchema, PartialEditorBlock } from './schema';
import { isRecord, isUnknownArray } from '../markdown-mapper/model';

function createBlockId(): string {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Normalize legacy names/containers without changing any existing block ids. */
export function sanitizeBlocks(value: unknown): unknown {
    if (!isUnknownArray(value)) return value;
    return value.map(block => {
        if (!isRecord(block)) throw new TypeError('A document block must be an object');
        const next = { ...block };
        if (!next.id) next.id = createBlockId();
        const props = isRecord(next.props) ? next.props : {};
        if (block.type === 'heading1' || block.type === 'heading2' || block.type === 'heading3') {
            next.type = 'heading'; next.props = { ...props, level: Number(block.type.slice(-1)) };
        } else if (block.type === 'bulleted_list_item') next.type = 'bulletListItem';
        else if (block.type === 'numbered_list_item') next.type = 'numberedListItem';
        if (next.type === 'alert') {
            const legacyContent = isUnknownArray(next.content) ? next.content : [];
            delete next.content;
            if (!isUnknownArray(next.children) || next.children.length === 0) {
                next.children = [{ type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }, content: legacyContent }];
            }
        } else if (typeof next.type === 'string' && ['columnList', 'column', 'database', 'transclusion', 'gnosi_view', 'embed'].includes(next.type)) {
            delete next.content;
        }
        if (isUnknownArray(next.content) && next.content.length === 0 && isUnknownArray(next.children) && next.children.length > 0) delete next.content;
        if (next.children) next.children = sanitizeBlocks(next.children);
        return next;
    });
}

function validProps(value: unknown, specification: unknown): boolean {
    if (value === undefined) return true;
    if (!isRecord(value) || !isRecord(specification)) return false;
    return Object.entries(specification).every(([name, rule]) => {
        if (value[name] === undefined) return true;
        if (!isRecord(rule)) return false;
        const kind = rule.default === undefined ? rule.type : typeof rule.default;
        return typeof value[name] === kind && (!isUnknownArray(rule.values) || rule.values.includes(value[name]));
    });
}
function validStyles(value: unknown, schema: EditorSchema, plain = false): boolean {
    if (!isRecord(value)) return false;
    return Object.entries(value).every(([name, style]) => {
        if (plain) return false;
        const rule: unknown = Reflect.get(schema.styleSchema, name);
        return isRecord(rule) && typeof style === rule.propSchema;
    });
}
function validText(value: unknown, schema: EditorSchema, plain = false): boolean {
    return isRecord(value) && value.type === 'text' && typeof value.text === 'string' && validStyles(value.styles, schema, plain);
}
function validInline(value: unknown, schema: EditorSchema, plain = false): boolean {
    if (typeof value === 'string') return true;
    if (!isUnknownArray(value)) return false;
    return value.every(item => {
        if (typeof item === 'string' || validText(item, schema, plain)) return true;
        if (plain || !isRecord(item) || typeof item.type !== 'string') return false;
        if (item.type === 'link') return typeof item.href === 'string' && (typeof item.content === 'string' || (isUnknownArray(item.content) && item.content.every(text => validText(text, schema))));
        const rule: unknown = Reflect.get(schema.inlineContentSchema, item.type);
        if (!isRecord(rule) || !validProps(item.props, rule.propSchema)) return false;
        if (item.content === undefined) return true;
        return rule.content === 'plain' ? typeof item.content === 'string' : rule.content === 'styled' && validInline(item.content, schema);
    });
}
const cellProps = {
    backgroundColor: { default: '' }, textColor: { default: '' }, textAlignment: { default: 'left', values: ['left', 'center', 'right', 'justify'] },
    colspan: { default: 1 }, rowspan: { default: 1 },
};
function validTable(value: unknown, schema: EditorSchema): boolean {
    if (!isRecord(value) || value.type !== 'tableContent' || !isUnknownArray(value.rows)) return false;
    if (value.columnWidths !== undefined && (!isUnknownArray(value.columnWidths) || !value.columnWidths.every(width => width === undefined || typeof width === 'number'))) return false;
    if (value.headerRows !== undefined && typeof value.headerRows !== 'number') return false;
    if (value.headerCols !== undefined && typeof value.headerCols !== 'number') return false;
    return value.rows.every(row => isRecord(row) && isUnknownArray(row.cells) && row.cells.every(cell => {
        if (validInline(cell, schema)) return true;
        return isRecord(cell) && cell.type === 'tableCell' && validProps(cell.props, cellProps) && (cell.content === undefined || validInline(cell.content, schema));
    }));
}

function isEditorBlock(value: unknown, schema: EditorSchema): value is PartialEditorBlock {
    if (!isRecord(value) || (value.id !== undefined && typeof value.id !== 'string')) return false;
    const type = value.type ?? 'paragraph';
    if (typeof type !== 'string') return false;
    const rule: unknown = Reflect.get(schema.blockSchema, type);
    if (!isRecord(rule) || !validProps(value.props, rule.propSchema)) return false;
    if (value.children !== undefined && (!isUnknownArray(value.children) || !value.children.every(child => isEditorBlock(child, schema)))) return false;
    if (value.content === undefined) return true;
    if (rule.content === 'inline' || rule.content === 'plain') return validInline(value.content, schema, rule.content === 'plain');
    return rule.content === 'table' && validTable(value.content, schema);
}

/** Fail closed on unsupported blocks. Never filter them out or save a partial note. */
export function readEditorBlocks(value: unknown, schema: EditorSchema): PartialEditorBlock[] {
    const normalized = sanitizeBlocks(value);
    if (!isUnknownArray(normalized)) throw new TypeError('Document content must be a block array');
    const result: PartialEditorBlock[] = [];
    for (const [index, block] of normalized.entries()) {
        if (!isEditorBlock(block, schema)) throw new TypeError(`Unsupported editor block at index ${String(index)}; original document has not been changed`);
        result.push(block);
    }
    return result;
}
