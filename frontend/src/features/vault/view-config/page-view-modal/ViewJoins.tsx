import { Plus, Trash2 } from 'lucide-react';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldsResult } from './useViewFields';

export function ViewJoins({
    sourceTableId, t, joins, allTables,
    fieldsForTable, setJoins
}: Pick<
    useViewStateResult & ModalInput & useViewFieldsResult,
    'sourceTableId'
    | 't'
    | 'joins'
    | 'allTables'
    | 'fieldsForTable'
    | 'setJoins'
>) {
    return (<>                            {sourceTableId && (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-[var(--text-secondary)]">
                    {t('view.joins_section', "Tables and joins")}
                </label>
                <button
                    type="button"
                    onClick={() => {
                        // Pick the first table not already in the chain.
                        const used = new Set([sourceTableId, ...joins.map(j => j.tableId)]);
                        const next = allTables.find(t => !used.has(t.id));
                        if (!next) return;
                        const prevTableId = joins[joins.length - 1]?.tableId || sourceTableId;
                        const prevFields = fieldsForTable(prevTableId);
                        const nextFields = fieldsForTable(next.id);
                        setJoins(prev => [...prev, {
                            tableId: next.id,
                            type: 'inner',
                            leftField: prevFields[0]?.name || 'title',
                            rightField: nextFields[0]?.name || 'title',
                        }]);
                    }}
                    className="btn btn-secondary flex items-center gap-1 text-xs"
                >
                    <Plus size={12} />
                    {t('view.add_join', "Add table (join)")}
                </button>
            </div>
            {joins.length === 0 ? (
                <p className="text-xs text-[var(--text-tertiary)] italic">
                    {t('view.joins_empty', "Only the base table. Add a join to combine fields from multiple tables.")}
                </p>
            ) : (
                <div className="space-y-2">
                    {joins.map((j, idx) => {
                        // The "left" side is the table explicitly selected, or the last table in the chain
                        // (base if no previous join).
                        const defaultLeftTableId = idx === 0 ? sourceTableId : (joins[idx - 1]?.tableId || sourceTableId);
                        const leftTableId = j.leftTableId || defaultLeftTableId;
                        const leftFields = fieldsForTable(leftTableId);
                        const rightFields = fieldsForTable(j.tableId);

                        // Available tables for the left side are the source table and any previously joined tables
                        const availableLeftTables = [
                            allTables.find(t => t.id === sourceTableId),
                            ...joins.slice(0, idx).map(jj => allTables.find(t => t.id === jj.tableId))
                        ].filter(table => table !== undefined);

                        const usedIds = new Set([sourceTableId, ...joins.map((jj, i) => i === idx ? '' : jj.tableId)]);
                        return (
                            <div key={idx} className="rounded-lg border border-[var(--border-primary)] p-3 space-y-3 bg-[var(--bg-secondary)]">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] flex-1">
                                        {t('view.join_target_table', "Join table")} {idx + 1}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setJoins(prev => prev.filter((_, i) => i !== idx));
                                        }}
                                        className="text-[var(--text-tertiary)] hover:text-red-500 p-1"
                                        title={t('view.remove_join', "Remove join")}
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    {/* Esquerra */}
                                    <div className="space-y-2 border-r border-[var(--border-primary)] pr-4">
                                        <div>
                                            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                                {t('view.join_left_table', "Left table")}
                                            </label>
                                            <select
                                                className="w-full text-xs border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                value={leftTableId}
                                                onChange={e => {
                                                    const newId = e.target.value;
                                                    const nf = fieldsForTable(newId);
                                                    setJoins(prev => prev.map((jj, i) => i === idx ? { ...jj, leftTableId: newId, leftField: nf[0]?.name || 'title' } : jj));
                                                }}
                                            >
                                                {availableLeftTables.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(tbl => (
                                                    <option key={tbl.id} value={tbl.id}>{tbl.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                                {t('view.join_left_field', "Left field")}
                                            </label>
                                            <select
                                                className="w-full text-xs border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                value={j.leftField}
                                                onChange={e => { setJoins(prev => prev.map((jj, i) => i === idx ? { ...jj, leftField: e.target.value } : jj)); }}
                                            >
                                                {leftFields.slice().sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name)).map(f => (
                                                    <option key={f.name} value={f.name}>{f.label || f.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Dreta */}
                                    <div className="space-y-2">
                                        <div>
                                            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                                {t('view.join_right_table', "Right table")}
                                            </label>
                                            <select
                                                className="w-full text-xs border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                value={j.tableId}
                                                onChange={e => {
                                                    const newId = e.target.value;
                                                    const nf = fieldsForTable(newId);
                                                    setJoins(prev => prev.map((jj, i) => i === idx ? { ...jj, tableId: newId, rightField: nf[0]?.name || 'title' } : jj));
                                                }}
                                            >
                                                {allTables.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(tbl => (
                                                    <option key={tbl.id} value={tbl.id} disabled={usedIds.has(tbl.id)}>
                                                        {tbl.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                                {t('view.join_right_field', "Right field")}
                                            </label>
                                            <select
                                                className="w-full text-xs border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                                value={j.rightField}
                                                onChange={e => { setJoins(prev => prev.map((jj, i) => i === idx ? { ...jj, rightField: e.target.value } : jj)); }}
                                            >
                                                {rightFields.slice().sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name)).map(f => (
                                                    <option key={f.name} value={f.name}>{f.label || f.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-2 mt-2 border-t border-[var(--border-primary)]">
                                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                                        {t('view.join_type', "Join type")}
                                    </label>
                                    <select
                                        className="w-full text-xs border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        value={j.type}
                                        onChange={e => { setJoins(prev => prev.map((jj, i) => i === idx ? { ...jj, type: e.target.value } : jj)); }}
                                    >
                                        <option value="inner">{t('view.join_inner', "Inner (intersection)")}</option>
                                        <option value="left">{t('view.join_left_type', "Left (keep all from left)")}</option>
                                        <option value="right">{t('view.join_right_type', "Right (keep all from right)")}</option>
                                    </select>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    )}</>);
}
