import type { SchemaState } from './useSchemaState';
import type { ResolvedProps } from './props';
import { useTranslation } from 'react-i18next';
import { KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { generateFieldId, generateFunctionalityId } from './field-id';
import { TRANSLATABLE_FIELD_TYPES } from './constants';
import { normalizeOptions, STATUS_CATALOG_REF, seedOptionsForFeature } from '../../../../shared/records/model/optionCatalogUtils';
import type { UpdateField, Functionality } from './types';
export function useSchemaEdits(state: SchemaState, _props: ResolvedProps) {
    const { t } = useTranslation();
    const { fields, setFields, setFunctionalities, sharedCatalogs, confirmRemoveField, setConfirmRemoveField } = state;
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleAddField = () => {
        setFields([...fields, {
            id: generateFieldId(),
            name: '',
            description: '',
            type: 'text',
            formula: '',
            compute: '',
            defaultFormula: '',
            relationField: '',
            targetProperty: '',
            aggregation: 'count_values',
            limit: '',
            fallbackValue: '',
            relation_database_id: '',
            cardinality: 'one-to-many',
            file_mode: 'upload',
            storage_folder: '',
            name_pattern: '',
            translatable: false,
            button_action: '',
            button_label: '',
            duration_enabled: true,
            predecessors_enabled: true,
            skip_non_working_days: true,
            period_unit: 'days',
            options: [],
            visible: true,
        }]);
    };

    const handleUpdateField: UpdateField = (index, key, value) => {
        setFields((currentFields) => {
            const newFields = [...currentFields];
            const currentField = newFields[index];
            if (!currentField) return currentFields;
            const updatedField = { ...currentField };
            newFields[index] = updatedField;
            updatedField[key] = value;
            if (key === 'type' && value !== 'formula') {
                updatedField.formula = '';
            }
            if (key === 'type' && value !== 'virtual') {
                updatedField.compute = '';
            }
            if (key === 'type' && value !== 'rollup') {
                updatedField.relationField = '';
                updatedField.targetProperty = '';
                updatedField.aggregation = 'count_values';
                updatedField.limit = '';
                updatedField.fallbackValue = '';
            }
            if (key === 'type' && value !== 'relation') {
                updatedField.relation_database_id = '';
                updatedField.cardinality = 'one-to-many';
            }
            if (key === 'type' && value !== 'button') {
                updatedField.button_action = '';
                updatedField.button_label = '';
            }
            if (key === 'type' && value === 'button') {
                // Sensible defaults: the most common action is translation.
                if (!updatedField.button_action) updatedField.button_action = 'translate_row';
                // Buttons are not translatable by themselves.
                updatedField.translatable = false;
            }
            if (key === 'type' && !TRANSLATABLE_FIELD_TYPES.has(String(value))) {
                updatedField.translatable = false;
            }
            if (key === 'type' && value === 'status') {
                // Dedicated status fields always use the vault-wide lifecycle catalog.
                updatedField.catalogRef = STATUS_CATALOG_REF;
                if (normalizeOptions(updatedField.options).length === 0) {
                    updatedField.options = seedOptionsForFeature('base');
                }
            } else if (key === 'type' && value !== 'status' && updatedField.catalogRef === STATUS_CATALOG_REF) {
                // If a user changes the type away from status, keep a local copy of
                // the current global values instead of leaving an invalid reference.
                updatedField.catalogRef = '';
                updatedField.options = normalizeOptions(sharedCatalogs[STATUS_CATALOG_REF] || updatedField.options);
            }
            if (key === 'type' && value === 'period') {
                if (updatedField.duration_enabled === undefined) updatedField.duration_enabled = true;
                if (updatedField.predecessors_enabled === undefined) updatedField.predecessors_enabled = true;
                if (updatedField.skip_non_working_days === undefined) updatedField.skip_non_working_days = true;
                if (!['hours', 'days', 'years'].includes(updatedField.period_unit || '')) updatedField.period_unit = 'days';
            }
            return newFields;
        });
    };
    const handleRemoveField = (index: number) => {
        const name = fields[index]?.name.trim() || t('schema.untitled_property', "unnamed");
        setConfirmRemoveField({ isOpen: true, index, name });
    };

    const executeRemoveField = () => {
        if (confirmRemoveField.index !== null) {
            setFields((curr) => curr.filter((_, i) => i !== confirmRemoveField.index));
        }
        setConfirmRemoveField({ isOpen: false, index: null, name: '' });
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setFields((items) => {
                const oldIndex = items.findIndex(item => item.id === active.id);
                const newIndex = items.findIndex(item => item.id === over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    const handleAddFunctionality = () => {
        setFunctionalities((current) => [...current, {
            id: generateFunctionalityId(),
            enabled: true,
            label: t('schema.functionality_default_label', 'New functionality'),
            action: 'set_fields',
            config: { assignments: [] },
        }]);
    };

    const handleUpdateFunctionality = (index: number, patch: Partial<Functionality>) => {
        setFunctionalities((current) => current.map((functionality, itemIndex) => (
            itemIndex === index ? { ...functionality, ...patch } : functionality
        )));
    };

    const handleRemoveFunctionality = (index: number) => {
        setFunctionalities((current) => current.filter((_, itemIndex) => itemIndex !== index));
    };

    return {
        sensors, handleAddField, handleUpdateField, handleRemoveField, executeRemoveField,
        handleDragEnd, handleAddFunctionality, handleUpdateFunctionality, handleRemoveFunctionality,
    };
}
