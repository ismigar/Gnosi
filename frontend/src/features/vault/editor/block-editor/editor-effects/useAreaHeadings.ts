import { useEffect, useMemo } from 'react';
import { areaHeadingColorKey, normalizeHeadingText } from '../../areaHeadingColors';
import type { EditorBlock } from '../schema';
import type { EditorEffectsInputs } from './types';

function record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}
function scalarText(value: unknown): string { return String(value); }

export function belongsToAreas(metadata: EditorEffectsInputs['metadata'], allTables: readonly unknown[] = []): boolean {
    const id = metadata?.table_id || metadata?.database_table_id;
    if (!id) return false;
    const table = allTables.find((value) => record(value)?.id === id);
    return normalizeHeadingText(scalarText(record(table)?.name || '')) === 'arees';
}

function headingText(block: EditorBlock): string {
    const content = block.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((node) => node.type === 'text' ? node.text : '').join('');
}

export function areaHeadingRules(blocks: EditorBlock[], escape: (id: string) => string): string[] {
    const rules: string[] = [];
    for (const block of blocks) {
        if (block.type === 'heading' && block.id) {
            const key = areaHeadingColorKey(headingText(block));
            if (key) {
                const id = escape(block.id);
                rules.push(`.bn-block[data-id="${id}"] > .bn-block-content{background-color:var(--area-${key});border-radius:6px;padding:0.14em 0.45em 0.14em 0.225em;}`);
                rules.push(`.bn-editor .bn-block[data-id="${id}"] > .bn-block-content[data-content-type="heading"] :is(h1,h2,h3,h4,h5,h6){margin:0 !important;}`);
            }
        }
        if (block.children.length) rules.push(...areaHeadingRules(block.children, escape));
    }
    return rules;
}

export function useAreaHeadings({ editor, editorReady, noteFilename, metadata, contextValue }: Pick<EditorEffectsInputs, 'editor' | 'editorReady' | 'noteFilename' | 'metadata' | 'contextValue'>) {
    const tableId = metadata?.table_id;
    const databaseTableId = metadata?.database_table_id;
    const allTables = contextValue?.allTables;
    const isAreaPage = useMemo(() => belongsToAreas({ table_id: tableId, database_table_id: databaseTableId }, allTables), [tableId, databaseTableId, allTables]);
    useEffect(() => {
        if (!editorReady) return;
        const style = document.createElement('style');
        style.setAttribute('data-gnosi-area-headings', '');
        document.head.appendChild(style);
        const escape = (id: string) => typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id;
        const recompute = () => {
            let rules: string[] = [];
            if (isAreaPage) {
                try { rules = areaHeadingRules(editor.document, escape); } catch { /* Editor may be disposing. */ }
            }
            const next = rules.join('\n');
            if (style.textContent !== next) style.textContent = next;
        };
        recompute();
        const unsubscribe = editor.onChange(recompute);
        return () => { unsubscribe(); style.remove(); };
    }, [editor, editorReady, isAreaPage, noteFilename]);
    return isAreaPage;
}
