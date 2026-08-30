import {RefreshCw, Activity, Clock, Loader2, Trash2} from 'lucide-react';
import {DashboardPaginationControls} from '../../components/DashboardPaginationControls';
import type {DashboardState} from './useDashboard';

export function HistoryPanel({state}: {state: DashboardState}) {
const {taskHistory, taskHistoryTotal, taskHistoryPage, taskHistoryLoading, HISTORY_LIMIT, fetchTaskHistory, handlePurgeHistory, t, automationsEnabled, selectedControlTab, notifications, notificationsLoading, notifTotal, notifPage, setNotifPage, refetchNotifications, NOTIF_LIMIT, handlePurgeLogs} = state;
return <>{automationsEnabled && selectedControlTab === 'history' && (
                    <>
                        <div className="grid grid-cols-1 gap-8">
                            <div className="glass-panel p-6 rounded-2xl border border-[var(--border-primary)]">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest flex items-center gap-2">
                                        <Clock size={14} className="text-blue-500" />
                                        {t('dashboard.latest_scheduled_runs')}
                                    </h3>
                                    <button
                                        onClick={handlePurgeHistory}
                                        className="text-[10px] flex items-center gap-1 text-red-400 hover:bg-red-500/10 px-2 py-1 rounded transition-all"
                                    >
                                        <Trash2 size={12} />
                                        {t('dashboard.purge_history')}
                                    </button>
                                </div>
                                <div className="space-y-2">
                                    {taskHistoryLoading && taskHistory.length === 0 ? (
                                        <p className="text-center py-10"><Loader2 className="animate-spin mx-auto text-blue-500" /></p>
                                    ) : taskHistory.length === 0 ? (
                                        <p className="text-sm text-gray-500 py-10 text-center italic">{t('dashboard.no_runs_recorded')}</p>
                                    ) : (
                                        taskHistory.map(history => (
                                            <div key={history.id} className={`border border-[var(--border-primary)] rounded-lg p-3 bg-[var(--bg-tertiary)] flex items-center justify-between group hover:border-${history.status === 'error' ? 'red' : 'cyan'}-500/30 transition-all`}>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-cyan-400 transition-colors">{history.task_name.replace(/_/g, ' ')}</p>
                                                        {history.status === 'running' && <Loader2 size={10} className="animate-spin text-blue-400" />}
                                                    </div>
                                                    <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                                                        {new Date(history.started_at ?? 0).toLocaleString()}
                                                        {history.duration_seconds && ` • ${history.duration_seconds.toFixed(1)}s`}
                                                    </p>
                                                    {history.message && <p className="text-[10px] text-[var(--text-secondary)] mt-1 italic line-clamp-1">{history.message}</p>}
                                                </div>
                                                <div className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                                    history.status === 'success' ? 'bg-green-500/10 text-green-500' :
                                                    history.status === 'error' ? 'bg-red-500/10 text-red-500' :
                                                    'bg-blue-500/10 text-blue-500'
                                                }`}>
                                                    {history.status.toUpperCase()}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <DashboardPaginationControls
                                    total={taskHistoryTotal}
                                    limit={HISTORY_LIMIT}
                                    page={taskHistoryPage}
                                    onPageChange={(page) => { void fetchTaskHistory(page); }}
                                    loading={taskHistoryLoading}
                                />
                            </div>
                        </div>

                            <div className="mt-8 glass-panel p-6 rounded-2xl border border-[var(--border-primary)]">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-gray-500 text-xs uppercase font-bold tracking-widest flex items-center gap-2">
                                        <Activity size={14} className="text-blue-500" />
                                        {t('dashboard.system_logs', "System Logs")}
                                        <span className="text-[10px] text-blue-500 bg-blue-500/10 px-2 py-0.5 rounded-full">{notifTotal} {t('common.entries', "entries")}</span>
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => void refetchNotifications()}
                                            className="p-1 hover:bg-blue-500/10 text-blue-400 rounded transition-all"
                                            title={t('dashboard.refresh_logs')}
                                        >
                                            <RefreshCw size={14} className={notificationsLoading ? "animate-spin" : ""} />
                                        </button>
                                        <button
                                            onClick={handlePurgeLogs}
                                            className="text-[10px] flex items-center gap-1 text-red-400 hover:bg-red-500/10 px-2 py-1 rounded transition-all border border-red-500/10"
                                        >
                                            <Trash2 size={12} />
                                            {t('dashboard.purge_logs')}
                                        </button>
                                    </div>
                                </div>

                            {notificationsLoading && notifications.length === 0 ? (
                                <p className="text-gray-400">{t('dashboard.loading_logs', "Loading logs...")}</p>
                            ) : notifications.length === 0 ? (
                                <p className="text-gray-500 italic">{t('dashboard.no_logs', "There are no recorded logs.")}</p>
                            ) : (
                                <>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                            <thead>
                                                <tr className="border-b border-[var(--border-primary)] text-[var(--text-secondary)] font-bold">
                                                    <th className="pb-2 w-32">{t('common.time', "Time")}</th>
                                                    <th className="pb-2 w-20">{t('common.level', "Level")}</th>
                                                    <th className="pb-2">{t('common.event', "Event")}</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--border-primary)]">
                                                {notifications.map(notif => (
                                                    <tr key={notif.id} className="hover:bg-[var(--bg-tertiary)] transition-colors">
                                                        <td className="py-2 text-gray-400 font-mono">
                                                            {new Date(notif.created_at).toLocaleString([], {
                                                                day: '2-digit',
                                                                month: '2-digit',
                                                                year: '2-digit',
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                                second: '2-digit'
                                                            })}
                                                        </td>
                                                        <td className="py-2">
                                                            <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[9px] ${
                                                                notif.level === 'ERROR' ? 'bg-red-500/20 text-red-400' :
                                                                notif.level === 'WARNING' ? 'bg-yellow-500/20 text-yellow-500' :
                                                                notif.level === 'SUCCESS' ? 'bg-green-500/20 text-green-400' :
                                                                'bg-blue-500/20 text-blue-400'
                                                            }`}>
                                                                {notif.level}
                                                            </span>
                                                        </td>
                                                        <td className="py-2">
                                                            <div className="font-bold text-[var(--text-primary)]">{notif.title}</div>
                                                            <div className="text-[var(--text-secondary)] mt-0.5">{notif.message}</div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <DashboardPaginationControls
                                        total={notifTotal}
                                        limit={NOTIF_LIMIT}
                                        page={notifPage}
                                        onPageChange={setNotifPage}
                                        loading={notificationsLoading}
                                    />
                                </>
                            )}
                        </div>
                    </>
                )}</>;
}
