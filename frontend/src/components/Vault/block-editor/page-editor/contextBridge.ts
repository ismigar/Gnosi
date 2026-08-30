import type { VaultEditorContextValue, VaultEditorCallback } from '../../VaultEditorContext';
import type { PageEditorProps, PageMetadata, PageNote, PageTable, ViewEditingBlock } from './types';
import { isRecord } from './valueBoundaries';

function metadata(value: unknown): value is PageMetadata {
  return isRecord(value) && ['title', 'icon', 'cover', 'table_id', 'database_table_id', 'resolved_table_id'].every(key => value[key] === undefined || typeof value[key] === 'string')
    && (value.is_dashboard === undefined || typeof value.is_dashboard === 'boolean');
}
function note(value: unknown): value is PageNote {
  return isRecord(value) && typeof value.id === 'string' && (value.title === undefined || typeof value.title === 'string') && (value.metadata === undefined || metadata(value.metadata));
}
function table(value: unknown): value is PageTable {
  return isRecord(value) && typeof value.id === 'string'
    && (value.name === undefined || typeof value.name === 'string')
    && (value.properties === undefined || (Array.isArray(value.properties) && value.properties.every((property: unknown) => isRecord(property) && typeof property.name === 'string' && typeof property.type === 'string')));
}
function editingBlock(value: unknown): value is ViewEditingBlock {
  return isRecord(value) && (value.id === undefined || typeof value.id === 'string')
    && (value.props === undefined || (isRecord(value.props)
      && ['heading', 'view_id', 'section'].every(key => value.props && isRecord(value.props) && (value.props[key] === undefined || typeof value.props[key] === 'string'))
      && (value.props.heading_level === undefined || typeof value.props.heading_level === 'number' || typeof value.props.heading_level === 'string')));
}
function pageCallback(callback: ((pageId: string) => unknown) | null | undefined): VaultEditorCallback | null {
  return callback ? (pageId: unknown) => {
    if (typeof pageId !== 'string') throw new TypeError('Expected a page identifier');
    return callback(pageId);
  } : null;
}

/** The shared context has unknown arguments; validate that boundary before typed callbacks. */
export function pageContextCallbacks(props: PageEditorProps, openView: (tableId?: string, editing?: ViewEditingBlock | null) => void): Pick<VaultEditorContextValue,
  'onCreateRecord' | 'onDeletePage' | 'onEditSchema' | 'onOpenInCurrentTab' | 'onOpenInNewTab' | 'onOpenPage' | 'onOpenPageViewModal' | 'onOpenParallel' | 'onOpenViewConfig'> {
  return {
    onDeletePage: pageCallback(props.onDeletePage),
    onOpenParallel: pageCallback(props.onOpenParallel),
    onOpenPage: pageCallback(props.onOpenPage),
    onOpenInCurrentTab: pageCallback(props.onOpenInCurrentTab),
    onOpenInNewTab: pageCallback(props.onOpenInNewTab),
    onEditSchema: props.onEditSchema ? (value: unknown) => {
      if (!table(value)) throw new TypeError('Expected a table schema');
      return props.onEditSchema?.(value);
    } : null,
    onCreateRecord: props.onCreateRecord ? (tableId: unknown, values?: unknown, template?: unknown) => {
      if (typeof tableId !== 'string' || (values !== undefined && !metadata(values)) || (template != null && !note(template))) throw new TypeError('Invalid record creation arguments');
      return props.onCreateRecord?.(tableId, values, template);
    } : null,
    onOpenPageViewModal: (tableId: unknown = '', editing: unknown = null) => {
      if (typeof tableId !== 'string' || (editing !== null && !editingBlock(editing))) throw new TypeError('Invalid embedded view arguments');
      openView(tableId, editing);
    },
    onOpenViewConfig: props.onOpenViewConfig ? (view: unknown, onSaved?: unknown) => {
      if (!isRecord(view) || (onSaved !== undefined && typeof onSaved !== 'function')) throw new TypeError('Invalid view configuration arguments');
      return props.onOpenViewConfig?.(view, typeof onSaved === 'function' ? saved => { Reflect.apply(onSaved, undefined, [saved]); } : undefined);
    } : null,
  };
}
