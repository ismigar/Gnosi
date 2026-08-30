import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Clock, Edit2, RefreshCw, X } from 'lucide-react';

import { AppHeader } from '../../shared/ui/layout/AppHeader';
import { logError } from '../../lib/notifyError';
import type { ScheduledTask } from '../../shared/api/scheduler';
import {
  useScheduledTasks,
  useUpdateScheduledTask,
} from '../../shared/api/useSchedulerTasks';
import {
  formatTaskInterval,
  hoursToMinutes,
  minutesToHours,
} from './schedulerPageUtils';


/** Manage background scheduler tasks and their execution interval. */
export default function SchedulerPage() {
  const { t } = useTranslation();
  const [editingInterval, setEditingInterval] = useState<Record<string, string>>(
    {},
  );
  const {
    data: schedulers = [],
    error: loadError,
    isLoading,
    refetch,
  } = useScheduledTasks();
  const updateTask = useUpdateScheduledTask();

  const toggleTask = async (task: ScheduledTask): Promise<void> => {
    try {
      await updateTask.mutateAsync({
        name: task.name,
        update: {
          enabled: !task.enabled,
          interval_minutes: task.interval_minutes,
        },
      });
    } catch (error: unknown) {
      logError('scheduler-toggle-task', error);
    }
  };

  const startEditingInterval = (task: ScheduledTask): void => {
    setEditingInterval((current) => ({
      ...current,
      [task.name]: minutesToHours(task.interval_minutes),
    }));
  };

  const cancelEditingInterval = (taskName: string): void => {
    setEditingInterval((current) => Object.fromEntries(
      Object.entries(current).filter(([name]) => name !== taskName),
    ));
  };

  const saveInterval = async (task: ScheduledTask): Promise<void> => {
    const newMinutes = hoursToMinutes(editingInterval[task.name]);
    if (newMinutes === null) return;
    try {
      await updateTask.mutateAsync({
        name: task.name,
        update: { enabled: task.enabled, interval_minutes: newMinutes },
      });
      cancelEditingInterval(task.name);
    } catch (error: unknown) {
      logError('scheduler-save-interval', error);
    }
  };

  const handleIntervalKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    task: ScheduledTask,
  ): void => {
    if (event.key === 'Enter') void saveInterval(task);
    else if (event.key === 'Escape') cancelEditingInterval(task.name);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <AppHeader
        icon={Clock}
        title={t('scheduler.title', 'Task scheduler')}
        subtitle={t(
          'scheduler.subtitle',
          "Manage Gnosi's automations and background tasks.",
        )}
      />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4">
          {loadError
            ? (
                <div className="gnosi-panel flex flex-col items-center justify-center gap-3 p-8 text-[var(--text-secondary)]" role="alert">
                  <AlertCircle size={24} className="text-red-400" />
                  <span>
                    {t(
                      'scheduler.load_error',
                      'The scheduled tasks could not be loaded.',
                    )}
                  </span>
                  <button
                    type="button"
                    className="gnosi-button-secondary"
                    onClick={() => {
                      void refetch();
                    }}
                  >
                    {t('common.retry', 'Retry')}
                  </button>
                </div>
              )
            : isLoading
              ? (
                  <div className="gnosi-panel flex items-center justify-center gap-3 p-8 text-[var(--text-secondary)]" role="status" aria-live="polite">
                    <RefreshCw className="animate-spin" size={20} />
                    <span>{t('dashboard.loading_tasks', 'Loading tasks...')}</span>
                  </div>
                )
              : schedulers.length > 0
                ? schedulers.map((task) => {
                    const isEditing = task.name in editingInterval;
                    const intervalDisplay = formatTaskInterval(task.interval_minutes);
                    return (
                      <div
                        key={task.name}
                        className="gnosi-panel group flex items-center justify-between gap-4 p-5 transition-all hover:border-[var(--gnosi-blue)]"
                      >
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="text-lg font-bold text-[var(--text-primary)] transition-colors group-hover:text-[var(--gnosi-blue)]">
                              {task.name.replace(/_/g, ' ')}
                            </h3>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider ${task.enabled ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                              {task.enabled
                                ? t('dashboard.active', 'Active')
                                : t('dashboard.inactive', 'Inactive')}
                            </span>
                          </div>
                          <p className="max-w-xl text-sm text-[var(--text-secondary)]">
                            {task.description}
                          </p>
                          {intervalDisplay && (
                            <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                              <Clock size={12} />
                              {isEditing
                                ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        min={0.0167}
                                        step={0.25}
                                        value={editingInterval[task.name]}
                                        onChange={(event) => {
                                          setEditingInterval((current) => ({
                                            ...current,
                                            [task.name]: event.target.value,
                                          }));
                                        }}
                                        onKeyDown={(event) => {
                                          handleIntervalKeyDown(event, task);
                                        }}
                                        autoFocus
                                        className="w-20 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-0.5 text-xs text-[var(--text-primary)] focus:border-[var(--gnosi-blue)] focus:outline-none"
                                      />
                                      <span className="text-[var(--text-secondary)]">h</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void saveInterval(task);
                                        }}
                                        className="text-green-400 hover:text-green-300 ml-1"
                                      >
                                        <Check size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          cancelEditingInterval(task.name);
                                        }}
                                        className="text-red-400 hover:text-red-300"
                                      >
                                        <X size={12} />
                                      </button>
                                    </div>
                                  )
                                : (
                                    <div className="flex items-center gap-1">
                                      <span>
                                        {t(
                                          'scheduler.interval_label',
                                          'Interval: {{value}}',
                                          { value: intervalDisplay },
                                        )}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          startEditingInterval(task);
                                        }}
                                        className="ml-1 text-[var(--text-secondary)] transition-opacity hover:text-[var(--gnosi-blue)] sm:opacity-0 sm:group-hover:opacity-100"
                                        aria-label={t('common.edit', 'Edit')}
                                      >
                                        <Edit2 size={11} />
                                      </button>
                                    </div>
                                  )}
                            </div>
                          )}
                        </div>

                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={task.enabled}
                            onChange={() => {
                              void toggleTask(task);
                            }}
                          />
                          <div className="peer h-6 w-11 rounded-full bg-[var(--border-primary)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--gnosi-blue)]/30 peer-checked:bg-[var(--gnosi-blue)] peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full after:absolute after:start-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-['']" />
                        </label>
                      </div>
                    );
                  })
                : (
                    <div className="gnosi-panel p-12 text-center">
                      <AlertCircle className="mx-auto mb-4 text-[var(--text-tertiary)]" size={48} />
                      <p className="text-[var(--text-secondary)]">
                        {t('scheduler.no_tasks', 'No scheduled tasks found.')}
                      </p>
                    </div>
                  )}
        </div>
      </div>
    </div>
  );
}
