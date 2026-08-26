import { getFieldConfig, getFieldType, getSchemaFieldNames } from './schemaUtils';

export function normalizeTableFunctionalities(functionalities = [], schema = {}) {
    const normalized = [];
    const seen = new Set();
    const add = (entry, fallbackId) => {
        const id = String(entry?.id || fallbackId || `fn_${normalized.length + 1}`);
        if (seen.has(id)) return;
        seen.add(id);
        normalized.push({
            id,
            enabled: entry?.enabled !== false,
            label: String(entry?.label || '').trim(),
            action: String(entry?.action || 'translate_row'),
            config: entry?.config && typeof entry.config === 'object' ? entry.config : {},
        });
    };

    (Array.isArray(functionalities) ? functionalities : []).forEach((entry) => add(entry));
    getSchemaFieldNames(schema || {}).forEach((name) => {
        if (getFieldType(schema, name) !== 'button') return;
        const config = getFieldConfig(schema, name) || {};
        add({
            id: config.id ? `legacy_${config.id}` : `legacy_${name}`,
            enabled: true,
            label: config.button_label || name,
            action: config.button_action || 'translate_row',
            config: config.button_config || {},
        });
    });
    return normalized;
}
