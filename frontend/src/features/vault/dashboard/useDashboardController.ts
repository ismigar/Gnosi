import { useDashboardActions } from './useDashboardActions';
import { useDashboardLifecycle } from './useDashboardLifecycle';
import { useDashboardEvents } from './useDashboardEvents';
import { useResourceProcessing } from './useResourceProcessing';
import { useBrowserHistory } from './useBrowserHistory';
import { useBreadcrumbs } from './useBreadcrumbs';
import { usePageToolbar } from './usePageToolbar';
import { usePaneLayout } from './usePaneLayout';
import { useAgentContext } from './useAgentContext';
export function useDashboardController() {
    const actions = useDashboardActions();
    useDashboardLifecycle(actions);
    useDashboardEvents(actions);
    useResourceProcessing(actions);
    useAgentContext(actions);
    const history = useBrowserHistory(actions.navigate);
    const breadcrumbs = useBreadcrumbs(actions);
    const toolbar = usePageToolbar(actions);
    const layout = usePaneLayout(actions);
    return { ...actions, ...history, ...breadcrumbs, ...toolbar, ...layout };
}
export type DashboardController = ReturnType<typeof useDashboardController>;
