export interface SharePermission {
    readonly id: string;
    readonly label: string;
}


export const SHARE_PERMISSIONS: readonly SharePermission[] = [
    { id: 'view', label: 'Lectura' },
    { id: 'comment', label: 'Comentar' },
    { id: 'edit', label: 'Edició' },
];


export function sharePublicUrl(origin: string, token: string): string {
    return `${origin.replace(/\/$/u, '')}/s/${token}`;
}


export function shareExpirationDays(value: string): number | undefined {
    const days = Number.parseInt(value, 10);
    return Number.isNaN(days) || days <= 0 ? undefined : days;
}
