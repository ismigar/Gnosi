import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SELECT_STYLE } from './pluginSettingsModel';
import type { ProjectPlanningController } from './projectPlanningModel';

interface PlanningCalendarsResourcesProps {
    readonly controller: ProjectPlanningController;
}

export function PlanningCalendarsResources({ controller }: PlanningCalendarsResourcesProps) {
    const { t } = useTranslation();
    const tp = (key: string, fallback: string): string => t(`settings.plugins.${key}`, { defaultValue: fallback });
    const calendars = controller.planningState?.calendars ?? [];
    const resources = controller.planningState?.resources ?? [];
    const draft = controller.resourceDraft;

    return (
        <>
            <div style={{ color: 'var(--text-primary, #0f172a)', fontSize: 12, fontWeight: 700 }}>
                {tp('planning_calendars_title', 'Resource calendars')}
            </div>
            <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>
                {tp('planning_calendars_intro', 'Project default is the base calendar for the project and for resources without their own calendar. Create another calendar when a resource follows a different schedule.')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
                <input
                    style={SELECT_STYLE}
                    value={controller.calendarDraft}
                    placeholder={tp('planning_calendar_name', 'Calendar name')}
                    onChange={(event) => {
                        controller.setCalendarDraft(event.target.value);
                    }}
                />
                <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!controller.calendarDraft.trim()} onClick={() => { void controller.createCalendar(); }}>
                    {tp('planning_add_calendar', 'Add calendar')}
                </button>
            </div>
            {!controller.planningLoading && calendars.map((calendar) => (
                <div key={calendar.id} style={{ alignItems: 'center', display: 'flex', fontSize: 12, gap: 8, justifyContent: 'space-between' }}>
                    <span>
                        {calendar.id === 'project-default'
                            ? tp('planning_project_default_calendar', 'Project default (base calendar)')
                            : calendar.name} · {calendar.hours_per_day} h/{tp('planning_day', 'day')}
                    </span>
                    {calendar.id !== 'project-default' && (
                        <button type="button" className="btn-gnosi btn-gnosi-secondary" style={{ padding: '6px 8px' }} aria-label={tp('planning_delete_calendar', 'Delete calendar')} title={tp('planning_delete_calendar', 'Delete calendar')} onClick={() => { void controller.deleteCalendar(calendar.id); }}><Trash2 size={14} /></button>
                    )}
                </div>
            ))}
            <div style={{ color: 'var(--text-primary, #0f172a)', fontSize: 12, fontWeight: 700 }}>
                {tp('planning_resources_title', 'Resource pool')}
            </div>
            <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>
                {tp('planning_resources_intro', 'Define the people, teams, materials, or costs that can be used by assignments. Availability, rates, and calendars are used to calculate workload and capacity warnings; tasks are never moved automatically.')}
            </div>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 1fr) 100px minmax(120px, 1fr) 75px 90px' }}>
                <input
                    style={SELECT_STYLE}
                    value={draft.name ?? ''}
                    placeholder={tp('planning_resource_name', 'Resource name')}
                    onChange={(event) => {
                        controller.setResourceDraft({ ...draft, name: event.target.value });
                    }}
                />
                <select
                    style={SELECT_STYLE}
                    value={draft.type ?? 'work'}
                    onChange={(event) => {
                        controller.setResourceDraft({ ...draft, type: event.target.value });
                    }}
                >
                    <option value="work">{tp('planning_resource_work', 'Work')}</option>
                    <option value="material">{tp('planning_resource_material', 'Material')}</option>
                    <option value="cost">{tp('planning_resource_cost', 'Cost')}</option>
                </select>
                <select
                    style={SELECT_STYLE}
                    disabled={draft.type !== 'work'}
                    value={draft.calendar_id ?? 'project-default'}
                    onChange={(event) => {
                        controller.setResourceDraft({ ...draft, calendar_id: event.target.value });
                    }}
                >
                    {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
                </select>
                <input
                    type="number" min="1" max="1000" style={SELECT_STYLE}
                    value={draft.availability_units ?? 100}
                    title={tp('planning_resource_capacity', 'Availability (%)')}
                    onChange={(event) => {
                        controller.setResourceDraft({ ...draft, availability_units: Number(event.target.value) || 100 });
                    }}
                />
                <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!(draft.name ?? '').trim()} onClick={() => { void controller.createResource(); }}>
                    {tp('planning_add_resource', 'Add')}
                </button>
            </div>
            {!controller.planningLoading && resources.map((resource) => (
                <div key={resource.id} style={{ alignItems: 'center', display: 'flex', fontSize: 12, gap: 8, justifyContent: 'space-between' }}>
                    <span>{resource.name} · {resource.type} · {resource.availability_units}% · {resource.standard_rate}/h</span>
                    <button type="button" className="btn-gnosi btn-gnosi-secondary" style={{ padding: '6px 8px' }} aria-label={tp('planning_delete_resource', 'Delete resource')} title={tp('planning_delete_resource', 'Delete resource')} onClick={() => { void controller.deleteResource(resource.id); }}><Trash2 size={14} /></button>
                </div>
            ))}
            {!controller.planningLoading && resources.length === 0 && (
                <span style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>{tp('planning_no_resources', 'No resources yet.')}</span>
            )}
        </>
    );
}
