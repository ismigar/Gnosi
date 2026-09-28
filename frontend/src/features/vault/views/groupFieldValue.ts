import { asBool } from '../../../shared/filtering/vaultFilters';
import { getFieldConfig, getFieldType, resolveSystemDateValue } from '../../../shared/records/model/schemaUtils';
import { evaluateFormula } from '../properties/formulaUtils';
import { evaluateRollup } from '../properties/rollupUtils';
import { readGroupValue } from './groupValueUtils';

interface GroupRecord {
    readonly id: string;
    readonly title?: unknown;
    readonly metadata?: Readonly<Record<string, unknown>> | null;
}

export function readGroupFieldValue(
    note: GroupRecord, field: string, schema: Readonly<Record<string, unknown>>,
    allNotes: readonly GroupRecord[] = [],
): unknown {
    const config = getFieldConfig(schema, field);
    const type = getFieldType(schema, field);
    const raw = readGroupValue(note, field, config.id);
    if (type === 'checkbox') return raw == null || raw === '' ? raw : asBool(raw);
    if (type === 'created_time' || type === 'last_edited_time') {
        return resolveSystemDateValue({ ...note }, schema, type, field);
    }
    if (type === 'formula' && config.formula) {
        return evaluateFormula(config.formula, note.metadata ?? {}, typeof note.title === 'string' ? note.title : '');
    }
    if (type !== 'rollup') return raw;
    const relation = readGroupValue(note, typeof config.relationField === 'string' ? config.relationField : '');
    let ids: unknown[] = Array.isArray(relation) ? relation : relation == null || relation === '' ? [] : [relation];
    if (config.limit) ids = ids.slice(0, Number(config.limit));
    const aggregation = typeof config.aggregation === 'string' ? config.aggregation : 'count_values';
    const byId = new Map(allNotes.map(item => [item.id, item]));
    const values = aggregation === 'count_all' ? ids
        : ids.map(id => byId.get(String(id))?.metadata?.[typeof config.targetProperty === 'string' ? config.targetProperty : '']);
    return evaluateRollup(values, aggregation);
}
