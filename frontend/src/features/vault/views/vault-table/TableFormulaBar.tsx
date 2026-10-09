import { useState } from 'react';
import { columnLabel, supportsCellFormula } from './spreadsheetFormula';
import { displayString } from './fieldConfig';
import { getMetaKey } from './metadata';
import type { TableController } from './useTableController';

export function TableFormulaBar({ model }: { model: TableController }) {
  const cell = model.activeCell;
  const note = cell ? model.noteById.get(cell.rowId) : undefined;
  const column = model.gridColumns.find(col => col.key === cell?.field);
  const raw = note && cell ? cell.field === 'title' ? note.title : note.metadata?.[getMetaKey(note, cell.field)] : '';
  const editable = !!cell && !!note && !!column && (column.key === 'title' || supportsCellFormula(column.type));
  const value = raw == null ? '' : typeof raw === 'object' ? JSON.stringify(raw) : displayString(raw);
  return <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs">
    <span className="w-12 shrink-0 text-center font-mono text-[var(--text-tertiary)]">
      {cell ? `${columnLabel(model.colIndexByKey.get(cell.field) ?? 0)}${String((model.navRowIndexById.get(cell.rowId) ?? 0) + 1)}` : 'fx'}
    </span>
    <FormulaInput key={`${cell?.rowId ?? ''}:${cell?.field ?? ''}:${value}`} value={value} disabled={!editable}
      label={model.t('table.formula_input')} hint={model.t('table.formula_hint')}
      onCancel={() => { model.tableContainerRef.current?.focus(); }}
      onSave={async draft => {
        if (!cell || !note || !column) return;
        if (cell.field === 'title') await model.saveTitle(note.id, draft);
        else await model.handleCellSave(note.id, cell.field,
          column.type === 'number' && draft.trim() !== '' && Number.isFinite(Number(draft)) ? Number(draft) : draft,
          getMetaKey(note, cell.field));
        model.tableContainerRef.current?.focus();
      }} />
    <button type="button" disabled={!cell || (model.selectedIds.size === 0 && model.selectionRect?.r0 === model.selectionRect?.r1)}
      onClick={() => { void model.fillDown(); }} title={model.t('table.fill_down_hint')}
      className="shrink-0 rounded px-2 py-1 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-40">
      {model.t('table.fill_down')}
    </button>
  </div>;
}
function FormulaInput({ value, disabled, label, hint, onSave, onCancel }: {
  value: string; disabled: boolean; label: string; hint: string;
  onSave: (value: string) => Promise<void>; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  return <input value={draft} disabled={disabled} aria-label={label} title={hint} placeholder={hint}
    className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
    onChange={event => { setDraft(event.target.value); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); void onSave(draft); }
      if (event.key === 'Escape') { event.preventDefault(); setDraft(value); onCancel(); }
    }} />;
}
