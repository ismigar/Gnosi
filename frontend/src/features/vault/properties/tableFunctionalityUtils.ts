import {
  getFieldConfig,
  getFieldType,
  getSchemaFieldNames,
} from '../../../shared/records/model/schemaUtils';

type StringableValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

interface TableFunctionality {
  action: string;
  config: object;
  enabled: boolean;
  id: string;
  label: string;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readValue(record: unknown, key: string): unknown {
  return isUnknownRecord(record) ? record[key] : undefined;
}

function readStringable(record: unknown, key: string): StringableValue {
  const value = readValue(record, key);
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return undefined;
}

export function normalizeTableFunctionalities(
  functionalities: unknown = [],
  schema: Record<string, unknown> | null | undefined = {},
): TableFunctionality[] {
  const normalized: TableFunctionality[] = [];
  const seen = new Set<string>();
  const add = (entry: unknown, fallbackId?: StringableValue): void => {
    const generatedId = `fn_${String(normalized.length + 1)}`;
    const id = String(
      readStringable(entry, 'id') ||
        fallbackId ||
        generatedId,
    );
    if (seen.has(id)) return;
    seen.add(id);
    const config = readValue(entry, 'config');
    normalized.push({
      id,
      enabled: readValue(entry, 'enabled') !== false,
      label: String(readStringable(entry, 'label') || '').trim(),
      action: String(
        readStringable(entry, 'action') || 'translate_row',
      ),
      config: config && typeof config === 'object' ? config : {},
    });
  };

  const entries: readonly unknown[] = Array.isArray(functionalities)
    ? functionalities
    : [];
  entries.forEach((entry) => {
    add(entry);
  });

  const safeSchema = schema || {};
  getSchemaFieldNames(safeSchema).forEach((name) => {
    if (getFieldType(safeSchema, name) !== 'button') return;
    const rawConfig: unknown = getFieldConfig(safeSchema, name);
    const config = isUnknownRecord(rawConfig) ? rawConfig : {};
    const configId = readStringable(config, 'id');
    add({
      id: configId ? `legacy_${String(configId)}` : `legacy_${name}`,
      enabled: true,
      label: readStringable(config, 'button_label') || name,
      action:
        readStringable(config, 'button_action') || 'translate_row',
      config: readValue(config, 'button_config') || {},
    });
  });
  return normalized;
}
