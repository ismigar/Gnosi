import { LegacyPeriodEditor } from './LegacyPeriodEditor';
import { PlanningPeriodEditor } from './PlanningPeriodEditor';
import type { VaultDatePropertyProps } from './types';
import { VaultScalarDateEditor } from './VaultScalarDateEditor';

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
            onChange={onChange}
            onRruleChange={onRruleChange}
            rruleValue={rruleValue}
            type={type}
            value={value}
        />
    );
}
