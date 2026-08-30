import { useTranslation } from 'react-i18next';
import { usePlugins } from '../../../plugins/usePlugins';
import type { SchemaConfigModalProps } from './types';
import { resolveProps } from './props';
import { useSchemaState } from './useSchemaState';
import { useAiAction } from './useAiAction';
import { useSchemaInitialization } from './useSchemaInitialization';
import { useOptionTools } from './useOptionTools';
import { useFeatureToggles } from './useFeatureToggles';
import { useDrupalCatalogs } from './useDrupalCatalogs';
import { useSchemaEdits } from './useSchemaEdits';
import { validateSchema } from './validate-schema';
import { useSchemaAutosave } from './useSchemaAutosave';
import { useSchemaKeyboard } from './useSchemaKeyboard';

export function useSchemaConfig(input: SchemaConfigModalProps) {
    const props = resolveProps(input);
    const { t } = useTranslation();
    const { isEnabled } = usePlugins();
    const projectPlanningEnabled = isEnabled('project-planning');
    const state = useSchemaState(props);
    // Preserve effect ordering: AI layer, hydration, catalogs, autosave, parent layer.
    const ai = useAiAction(state, props);
    useSchemaInitialization(state, props);
    const { optionTools } = useOptionTools(state, props);
    const toggles = useFeatureToggles(state, props, optionTools);
    const drupal = useDrupalCatalogs(state, props);
    const edits = useSchemaEdits(state, props);
    const validationError = validateSchema(state.fields, state.functionalities, state.enableTranslation, t);
    useSchemaAutosave(state, props, validationError);
    useSchemaKeyboard(state, props);
    const resolvedTableName = props.tableName
        || state.allTables.find((table) => table.id === props.tableId)?.name
        || props.folder || '';
    return {
        ...props, ...state, ...ai, ...toggles, ...drupal, ...edits, t, optionTools, validationError,
        projectPlanningEnabled, resolvedTableName,
    };
}
export type SchemaConfigModel = ReturnType<typeof useSchemaConfig>;
