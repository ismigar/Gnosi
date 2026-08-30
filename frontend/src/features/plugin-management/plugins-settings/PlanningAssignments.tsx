import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SELECT_STYLE, stringSetting } from './pluginSettingsModel';
import type { ProjectPlanningController } from './projectPlanningModel';

interface PlanningAssignmentsProps {
    readonly controller: ProjectPlanningController;
}

export function PlanningAssignments({ controller }: PlanningAssignmentsProps) {
    const { t } = useTranslation();
    const tp = (key: string, fallback: string, values: Readonly<Record<string, unknown>> = {}): string => (
        t(`settings.plugins.${key}`, { defaultValue: fallback, ...values })
    );
    const state = controller.planningState;
    const resources = state?.resources ?? [];
    const assignments = state?.assignments ?? [];
    const warnings = state?.allocation.warnings ?? [];
    const draft = controller.assignmentDraft;

    return (
        <>
            <div style={{ color: 'var(--text-primary, #0f172a)', fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                {tp('planning_assignments_title', 'Assignments')}
            </div>
            <div style={{ background: 'var(--bg-secondary, #f8fafc)', borderRadius: 8, color: 'var(--text-secondary, #475569)', fontSize: 12, lineHeight: 1.45, padding: '8px 10px' }}>
                {tp('planning_assignments_intro', 'An assignment links one resource to one task in a project. Planned hours and dates calculate workload, cost, and capacity warnings; they do not move or edit the task.')}
            </div>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                <select style={SELECT_STYLE} value={draft.project_id} aria-label={tp('planning_select_project', 'Select project')} onChange={(event) => { controller.setAssignmentDraft({ ...draft, project_id: event.target.value }); }}>
                    <option value="">{tp('planning_select_project', 'Select project')}</option>
                    {controller.sortedProjects.map((project) => <option key={project.id} value={project.id}>{project.title || project.id}</option>)}
                </select>
                <select style={SELECT_STYLE} value={draft.task_id} aria-label={tp('planning_select_task', 'Select task')} onChange={(event) => { controller.setAssignmentDraft({ ...draft, task_id: event.target.value }); }}>
                    <option value="">{tp('planning_select_task', 'Select task')}</option>
                    {controller.sortedTasks.map((task) => <option key={task.id} value={task.id}>{task.title || task.id}</option>)}
                </select>
                <select style={SELECT_STYLE} value={draft.resource_id} aria-label={tp('planning_select_resource', 'Select resource')} onChange={(event) => { controller.setAssignmentDraft({ ...draft, resource_id: event.target.value }); }}>
                    <option value="">{tp('planning_select_resource', 'Select resource')}</option>
                    {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                </select>
                <input type="number" min="0" step="0.25" style={SELECT_STYLE} value={draft.planned_work_hours} title={tp('planning_assignment_hours', 'Planned hours')} onChange={(event) => { controller.setAssignmentDraft({ ...draft, planned_work_hours: event.target.value }); }} />
                <input type="datetime-local" style={SELECT_STYLE} value={draft.start} title={tp('planning_assignment_start', 'Assignment start')} onChange={(event) => { controller.setAssignmentDraft({ ...draft, start: event.target.value }); }} />
                <input type="datetime-local" style={SELECT_STYLE} value={draft.end} title={tp('planning_assignment_end', 'Assignment end')} onChange={(event) => { controller.setAssignmentDraft({ ...draft, end: event.target.value }); }} />
                <button
                    type="button" className="btn-gnosi btn-gnosi-primary"
                    disabled={!draft.task_id || !draft.resource_id || (Boolean(stringSetting(controller.config, 'project_table_id')) && !draft.project_id)}
                    onClick={() => { void controller.createAssignment(); }}
                >{tp('planning_add_assignment', 'Add assignment')}</button>
            </div>
            {!controller.planningLoading && assignments.map((assignment) => (
                <div key={assignment.id} style={{ alignItems: 'center', display: 'flex', fontSize: 12, gap: 8, justifyContent: 'space-between' }}>
                    <span>
                        {controller.projectPages.find((project) => project.id === assignment.project_id)?.title || assignment.project_id || tp('planning_project_not_set', 'Project not set')}
                        {' · '}
                        {controller.taskPages.find((task) => task.id === assignment.task_id)?.title || assignment.task_id}
                        {' · '}
                        {resources.find((resource) => resource.id === assignment.resource_id)?.name || assignment.resource_id}
                        {' · '}{assignment.planned_work_hours} h
                    </span>
                    <button type="button" className="btn-gnosi btn-gnosi-secondary" style={{ padding: '6px 8px' }} aria-label={tp('planning_delete_assignment', 'Delete assignment')} title={tp('planning_delete_assignment', 'Delete assignment')} onClick={() => { void controller.deleteAssignment(assignment.id); }}><Trash2 size={14} /></button>
                </div>
            ))}
            {!controller.planningLoading && warnings.map((warning) => (
                <div key={`${warning.resource_id}-${warning.date}`} style={{ color: '#b45309', fontSize: 12 }}>{warning.message}</div>
            ))}
            <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={warnings.length === 0} onClick={() => { void controller.previewLeveling(); }}>{tp('planning_preview_leveling', 'Preview leveling')}</button>
                <span style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 11 }}>{tp('planning_leveling_review_only', 'Suggestions never change task dates automatically.')}</span>
            </div>
            {(controller.levelingProposal?.proposals ?? []).map((proposal) => (
                <div key={proposal.id} style={{ color: 'var(--text-secondary, #475569)', fontSize: 12 }}>
                    {tp('planning_leveling_proposal', 'Move task {{task}} to {{start}} after reviewing the proposal.', { start: proposal.suggested_start, task: proposal.task_id })}
                </div>
            ))}
            {controller.levelingProposal && controller.levelingProposal.proposals.length === 0 && (
                <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>{tp('planning_no_leveling_proposal', 'No dated assignment can be safely proposed for leveling.')}</div>
            )}
            {!controller.planningLoading && state && (
                <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>
                    {tp('planning_estimated_cost', 'Estimated assignment cost: {{cost}}', { cost: state.allocation.total_estimated_cost })}
                </div>
            )}
            {controller.planningError && <div style={{ color: '#dc2626', fontSize: 12 }}>{controller.planningError}</div>}
        </>
    );
}
