import { useRef } from 'react';
import type { DragEvent, SyntheticEvent } from 'react';
import {
    AlertCircle,
    Check,
    Mail,
    Plus,
    RefreshCw,
    Rss,
    Trash2,
    Upload,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReaderSource } from '../../../../shared/api/reader';
import type { ScheduledTask } from '../../../../shared/api/scheduler';
import { taskInterval } from './feedManagerModel';


export interface FeedSourcesViewProps {
    readonly loading: boolean;
    readonly newsletters: ReaderSource[];
    readonly onDelete: (id: number) => void;
    readonly rss: ReaderSource[];
    readonly sourceCount: number;
}


export function FeedSourcesView({
    loading,
    newsletters,
    onDelete,
    rss,
    sourceCount,
}: FeedSourcesViewProps) {
    const { t } = useTranslation();
    return (
        <div className="feed-sources">
            {loading ? (
                <p className="feed-empty">{t('common.loading')}</p>
            ) : sourceCount === 0 ? (
                <p className="feed-empty">
                    {t(
                        'feed_manager.empty_sources',
                        'No sources configured. Add RSS feeds or import an OPML file.',
                    )}
                </p>
            ) : (
                <>
                    {rss.length > 0 && (
                        <div className="feed-source-group">
                            <h3 className="feed-source-group__title">
                                <Rss size={14} />{' '}
                                {t('feed_manager.rss_count', 'RSS ({{count}})', {
                                    count: rss.length,
                                })}
                            </h3>
                            {rss.map((source) => (
                                <div key={source.id} className="feed-source-row">
                                    <div className="feed-source-info">
                                        <span className="feed-source-name">
                                            {source.name}
                                        </span>
                                        <span className="feed-source-meta">
                                            {source.category} · {source.url.substring(0, 50)}...
                                        </span>
                                    </div>
                                    <button
                                        className="feed-source-delete"
                                        onClick={() => {
                                            onDelete(source.id);
                                        }}
                                        title={t('common.delete')}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    {newsletters.length > 0 && (
                        <div className="feed-source-group">
                            <h3 className="feed-source-group__title">
                                <Mail size={14} />{' '}
                                {t(
                                    'feed_manager.newsletters_count',
                                    'Newsletters ({{count}})',
                                    { count: newsletters.length },
                                )}
                            </h3>
                            {newsletters.map((source) => (
                                <div key={source.id} className="feed-source-row">
                                    <div className="feed-source-info">
                                        <span className="feed-source-name">
                                            {source.name}
                                        </span>
                                        <span className="feed-source-meta">
                                            {source.url}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}


export interface FeedAddViewProps {
    readonly addLoading: boolean;
    readonly category: string;
    readonly name: string;
    readonly onCategoryChange: (value: string) => void;
    readonly onImportOpml: (file: File | null) => Promise<void>;
    readonly onNameChange: (value: string) => void;
    readonly onSubmit: (
        event: SyntheticEvent<HTMLFormElement>,
    ) => Promise<void>;
    readonly onUrlChange: (value: string) => void;
    readonly url: string;
}


export function FeedAddView({
    addLoading,
    category,
    name,
    onCategoryChange,
    onImportOpml,
    onNameChange,
    onSubmit,
    onUrlChange,
    url,
}: FeedAddViewProps) {
    const { t } = useTranslation();
    const fileRef = useRef<HTMLInputElement | null>(null);
    const onDrop = (event: DragEvent<HTMLDivElement>): void => {
        event.preventDefault();
        event.currentTarget.classList.remove('feed-dropzone--hover');
        void onImportOpml(event.dataTransfer.files.item(0));
    };
    return (
        <div className="feed-add">
            <section className="feed-add-section">
                <h3 className="feed-add-section__title">
                    <Rss size={16} />{' '}
                    {t('feed_manager.add_rss_title', 'Add RSS Feed')}
                </h3>
                <form
                    onSubmit={(event) => {
                        void onSubmit(event);
                    }}
                    className="feed-add-form"
                >
                    <input
                        type="url"
                        placeholder={t(
                            'feed_manager.rss_url_placeholder',
                            'RSS feed URL *',
                        )}
                        value={url}
                        onChange={(event) => {
                            onUrlChange(event.target.value);
                        }}
                        required
                        className="feed-input"
                    />
                    <input
                        type="text"
                        placeholder={t(
                            'feed_manager.name_placeholder',
                            'Name (optional)',
                        )}
                        value={name}
                        onChange={(event) => {
                            onNameChange(event.target.value);
                        }}
                        className="feed-input"
                    />
                    <input
                        type="text"
                        placeholder={t(
                            'feed_manager.category_placeholder',
                            'Category (optional)',
                        )}
                        value={category}
                        onChange={(event) => {
                            onCategoryChange(event.target.value);
                        }}
                        className="feed-input"
                    />
                    <button
                        type="submit"
                        className="feed-submit-btn"
                        disabled={addLoading}
                    >
                        <Plus size={16} />
                        <span>
                            {addLoading
                                ? t('feed_manager.adding', 'Adding...')
                                : t('feed_manager.add_feed_btn', 'Add Feed')}
                        </span>
                    </button>
                </form>
            </section>

            <section className="feed-add-section">
                <h3 className="feed-add-section__title">
                    <Upload size={16} />{' '}
                    {t('feed_manager.import_opml_title', 'Import OPML')}
                </h3>
                <p className="feed-add-desc">
                    {t(
                        'feed_manager.opml_desc',
                        'Upload an .opml file to import all feeds at once.',
                    )}
                </p>
                <div
                    className="feed-dropzone"
                    onClick={() => {
                        fileRef.current?.click();
                    }}
                    onDragOver={(event) => {
                        event.preventDefault();
                        event.currentTarget.classList.add('feed-dropzone--hover');
                    }}
                    onDragLeave={(event) => {
                        event.currentTarget.classList.remove('feed-dropzone--hover');
                    }}
                    onDrop={onDrop}
                >
                    <Upload size={24} className="feed-dropzone__icon" />
                    <span>
                        {t(
                            'feed_manager.dropzone_text',
                            'Drag an .opml file here or click to select',
                        )}
                    </span>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".opml,.xml"
                        onChange={(event) => {
                            void onImportOpml(event.target.files?.item(0) ?? null);
                        }}
                        hidden
                    />
                </div>
            </section>
        </div>
    );
}


export interface FeedSchedulerViewProps {
    readonly onRun: (name: string) => Promise<void>;
    readonly onToggle: (task: ScheduledTask) => Promise<void>;
    readonly runningTask: string | null;
    readonly tasks: ScheduledTask[];
}


export function FeedSchedulerView({
    onRun,
    onToggle,
    runningTask,
    tasks,
}: FeedSchedulerViewProps) {
    const { t } = useTranslation();
    return (
        <div className="feed-scheduler">
            <p className="feed-add-desc">
                {t(
                    'feed_manager.scheduler_desc',
                    'Automatic tasks that run periodically.',
                )}
            </p>
            {tasks.length === 0 ? (
                <p className="feed-empty">
                    {t(
                        'feed_manager.scheduler_load_error',
                        'Could not load the tasks.',
                    )}
                </p>
            ) : (
                <div className="feed-task-list">
                    {tasks.map((task) => (
                        <div key={task.name}>
                            <div className="feed-task-row">
                                <div className="feed-task-info">
                                    <div className="feed-task-header">
                                        <span className="feed-task-name">
                                            {task.description}
                                        </span>
                                        <span
                                            className={`feed-task-badge feed-task-badge--${runningTask === task.name ? 'running' : task.status}`}
                                        >
                                            {runningTask === task.name ? (
                                                <RefreshCw
                                                    size={12}
                                                    className="feed-spin"
                                                />
                                            ) : task.status === 'success' ? (
                                                <Check size={12} />
                                            ) : task.status === 'error' ? (
                                                <AlertCircle size={12} />
                                            ) : null}
                                            {runningTask === task.name
                                                ? t(
                                                    'feed_manager.running',
                                                    'running...',
                                                )
                                                : task.status}
                                        </span>
                                    </div>
                                    <span className="feed-source-meta">
                                        {t(
                                            'feed_manager.task_interval',
                                            'Every {{interval}}',
                                            {
                                                interval: taskInterval(
                                                    task.interval_minutes,
                                                ),
                                            },
                                        )}
                                        {task.last_run
                                            ? ` · ${t(
                                                'feed_manager.task_last_run',
                                                'Last: {{date}}',
                                                {
                                                    date: new Date(
                                                        task.last_run,
                                                    ).toLocaleString('ca'),
                                                },
                                            )}`
                                            : ''}
                                    </span>
                                </div>
                                <div className="feed-task-actions">
                                    <button
                                        className={`feed-task-run ${runningTask === task.name ? 'feed-task-run--active' : ''}`}
                                        onClick={() => {
                                            void onRun(task.name);
                                        }}
                                        title={t(
                                            'feed_manager.run_now',
                                            'Run now',
                                        )}
                                        disabled={runningTask !== null}
                                    >
                                        <RefreshCw
                                            size={14}
                                            className={
                                                runningTask === task.name
                                                    ? 'feed-spin'
                                                    : ''
                                            }
                                        />
                                    </button>
                                    <button
                                        className={`feed-task-toggle ${task.enabled ? 'feed-task-toggle--on' : ''}`}
                                        onClick={() => {
                                            void onToggle(task);
                                        }}
                                        title={task.enabled
                                            ? t(
                                                'feed_manager.deactivate_task',
                                                'Deactivate',
                                            )
                                            : t(
                                                'feed_manager.activate_task',
                                                'Activate',
                                            )}
                                    >
                                        <div className="feed-task-toggle__dot" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
