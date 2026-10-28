import type { TFunction } from 'i18next';
import type { Field, Functionality } from './types';
import { isRetiredTableAction } from '../../properties/tableFunctionalityUtils';
export function validateSchema(fields: Field[], functionalities: Functionality[], enableTranslation: boolean, t: TFunction): string | null {
    const editableFunctionalities = functionalities.filter(functionality => !isRetiredTableAction(functionality.action));
    if (fields.some(f => !f.name.trim())) return t('schema.error_name_required');
    if (fields.some(f => f.type === 'formula' && !f.formula.trim())) return t('schema.error_formula_required');
    if (fields.some(f => f.type === 'virtual' && !f.compute.trim())) return t('schema.error_compute_required', "Pick a computer for the derived field.");
    if (fields.some(f => f.type === 'rollup' && !f.relationField.trim())) return t('schema.error_relation_field_required');
    if (fields.some(f => f.type === 'rollup' && f.aggregation !== 'count_all' && !f.targetProperty.trim())) return t('schema.error_target_property_required');
    if (editableFunctionalities.some((functionality) => !functionality.label.trim())) return t('schema.error_functionality_label_required', 'Give every functionality a label.');
    if (editableFunctionalities.some((functionality) => !functionality.action.trim())) return t('schema.error_functionality_action_required', 'Pick an action for every functionality.');
    if (enableTranslation && !fields.some(f => f.translatable)) return t('schema.error_no_translatable_fields', "If the table is translatable, mark at least one field as translatable.");
    return null;
};
