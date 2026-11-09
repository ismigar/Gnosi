interface DashboardCandidate {
    readonly folder?: string | null;
    readonly metadata?: { readonly is_dashboard?: unknown } | null;
}

/** Keep current and legacy Dashboard storage consistent across navigation. */
export function isDashboardPage(page: DashboardCandidate | null | undefined): boolean {
    const folder = page?.folder ?? '';
    return page?.metadata?.is_dashboard === true
        || folder === 'Dashboard' || folder.startsWith('Dashboard/')
        || folder === '.Dashboards' || folder.startsWith('.Dashboards/');
}
