import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HTMLContainer, useEditor } from 'tldraw';
import { canvasColor, type JsonCanvasNode } from './model';
import { JSON_CANVAS_NODE, type JsonCanvasNodeShape } from './JsonCanvasNodeShape';

export function JsonCanvasNodeComponent({ shape }: { readonly shape: JsonCanvasNodeShape }) {
    const editor = useEditor();
    const { t } = useTranslation();
    const [editing, setEditing] = useState(false);
    const node = JSON.parse(shape.props.data) as JsonCanvasNode;
    const isGroup = node.type === 'group';
    const value = node.text ?? node.file ?? node.url ?? node.label ?? '';
    const change = (text: string) => editor.updateShape<JsonCanvasNodeShape>({ id: shape.id, type: JSON_CANVAS_NODE,
        props: { data: JSON.stringify({ ...node, [isGroup ? 'label' : 'text']: text }) } });
    return <HTMLContainer style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all',
        border: `2px solid ${canvasColor(node.color)}`, borderRadius: 8, background: isGroup ? 'transparent' : 'var(--bg-primary)', color: 'var(--text-primary)' }}>
        <div className="flex h-full flex-col overflow-hidden p-2">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                <span>{t(`json_canvas.${node.type}`, node.type)}</span>
                {(node.type === 'text' || isGroup) && <button type="button" className="rounded px-2 py-1 hover:bg-[var(--bg-secondary)]"
                    onPointerDown={event => { event.stopPropagation(); }}
                    onClick={() => { setEditing(current => !current); }}>{editing ? t('common.done', 'Done') : t('common.edit', 'Edit')}</button>}
            </div>
            {editing ? <textarea className="min-h-0 flex-1 resize-none bg-[var(--bg-primary)] p-1 text-sm outline-none"
                aria-label={t('json_canvas.content', 'Card content')} value={value}
                onPointerDown={event => { event.stopPropagation(); }} onKeyDown={event => { event.stopPropagation(); }}
                onChange={event => { change(event.target.value); }} />
                : <div className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words text-sm" onWheel={event => { event.stopPropagation(); }}>
                    {node.type === 'link' && /^https?:\/\//i.test(value)
                        ? <a href={value} target="_blank" rel="noopener noreferrer" onPointerDown={event => { event.stopPropagation(); }}>{value}</a>
                        : value}
                    {node.subpath && <span>{node.subpath}</span>}
                    {node.type === 'file' && <p className="mt-2 text-xs text-[var(--text-tertiary)]">{t('json_canvas.file_reference', 'File reference; the original path is preserved.')}</p>}
                    {node.background && <p className="mt-2 text-xs text-[var(--text-tertiary)]">{t('json_canvas.background_reference', 'Background file: {{path}}', { path: node.background })}</p>}
                </div>}
        </div>
    </HTMLContainer>;
}
