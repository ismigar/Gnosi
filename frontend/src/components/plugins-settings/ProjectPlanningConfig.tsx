import { PlanningAssignments } from './PlanningAssignments';
import { PlanningCalendarsResources } from './PlanningCalendarsResources';
import { ProjectPlanningBasics } from './ProjectPlanningBasics';
import { useProjectPlanningController } from './useProjectPlanningController';

export function ProjectPlanningConfig() {
    const controller = useProjectPlanningController();
    return (
        <div style={{
            background: 'var(--bg-primary, #fff)', border: '1px dashed var(--border-primary, #e2e8f0)',
            borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 12,
            marginTop: 8, padding: '12px 14px',
        }}>
            <ProjectPlanningBasics controller={controller} />
            <div style={{ borderTop: '1px solid var(--border-primary, #e2e8f0)', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12 }}>
                <PlanningCalendarsResources controller={controller} />
                <PlanningAssignments controller={controller} />
            </div>
        </div>
    );
}
