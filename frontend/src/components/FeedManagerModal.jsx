import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, Upload, Rss, Mail, Clock, RefreshCw, AlertCircle, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '../lib/toast';
import { ConfirmModal } from './ConfirmModal';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { transportFetch } from '../shared/api/transports';

const API_BASE = '/api';

export function FeedManagerModal({ isOpen, onClose, onRefresh }) {
    const { t } = useTranslation();
    const [sources, setSources] = useState([]);
    const [schedulerTasks, setSchedulerTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('sources'); // sources | add | scheduler
    const [runningTask, setRunningTask] = useState(null); // name of currently running task
    const [newUrl, setNewUrl] = useState('');
    const [newName, setNewName] = useState('');
    const [newCategory, setNewCategory] = useState('');
    const [addLoading, setAddLoading] = useState(false);

    const fileRef = useRef(null);
    const modalRef = useRef(null);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, id: null });

    useEffect(() => {
        if (isOpen) {
            fetchSources();
            fetchScheduler();
        }
    }, [isOpen]);

    // Feed manager (tabs/list) with no single primary action: ONLY
    // Esc + focus-trap, without onConfirm (the Enter key from "Afegir Feed" already handles it
    // the native submit of its <form>). See useModalKeyboard.
    useModalKeyboard({
        isOpen,
        onClose,
        containerRef: modalRef,
        trapFocus: true,
    });

    if (!isOpen) return null;

    async function fetchSources() {
        setLoading(true);
        try {
            const res = await transportFetch(`${API_BASE}/reader/sources`);
            if (res.ok) setSources(await res.json());
        } catch (e) {
            console.error('Error fetching sources:', e);
        } finally {
            setLoading(false);
        }
    }

    async function fetchScheduler() {
        try {
            const res = await transportFetch(`${API_BASE}/schedulers`);
            if (res.ok) {
                const all = await res.json();
                // Only show reader-related tasks
                setSchedulerTasks(all.filter(t =>
                    ['fetch_feeds', 'fetch_newsletters', 'generate_podcast'].includes(t.name)
                ));
            }
        } catch (e) {
            console.error('Error fetching scheduler:', e);
        }
    }

    async function handleAddFeed(e) {
        e.preventDefault();
        if (!newUrl.trim()) return;
        setAddLoading(true);
        try {
            const res = await transportFetch(`${API_BASE}/reader/sources`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newName.trim() || newUrl.trim(),
                    url: newUrl.trim(),
                    category: newCategory.trim() || 'Uncategorized',
                    type: 'rss',
                }),
            });
            if (res.ok) {
                setNewName('');
                setNewUrl('');
                setNewCategory('');
                fetchSources();
            } else {
                const err = await res.json();
                toast.error(err.detail || t('feed_manager.error_add_feed', "Error adding feed"));
            }
        } catch {
            toast.error(t('feed_manager.error_connect', "Could not connect"));
        } finally {
            setAddLoading(false);
        }
    }

    async function executeDeleteSource() {
        if (!confirmModal.id) return;
        try {
            const res = await transportFetch(`${API_BASE}/reader/sources/${confirmModal.id}`, { method: 'DELETE' });
            if (!res.ok) {
                // Without this branch, a 4xx/5xx response caused the
                // source to remain in the list even though the user had already confirmed.
                throw new Error(`HTTP ${res.status}`);
            }
            fetchSources();
        } catch (e) {
            console.error('Error deleting source:', e);
        } finally {
            setConfirmModal({ isOpen: false, id: null });
        }
    }

    function handleDeleteSource(id) {
        setConfirmModal({ isOpen: true, id });
    }

    async function handleOpmlUpload(file) {
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await transportFetch(`${API_BASE}/reader/sources/opml`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (res.ok) {
                fetchSources();
            } else {
                toast.error(data.detail || t('feed_manager.error_opml', "Error processing OPML"));
            }
        } catch {
            toast.error(t('feed_manager.error_upload_file', "Error uploading the file"));
        }
    }

    async function handleToggleTask(name, enabled, interval) {
        try {
            await transportFetch(`${API_BASE}/schedulers/${name}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ interval_minutes: interval, enabled: !enabled }),
            });
            fetchScheduler();
        } catch (e) {
            console.error('Error toggling task:', e);
        }
    }

    async function handleRunTask(name) {
        setRunningTask(name);
        try {
            const res = await transportFetch(`${API_BASE}/schedulers/${name}/run`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                fetchSources();
                fetchScheduler();
                if (onRefresh) onRefresh();
            } else {
                toast.error(data.error || t('errors.unknown'));
                fetchScheduler();
            }
        } catch (e) {
            toast.error(t('feed_manager.error_run_task', "Could not run"));
            console.error('Error running task:', e);
        } finally {
            setRunningTask(null);
        }
    }

    const tabs = [
        { id: 'sources', label: t('feed_manager.tab_sources', "Sources"), icon: Rss },
        { id: 'add', label: t('feed_manager.tab_add', "Add"), icon: Plus },
        { id: 'scheduler', label: t('feed_manager.tab_scheduler', "Automatic"), icon: Clock },
    ];

    const rssSources = sources.filter(s => s.type === 'rss');
    const newsletterSources = sources.filter(s => s.type === 'newsletter');

    return (
        <div className="settings-overlay">
            <div ref={modalRef} className="feed-modal" role="dialog" aria-modal="true" aria-label={t('feed_manager.title', 'Feed Management')}>
                {/* Header */}
                <div className="settings-modal__header">
                    <h2 className="settings-modal__title">📡 {t('feed_manager.title', "Feed Management")}</h2>
                    <button className="gnosi-close-btn" onClick={onClose} aria-label={t('common.close', "Close")}>
                        <X />
                    </button>
                </div>

                {/* Tabs */}
                <div className="feed-tabs">
                    {tabs.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            className={`feed-tab ${activeTab === id ? 'feed-tab--active' : ''}`}
                            onClick={() => setActiveTab(id)}
                        >
                            <Icon size={16} />
                            <span>{label}</span>
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="feed-modal__content">

                    {/* TAB: Sources */}
                    {activeTab === 'sources' && (
                        <div className="feed-sources">
                            {loading ? (
                                <p className="feed-empty">{t('common.loading')}</p>
                            ) : sources.length === 0 ? (
                                <p className="feed-empty">{t('feed_manager.empty_sources', "No sources configured. Add RSS feeds or import an OPML file.")}</p>
                            ) : (
                                <>
                                    {rssSources.length > 0 && (
                                        <div className="feed-source-group">
                                            <h3 className="feed-source-group__title">
                                                <Rss size={14} /> {t('feed_manager.rss_count', 'RSS ({{count}})', { count: rssSources.length })}
                                            </h3>
                                            {rssSources.map(s => (
                                                <div key={s.id} className="feed-source-row">
                                                    <div className="feed-source-info">
                                                        <span className="feed-source-name">{s.name}</span>
                                                        <span className="feed-source-meta">{s.category} · {s.url.substring(0, 50)}...</span>
                                                    </div>
                                                    <button
                                                        className="feed-source-delete"
                                                        onClick={() => handleDeleteSource(s.id)}
                                                        title={t('common.delete')}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {newsletterSources.length > 0 && (
                                        <div className="feed-source-group">
                                            <h3 className="feed-source-group__title">
                                                <Mail size={14} /> {t('feed_manager.newsletters_count', 'Newsletters ({{count}})', { count: newsletterSources.length })}
                                            </h3>
                                            {newsletterSources.map(s => (
                                                <div key={s.id} className="feed-source-row">
                                                    <div className="feed-source-info">
                                                        <span className="feed-source-name">{s.name}</span>
                                                        <span className="feed-source-meta">{s.url}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* TAB: Add */}
                    {activeTab === 'add' && (
                        <div className="feed-add">
                            {/* Add RSS Form */}
                            <section className="feed-add-section">
                                <h3 className="feed-add-section__title">
                                    <Rss size={16} /> {t('feed_manager.add_rss_title', "Add RSS Feed")}
                                </h3>
                                <form onSubmit={handleAddFeed} className="feed-add-form">
                                    <input
                                        type="url"
                                        placeholder={t('feed_manager.rss_url_placeholder', "RSS feed URL *")}
                                        value={newUrl}
                                        onChange={(e) => setNewUrl(e.target.value)}
                                        required
                                        className="feed-input"
                                    />
                                    <input
                                        type="text"
                                        placeholder={t('feed_manager.name_placeholder', "Name (optional)")}
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        className="feed-input"
                                    />
                                    <input
                                        type="text"
                                        placeholder={t('feed_manager.category_placeholder', "Category (optional)")}
                                        value={newCategory}
                                        onChange={(e) => setNewCategory(e.target.value)}
                                        className="feed-input"
                                    />
                                    <button type="submit" className="feed-submit-btn" disabled={addLoading}>
                                        <Plus size={16} />
                                        <span>{addLoading ? t('feed_manager.adding', "Adding...") : t('feed_manager.add_feed_btn', "Add Feed")}</span>
                                    </button>
                                </form>
                            </section>

                            {/* OPML Import */}
                            <section className="feed-add-section">
                                <h3 className="feed-add-section__title">
                                    <Upload size={16} /> {t('feed_manager.import_opml_title', "Import OPML")}
                                </h3>
                                <p className="feed-add-desc">
                                    {t('feed_manager.opml_desc', "Upload an .opml file to import all feeds at once.")}
                                </p>
                                <div
                                    className="feed-dropzone"
                                    onClick={() => fileRef.current?.click()}
                                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('feed-dropzone--hover'); }}
                                    onDragLeave={(e) => e.currentTarget.classList.remove('feed-dropzone--hover')}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        e.currentTarget.classList.remove('feed-dropzone--hover');
                                        handleOpmlUpload(e.dataTransfer.files[0]);
                                    }}
                                >
                                    <Upload size={24} className="feed-dropzone__icon" />
                                    <span>{t('feed_manager.dropzone_text', "Drag an .opml file here or click to select")}</span>
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept=".opml,.xml"
                                        onChange={(e) => handleOpmlUpload(e.target.files[0])}
                                        hidden
                                    />
                                </div>
                            </section>
                        </div>
                    )}

                    {/* TAB: Scheduler */}
                    {activeTab === 'scheduler' && (
                        <div className="feed-scheduler">
                            <p className="feed-add-desc">
                                {t('feed_manager.scheduler_desc', "Automatic tasks that run periodically.")}
                            </p>
                            {schedulerTasks.length === 0 ? (
                                <p className="feed-empty">{t('feed_manager.scheduler_load_error', "Could not load the tasks.")}</p>
                            ) : (
                                <div className="feed-task-list">
                                    {schedulerTasks.map(task => (
                                        <div key={task.name}>
                                            <div className="feed-task-row">
                                                <div className="feed-task-info">
                                                    <div className="feed-task-header">
                                                        <span className="feed-task-name">{task.description}</span>
                                                        <span className={`feed-task-badge feed-task-badge--${runningTask === task.name ? 'running' : task.status}`}>
                                                            {runningTask === task.name ? <RefreshCw size={12} className="feed-spin" /> :
                                                                task.status === 'success' ? <Check size={12} /> :
                                                                    task.status === 'error' ? <AlertCircle size={12} /> :
                                                                        null}
                                                            {runningTask === task.name ? t('feed_manager.running', "running...") : task.status}
                                                        </span>
                                                    </div>
                                                    <span className="feed-source-meta">
                                                        {t('feed_manager.task_interval', "Every {{interval}}", {
                                                            interval: task.interval_minutes < 60
                                                                ? `${task.interval_minutes} min`
                                                                : `${Math.round(task.interval_minutes / 60)}h`
                                                        })}
                                                        {task.last_run ? ` · ${t('feed_manager.task_last_run', "Last: {{date}}", { date: new Date(task.last_run).toLocaleString('ca') })}` : ''}
                                                    </span>
                                                </div>
                                                <div className="feed-task-actions">
                                                    <button
                                                        className={`feed-task-run ${runningTask === task.name ? 'feed-task-run--active' : ''}`}
                                                        onClick={() => handleRunTask(task.name)}
                                                        title={t('feed_manager.run_now', "Run now")}
                                                        disabled={runningTask !== null}
                                                    >
                                                        <RefreshCw size={14} className={runningTask === task.name ? 'feed-spin' : ''} />
                                                    </button>
                                                    <button
                                                        className={`feed-task-toggle ${task.enabled ? 'feed-task-toggle--on' : ''}`}
                                                        onClick={() => handleToggleTask(task.name, task.enabled, task.interval_minutes)}
                                                        title={task.enabled ? t('feed_manager.deactivate_task', "Deactivate") : t('feed_manager.activate_task', "Activate")}
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
                    )}
                </div>

                <ConfirmModal
                    isOpen={confirmModal.isOpen}
                    onClose={() => setConfirmModal({ isOpen: false, id: null })}
                    onConfirm={executeDeleteSource}
                    title={t('feed_manager.delete_feed_title', "Delete Feed")}
                    message={t('feed_manager.delete_feed_message', "Are you sure you want to delete this feed and all its articles? This action cannot be undone.")}
                    confirmText={t('common.delete')}
                    isDestructive={true}
                />
            </div>
        </div>
    );
}
