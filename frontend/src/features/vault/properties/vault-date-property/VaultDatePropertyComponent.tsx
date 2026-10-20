import { LegacyPeriodEditor } from './LegacyPeriodEditor';
import { PlanningPeriodEditor } from './PlanningPeriodEditor';
import type { VaultDatePropertyProps } from './types';
import { VaultScalarDateEditor } from './VaultScalarDateEditor';
import { UnifiedDateEditor } from './UnifiedDateEditor';

export function VaultDateProperty({
    fieldConfig = {},
    fieldName = '',
    idToTitle = {},
    noteId = '',
    notes = [],
    onChange,
    onRruleChange = null,
    planningEnabled = false,
    planningSettings = {},
    rruleValue = '',
    type = 'date',
    value = '',
}: VaultDatePropertyProps) {
    if (type === 'date' || (value !== null && typeof value === 'object' && 'kind' in value)) {
        return <UnifiedDateEditor {...{ fieldConfig, fieldName, idToTitle, noteId, notes, onChange,
            onRruleChange, planningEnabled, planningSettings, rruleValue, type, value }} />;
    }
    if (type === 'period') {
        if (!planningEnabled) {
            return <LegacyPeriodEditor value={value} onChange={onChange} />;
        }
        return (
            <PlanningPeriodEditor
                fieldConfig={fieldConfig}
                fieldName={fieldName}
                idToTitle={idToTitle}
                noteId={noteId}
                notes={notes}
                onChange={onChange}
                planningEnabled={planningEnabled}
                planningSettings={planningSettings}
                value={value}
            />
        );
    }

    return (
        <VaultScalarDateEditor
            fieldConfig={fieldConfig}
            onChange={onChange}
            onRruleChange={onRruleChange}
            rruleValue={rruleValue}
            type={type}
            value={value}
        />
    );
}
