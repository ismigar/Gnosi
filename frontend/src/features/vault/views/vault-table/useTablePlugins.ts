import { useRecordWebsiteDestinations } from '../../../websites';
import { useMemo } from 'react';
import { getSchemaFieldNames } from '../../../../shared/records/model/schemaUtils';
import { isRetiredTableAction, normalizeTableFunctionalities } from '../../properties/tableFunctionalityUtils';
import { assignmentConfig, displayString, getTableFieldConfig } from './fieldConfig';
import type { TableInputs } from './tableInputs';
import type { useTableIdentity } from './useTableIdentity';

type Inputs = Pick<TableInputs, 'schema' | 'functionalities' | 'notes'>
  & Pick<ReturnType<typeof useTableIdentity>, 'llmWikiConfig' | 'isPluginEnabled'>;

export function useTablePlugins({ schema, functionalities, notes, llmWikiConfig, isPluginEnabled }: Inputs) {
  const isTranslatableTable = useMemo(
    () => getSchemaFieldNames(schema).some(
      (name) => getTableFieldConfig(schema, name).translatable === true
    ),
    [schema]
  );
  const isSocialPublishTable = useMemo(
    () => getSchemaFieldNames(schema).some((name) => {
      const cfg = getTableFieldConfig(schema, name);
      return cfg.system === true && /xxss|social/i.test(name);
    }),
    [schema]
  );
  const tableFunctionalities = useMemo(
    () => normalizeTableFunctionalities(functionalities, schema).map(item => ({ ...item, config: assignmentConfig(item.config) })).filter((functionality) => functionality.enabled && !isRetiredTableAction(functionality.action)),
    [functionalities, schema]
  );
  const hasTranslateFunctionality = tableFunctionalities.some((functionality) => functionality.action === 'translate_row');
  const tableNote = notes.find(note => note.resolved_table_id || note.metadata?.table_id || note.metadata?.database_table_id);
  const llmWikiTableId = displayString(
    tableNote?.resolved_table_id || tableNote?.metadata?.table_id || tableNote?.metadata?.database_table_id
    || schema.id || schema.table_id || '',
  );
  const llmWikiSourceConfig = (llmWikiConfig?.source_tables || []).find(
    (source) => source.table_id === llmWikiTableId,
  ) || null;
  const isLlmWikiTable = useMemo(
    () => isPluginEnabled('llm-wiki') && Boolean(llmWikiSourceConfig),
    [isPluginEnabled, llmWikiSourceConfig],
  );
  const websites = useRecordWebsiteDestinations({ table_id: llmWikiTableId }, isPluginEnabled('web-publishing'));
  return { ...websites, isTranslatableTable, isSocialPublishTable, tableFunctionalities, hasTranslateFunctionality, llmWikiTableId, isLlmWikiTable };
}
