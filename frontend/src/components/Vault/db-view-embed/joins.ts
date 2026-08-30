import { legacyText } from './decode';
import type { Column, EmbedJoin, EmbedRow } from './types';
import type { ViewColumn } from '../page-view-modal/types';
function _indexByField(rows: readonly EmbedRow[], field: string) {
    const idx = new Map<string, EmbedRow[]>();
    for (const r of rows) {
        const meta = r.metadata;
        let val;
        if (field === 'id') val = r.id;
        else if (field === 'title') val = r.title || meta.title || meta.Nom || meta.Títol || meta.Name || meta.Título;
        else val = meta[field];
        if (val === null || val === undefined || val === '') continue;
        const keys = Array.isArray(val) ? val.map(v => legacyText(v)).filter(v => v) : [legacyText(val)];
        for (const k of keys) {
            if (!idx.has(k)) idx.set(k, []);
            idx.get(k)?.push(r);
        }
    }
    return idx;
}
export async function applyClientJoins(baseRows: EmbedRow[], joins: readonly EmbedJoin[] | undefined, loadTable: (tableId: string) => Promise<EmbedRow[]>): Promise<EmbedRow[]> {
    if (!joins || joins.length === 0) return baseRows;
    let acc = baseRows.map(r => ({ ...r, metadata: { ...(r.metadata) } }));
    for (const join of joins) {
        const tid = join.tableId;
        const lf = join.leftField;
        const rf = join.rightField;
        const type = legacyText((join.type) || 'inner').toLowerCase();
        if (!tid || !lf || !rf) continue;
        const right = await loadTable(tid);
        const ridx = _indexByField(right, rf);
        const next: EmbedRow[] = [];
        if (type === 'right') {
            const matched = new Set();
            for (const a of acc) {
                const meta = a.metadata;
                let lv;
                if (lf === 'id') lv = a.id;
                else if (lf === 'title') lv = a.title || meta.title || meta.Nom || meta.Títol || meta.Name || meta.Título;
                else lv = meta[lf];
                const keys = Array.isArray(lv) ? lv.map(v => legacyText(v)).filter(v => v) : (lv !== '' && lv != null ? [legacyText(lv)] : []);
                for (const k of keys) {
                    for (const rr of (ridx.get(k) || [])) {
                        matched.add(legacyText(rr.id));
                        const merged = { ...a, metadata: { ...meta } };
                        for (const [fk, fv] of Object.entries(rr.metadata)) {
                            if (!(fk in merged.metadata)) merged.metadata[fk] = fv;
                        }
                        merged.metadata[`_join:${tid}`] = [rr.metadata];
                        next.push(merged);
                    }
                }
            }
            for (const rr of right) {
                if (matched.has(legacyText(rr.id))) continue;
                next.push({ id: rr.id, title: rr.title, metadata: { [`_join:${tid}`]: [rr.metadata] } });
            }
            acc = next;
            continue;
        }
        for (const a of acc) {
            const meta = a.metadata;
            let lv;
            if (lf === 'id') lv = a.id;
            else if (lf === 'title') lv = a.title || meta.title || meta.Nom || meta.Títol || meta.Name || meta.Título;
            else lv = meta[lf];
            const keys = Array.isArray(lv) ? lv.map(v => legacyText(v)).filter(v => v) : (lv !== '' && lv != null ? [legacyText(lv)] : []);
            const matches: EmbedRow[] = [];
            for (const k of keys) matches.push(...(ridx.get(k) || []));
            if (matches.length === 0) {
                if (type === 'left') {
                    next.push({ ...a, metadata: { ...meta, [`_join:${tid}`]: [] } });
                }
                continue;
            }
            for (const rr of matches) {
                const merged = { ...a, metadata: { ...meta } };
                for (const [fk, fv] of Object.entries(rr.metadata)) {
                    if (!(fk in merged.metadata)) merged.metadata[fk] = fv;
                }
                merged.metadata[`_join:${tid}`] = [rr.metadata];
                next.push(merged);
            }
        }
        acc = next;
    }
    return acc;
}
export function normalizeVisibleColumns(cols: readonly Column[], baseTableId: string | null | undefined): ViewColumn[] {
    if (cols.length === 0) {
        return [{ tableId: baseTableId, fieldKey: 'title' }];
    }
    return cols.map(c => {
        if (typeof c === 'string') return { tableId: baseTableId, fieldKey: c };
        if (c.fieldKey) {
            return { tableId: c.tableId || baseTableId, fieldKey: c.fieldKey, label: c.label };
        }
        return null;
    }).filter((column): column is Exclude<typeof column, null> => column !== null);
}
