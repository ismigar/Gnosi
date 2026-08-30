import type {TFunction} from 'i18next';
import type {DirectiveAnalytics} from '../../shared/api/analytics';
import type {ScheduledTask} from '../../shared/api/scheduler';
import type {WorkspaceMember} from '../../shared/api/workspace-members';

// Older directive providers supplied these optional display-only fields.
export type DashboardDirective = DirectiveAnalytics & {
    approved_at?: string;
    created_at?: string;
    description?: string;
};
export type DashboardMember = Omit<WorkspaceMember, 'permissions'> & {
    permissions?: (Record<string, unknown> & {capabilities?: string[]}) | null;
};
export const ROLE_CAPABILITIES: Readonly<Record<string, string[]>> = {
    viewer: ['read'], editor: ['read', 'write'],
    admin: ['read', 'write', 'delete', 'admin', 'analytics', 'tools'],
    owner: ['read', 'write', 'delete', 'admin', 'analytics', 'tools'],
};
export function normalizeMember(member: WorkspaceMember): DashboardMember {
    if (!member.permissions) return {...member, permissions: member.permissions};
    const capabilities = member.permissions.capabilities;
    return {...member, permissions: {...member.permissions,
        capabilities: Array.isArray(capabilities)
            ? capabilities.filter((value): value is string => typeof value === 'string')
            : undefined,
    }};
}
export function formatFrequency(task: Pick<ScheduledTask, 'interval_minutes'> & {interval?: number}, t: TFunction) {
    if (typeof task.interval_minutes === 'number' && task.interval_minutes > 0) {
        if (task.interval_minutes % 1440 === 0) return t('dashboard.frequency_days', {count: task.interval_minutes / 1440});
        if (task.interval_minutes % 60 === 0) return t('dashboard.frequency_hours', {count: task.interval_minutes / 60});
        const hours = task.interval_minutes / 60;
        if (hours > 1 && Number.isFinite(hours)) return t('dashboard.frequency_hours', {count: Math.round(hours * 100) / 100});
        return t('dashboard.frequency_minutes', {count: Math.round(task.interval_minutes)});
    }
    if (typeof task.interval === 'number' && task.interval > 0) return t('dashboard.frequency_seconds', {count: task.interval});
    return t('dashboard.frequency_none');
}
