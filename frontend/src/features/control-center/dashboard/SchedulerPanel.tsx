import {Play, Clock, Loader2} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type {DashboardState} from './useDashboard';

export function SchedulerPanel({state}: {state: DashboardState}) {
const {isAdmin, schedulerError, fetchSchedulers, schedulers, schedulerLoading, executingTasks, updateScheduler, runSchedulerNow, t, automationsEnabled, selectedControlTab, formatFrequency, getTaskTitle, getTaskDescription} = state;
const [params, setParams] = useSearchParams();
const selectedTask = params.get('task');
const visibleSchedulers = selectedTask ? schedulers.filter(task => task.name === selectedTask) : schedulers;
return <>{automationsEnabled && selectedControlTab === 'schedulers' && (
                    <div className="w-full">
                        {selectedTask && <div className="ai-resource-card__actions"><button type="button" onClick={() => { setParams({ tab: 'schedulers', kind: 'system' }); }}>{t('activity.show_all_services')}</button></div>}
                        {schedulerError && <div role="alert">{t('dashboard.scheduler_load_error')}: {schedulerError}<button type="button" onClick={() => { void fetchSchedulers(); }}>{t('common.retry')}</button></div>}
                        {schedulerLoading ? (
                            <p className="text-[var(--text-secondary)] py-4 text-center">{t('dashboard.loading_tasks')}</p>
                        ) : visibleSchedulers.length === 0 && !schedulerError ? (
                            <p className="text-[var(--text-secondary)] py-4 text-center">{t(selectedTask ? 'activity.service_unavailable' : 'dashboard.no_tasks')}</p>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 w-full">
                                {visibleSchedulers.map(task => (
                                    <div
                                        key={task.name}
                                        className={`p-5 rounded-xl border transition-all h-full flex flex-col ${
                                            task.enabled
                                                ? 'border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-sm'
                                                : 'border-[var(--border-primary)] bg-[var(--bg-primary)] opacity-75'
                                        }`}
                                    >
                                        <div className="flex-1">
                                            <h3 className="text-sm font-semibold text-[var(--text-primary)] tracking-wide">
                                                {getTaskTitle(task)}
                                            </h3>
                                            <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                                                {getTaskDescription(task)}
                                            </p>
                                            <p className="text-xs text-[var(--text-secondary)] mt-2.5 flex items-center gap-1.5">
                                                <Clock size={12} className="text-[var(--text-tertiary)]" aria-hidden="true" />
                                                {formatFrequency(task)}
                                            </p>
                                            {task.last_run && (
                                                <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                                                    {t('dashboard.last_run')}: {new Date(task.last_run).toLocaleString()}
                                                </p>
                                            )}
                                        </div>

                                        <div className="mt-4 pt-3 border-t border-[var(--border-primary)] flex flex-wrap items-center justify-between gap-3">
                                            <div className="flex items-center gap-2.5">
                                                <label className="relative inline-flex items-center cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        disabled={!isAdmin}
                                                        checked={task.enabled}
                                                        onChange={(e) => { void updateScheduler(task, { enabled: e.target.checked }); }}
                                                        aria-label={t('dashboard.toggle_task', 'Toggle {{task}}', { task: getTaskTitle(task) })}
                                                    />
                                                    <div className="w-9 h-5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-4 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--gnosi-blue)] peer-checked:border-[var(--gnosi-blue)]"></div>
                                                </label>
                                                <span className="text-xs text-[var(--text-secondary)] font-medium">
                                                    {task.enabled ? t('dashboard.active') : t('dashboard.inactive')}
                                                </span>

                                                {typeof task.interval_minutes === 'number' && (
                                                    <select
                                                        className="text-xs bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] rounded-lg px-2.5 py-1.5 focus:border-[var(--gnosi-blue)] outline-none"
                                                        disabled={!isAdmin}
                                                        value={task.interval_minutes}
                                                        onChange={(e) => { void updateScheduler(task, { interval_minutes: Number(e.target.value) }); }}
                                                        aria-label={t('dashboard.task_interval_label', 'Interval for {{task}}', { task: getTaskTitle(task) })}
                                                    >
                                                        {![15, 30, 45, 60, 90, 120, 180, 300, 360, 720, 1440, 10080].includes(task.interval_minutes) && <option value={task.interval_minutes}>{formatFrequency(task)}</option>}
                                                        <option value={15}>{t('dashboard.time_15_min')}</option>
                                                        <option value={30}>{t('dashboard.time_30_min')}</option>
                                                        <option value={45}>{t('dashboard.time_45_min')}</option>
                                                        <option value={60}>{t('dashboard.time_1_hour')}</option>
                                                        <option value={90}>{t('dashboard.time_1_5_hours')}</option>
                                                        <option value={120}>{t('dashboard.time_2_hours')}</option>
                                                        <option value={180}>{t('dashboard.time_3_hours')}</option>
                                                        <option value={300}>{t('dashboard.time_5_hours')}</option>
                                                        <option value={360}>{t('dashboard.time_6_hours')}</option>
                                                        <option value={720}>{t('dashboard.time_12_hours')}</option>
                                                        <option value={1440}>{t('dashboard.time_1_day')}</option>
                                                        <option value={10080}>{t('dashboard.time_1_week')}</option>
                                                    </select>
                                                )}
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => { void runSchedulerNow(task.name); }}
                                                disabled={!isAdmin || executingTasks.has(task.name)}
                                                className="btn-gnosi btn-gnosi-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5 ml-auto"
                                            >
                                                {executingTasks.has(task.name) ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                ) : (
                                                    <Play size={12} />
                                                )}
                                                {t('dashboard.run_now')}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}</>;
}
