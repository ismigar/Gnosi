import { isComputedType } from '../cellGridUtils';
import { resolveSystemDateValue } from '../schemaUtils';
import { CellButton } from './CellButton';
import { CellEditor } from './CellEditor';
import { CellValue } from './CellValue';
import { displayString } from './fieldConfig';
import { cellNode, metadataDate } from './sharedCompatibility';
import type { TableController } from './useTableController';

export function createCellRenderer(model: TableController) {
  const {
    editingCell,
    noteById,
    isImageField,
    schema,
    t,
    i18n,
    currentUser,
    setEditingCell,
  } = model;
  const renderCellContent = (value: unknown, type: string, noteId: string, field: string, originalMetaKey: string) => {
    const isEditing = editingCell?.rowId === noteId && editingCell.field === field;
    const note = noteById.get(noteId);
    const isImageLikeField = isImageField(field, type);

    if (type === 'button') { return <CellButton model={model} value={value} type={type} noteId={noteId} field={field} originalMetaKey={originalMetaKey} />; }

    if (type === 'created_time' || type === 'last_edited_time') {
      const iso = resolveSystemDateValue(note, schema, type, field);
      let label = '';
      if (iso) { try { label = metadataDate(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { label = displayString(iso).slice(0, 10); } }
      return <span className="text-sm text-[var(--text-tertiary)]">{label || '—'}</span>;
    }
    if (type === 'created_by' || type === 'last_edited_by') {
      const canonical = note?.metadata?.[type];
      const stored = canonical || (value && displayString(value).trim()) || note?.metadata?.[field];
      const who = stored || currentUser?.name || currentUser?.email || '—';
      return <span className="text-sm text-[var(--text-secondary)]">{cellNode(who)}</span>;
    }

    if (isEditing && isComputedType(type)) {
      setTimeout(() => { setEditingCell(null); }, 0);
    } else if (isEditing) { return <CellEditor model={model} value={value} type={type} noteId={noteId} field={field} originalMetaKey={originalMetaKey} />; }

    const isEmptyValue = value === undefined || value === null || value === '';
    if (isEmptyValue && type !== 'formula' && type !== 'rollup') {
      if (type === 'checkbox') {
        return <div className="w-4 h-4 border border-[var(--border-primary)] rounded-sm"></div>;
      }
      if (type === 'files') {
        return <span className="text-[var(--text-tertiary)] italic">{t('table.add_files', { defaultValue: "+ Files" })}</span>;
      }
      if (isImageLikeField) {
        return <span className="text-[var(--text-tertiary)] italic">{t('table.add_image', { defaultValue: "+ Image" })}</span>;
      }
      return <span className="text-[var(--text-tertiary)]">-</span>;
    }

    return <CellValue model={model} value={value} type={type} noteId={noteId} field={field} originalMetaKey={originalMetaKey} />;
  };
  return renderCellContent;
}
