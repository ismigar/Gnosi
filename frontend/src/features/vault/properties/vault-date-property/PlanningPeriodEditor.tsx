import { useLocaleSettings } from '../../../../shared/i18n/useLocaleSettings';
import { PlanningConstraints } from './PlanningConstraints';
import { PlanningPeriodDates } from './PlanningPeriodDates';
import { PlanningPeriodSummary } from './PlanningPeriodSummary';
import { PlanningPredecessorPicker } from './PlanningPredecessorPicker';
import { createPlanningPeriodModel } from './planningModel';
import type { PeriodEditorProps } from './types';

export function PlanningPeriodEditor(props: PeriodEditorProps) {
    const { dateLocale, dateFormat } = useLocaleSettings();
    const model = createPlanningPeriodModel(props, dateLocale, props.fieldConfig.format?.dateFormat || dateFormat);

    return (
        <div className="grid min-w-0 grid-cols-2 gap-2 p-1 text-xs">
            <PlanningPeriodDates model={model} />
            {model.predecessorsEnabled && (
                <PlanningPredecessorPicker
                    idToTitle={props.idToTitle}
                    model={model}
                />
            )}
            <PlanningPeriodSummary
                idToTitle={props.idToTitle}
                model={model}
            />
            {model.hasPredecessors && <PlanningConstraints model={model} />}
        </div>
    );
}
