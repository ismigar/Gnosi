import { AutoriaEditor } from '../AutoriaField';
import { displayString, getTableFieldConfig } from './fieldConfig';
import { InlinePillsPicker } from './InlinePillsPicker';
import { InlineSelectPicker } from './InlineSelectPicker';
import { VaultDateProperty as TableDateProperty } from '../VaultDateProperty';
import { normalizeRelationValues as normalizeTableRelations } from '../relationItemUtils';
import { tableText } from './cellValues';
import type { TableController } from './useTableController';

export function CellEditor({ model, value, type, noteId, field, originalMetaKey }: { model: TableController, value: unknown; type: string; noteId: string; field: string; originalMetaKey: string; }) {
  const {
    schema,
    handleCellSave,
    setEditingCell,
    getAvailableOptions,
    idToTitle,
    getOptionColorMap,
    onUpdateFieldOptions,
    updateFieldOptions,
    removeOptionEverywhere,
    getRelationContext,
    onNoteSelect,
    handleRelationUnlink,
    getAutoriaSuggestions,
    allNotes,
    safeNotes,
    projectPlanningSettings,
    projectPlanningEnabled,
    editInitial,
    advanceCursorAfterEdit,
    setEditInitial,
    handleKeyDown,
  } = model;
  const note = model.noteById.get(noteId);

  if (type === 'status' || type === 'select') {
    const options = getAvailableOptions(field, type);
    const isStrict = type === 'status' || Boolean(getTableFieldConfig(schema, field).catalog_ref);
    return (
      <InlineSelectPicker
        value={tableText(value || '')}
        options={options}
        idToTitle={idToTitle}
        optionColors={getOptionColorMap(field)}
        onSave={(val) => { void handleCellSave(noteId, field, val, originalMetaKey); }}
        onCreate={(!isStrict && onUpdateFieldOptions) ? (val) => {
          updateFieldOptions(field, [...options, val]);
          void handleCellSave(noteId, field, val, originalMetaKey);
        } : undefined}
        onDeleteOption={(!isStrict && onUpdateFieldOptions) ? (val) => { void removeOptionEverywhere(field, type, val); } : undefined}
      />
    );
  }

  if (type === 'multi_select' || type === 'relation') {
    let options;
    let displayMap = idToTitle;
    if (type === 'relation') {
      const { relatedNotes, displayMap: enriched } = getRelationContext(field);
      options = relatedNotes.map(n => n.id);
      displayMap = enriched;
    } else {
      options = getAvailableOptions(field, type);
    }
    const currentValues = normalizeTableRelations(value);
    const canManageOptions = type === 'multi_select' && Boolean(onUpdateFieldOptions)
      && !getTableFieldConfig(schema, field).catalog_ref;
    return (
      <InlinePillsPicker
        value={currentValues}
        options={options}
        idToTitle={displayMap}
        optionColors={type === 'multi_select' ? getOptionColorMap(field) : {}}
        onSave={(vals) => { void handleCellSave(noteId, field, vals, originalMetaKey); }}
        onCreate={canManageOptions ? (val) => { updateFieldOptions(field, [...options, val]); } : undefined}
        onDeleteOption={canManageOptions ? (val) => { void removeOptionEverywhere(field, 'multi_select', val); } : undefined}
        relationItems={type === 'relation'}
        onOpenRelation={type === 'relation' ? onNoteSelect : undefined}
        onRemoveRelation={type === 'relation'
          ? (relationId) => handleRelationUnlink(noteId, field, originalMetaKey, relationId, displayMap)
          : undefined}
      />
    );
  }

  if (type === 'autoria') {
    const current = Array.isArray(value) ? value : [];
    return (
      <AutoriaEditor
        value={current}
        suggestions={getAutoriaSuggestions(field)}
        onSave={(authors) => { void handleCellSave(noteId, field, authors, originalMetaKey); }}
      />
    );
  }

  if (type === 'date' || type === 'datetime' || type === 'period') {
    return (
      <TableDateProperty
        value={value || ''}
        rruleValue={tableText(note?.metadata?.[`${originalMetaKey}_rrule`] || '')}
        type={type}
        fieldConfig={getTableFieldConfig(schema, field)}
        fieldName={field}
        noteId={noteId}
        notes={(allNotes.length > 0) ? allNotes : safeNotes}
        idToTitle={idToTitle}
        planningSettings={projectPlanningSettings}
        planningEnabled={projectPlanningEnabled}
        onChange={(newVal) => { void handleCellSave(noteId, field, newVal, originalMetaKey); }}
        onRruleChange={(newRrule) => { void handleCellSave(noteId, field, value || '', originalMetaKey, false, { [`${originalMetaKey}_rrule`]: newRrule }); }}
      />
    );
  }

  if (type === 'number') {
    const saveNumber = (raw: string) => {
      const s = displayString(raw).trim();
      const n = s === '' ? '' : (Number.isFinite(Number(s)) ? Number(s) : s);
      void handleCellSave(noteId, field, n, originalMetaKey);
    };
    return (
      <input
        autoFocus
        type="number"
        inputMode="decimal"
        className="w-full px-1 py-0.5 text-sm border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
        defaultValue={editInitial != null ? editInitial : tableText(value ?? '')}
        onBlur={(e) => { saveNumber(e.currentTarget.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); saveNumber(e.currentTarget.value); advanceCursorAfterEdit(noteId, field); return; }
          if (e.key === 'Escape') { setEditingCell(null); setEditInitial(null); return; }
          handleKeyDown(e, noteId, field, originalMetaKey);
        }}
      />
    );
  }

  return (
    <input
      autoFocus
      className="w-full px-1 py-0.5 text-sm border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
      defaultValue={editInitial != null ? editInitial : tableText(value || '')}
      onBlur={(e) => { void handleCellSave(noteId, field, e.currentTarget.value, originalMetaKey); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); void handleCellSave(noteId, field, e.currentTarget.value, originalMetaKey); advanceCursorAfterEdit(noteId, field); return; }
        if (e.key === 'Escape') { setEditingCell(null); setEditInitial(null); return; }
        handleKeyDown(e, noteId, field, originalMetaKey);
      }}
    />
  );

}
