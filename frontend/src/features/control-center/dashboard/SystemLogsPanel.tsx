import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';
import type { DashboardState } from './useDashboard';
import { DashboardPaginationControls } from './DashboardPaginationControls';

export function SystemLogsPanel({ state }: { readonly state: DashboardState }) {
    const { t, notifications, notificationsLoading, notificationsError, notifTotal, notifPage, setNotifPage, NOTIF_LIMIT, refetchNotifications, handlePurgeLogs } = state;
    return <section>
        <div className="flex items-center justify-between"><h3>{t('dashboard.system_logs')}</h3><RefreshButton loading={notificationsLoading} label={t('dashboard.refresh_logs')} onClick={() => { void refetchNotifications(); }} /></div>
        <div className="ai-resource-card__actions">
            
            {state.isAdmin && <button type="button" onClick={handlePurgeLogs}>{t('dashboard.purge_logs')}</button>}
        </div>
        {notificationsError && <p role="alert">{String(notificationsError)}</p>}
        {notificationsLoading && <p role="status">{t('dashboard.loading_logs')}</p>}
        {notifications.map(item => <details key={item.id} className="ai-resource-details"><summary>{item.title} · {new Date(item.created_at).toLocaleString()}</summary><p>{item.message}</p><span>{item.level}</span></details>)}
        {!notificationsLoading && !notificationsError && notifications.length === 0 && <p>{t('dashboard.no_logs')}</p>}
        <DashboardPaginationControls total={notifTotal} limit={NOTIF_LIMIT} page={notifPage} onPageChange={setNotifPage} loading={notificationsLoading} />
    </section>;
}
