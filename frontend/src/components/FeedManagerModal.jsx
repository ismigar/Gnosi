import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, Upload, Rss, Mail, Clock, RefreshCw, AlertCircle, Check } from 'lucide-react';
import { ConfirmModal } from './ConfirmModal';

const API_BASE = '/api';

export function FeedManagerModal({ isOpen, onClose, onRefresh }) {
    const [sources, setSources] = useState([]);
    const [schedulerTasks, setSchedulerTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('sources'); // sources | add | scheduler
    const [runningTask, setRunningTask] = useState(null); // name of currently running task
    const [runResult, setRunResult] = useState(null); // { name, type, text }
    const [newUrl, setNewUrl] = useState('');
    const [newName, setNewName] = useState('');
    const [newCategory, setNewCategory] = useState('');
    const [addLoading, setAddLoading] = useState(false);
    const [addMessage, setAddMessage] = useState(null);

    const fileRef = useRef(null);
    const [opmlMessage, setOpmlMessage] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, id: null });

    useEffect(() => {
        if (isOpen) {
            fetchSources();
            fetchScheduler();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    async function fetchSources() {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/reader/sources`);
            if (res.ok) setSources(await res.json());
        } catch (e) {
            console.error('Error fetching sources:', e);
        } finally {
            setLoading(false);
        }
    }

    async function fetchScheduler() {
        try {
            const res = await fetch(`${API_BASE}/schedulers`);
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
        setAddMessage(null);
        try {
            const res = await fetch(`${API_BASE}/reader/sources`, {
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
                setAddMessage({ type: 'success', text: '✅ Feed afegit!' });
                setNewName('');
                setNewUrl('');
                setNewCategory('');
                fetchSources();
            } else {
                const err = await res.json();
                setAddMessage({ type: 'error', text: `❌ ${err.detail || 'Error'}` });
            }
        } catch {
            setAddMessage({ type: 'error', text: '❌ No s\'ha pogut connectar' });
        } finally {
            setAddLoading(false);
        }
    }

    async function executeDeleteSource() {
        if (!confirmModal.id) return;
        try {
            const res = await fetch(`${API_BASE}/reader/sources/${confirmModal.id}`, { method: 'DELETE' });
            if (res.ok) fetchSources();
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
        setOpmlMessage(null);
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await fetch(`${API_BASE}/reader/sources/opml`, {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();
            if (res.ok) {
                setOpmlMessage({ type: 'success', text: `✅ ${data.message}` });
                fetchSources();
            } else {
                setOpmlMessage({ type: 'error', text: `❌ ${data.detail || 'Error'}` });
            }
        } catch {
            setOpmlMessage({ type: 'error', text: '❌ Error al pujar el fitxer' });
        }
    }

    async function handleToggleTask(name, enabled, interval) {
        try {
            await fetch(`${API_BASE}/schedulers/${name}`, {
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
        setRunResult(null);
        try {
            const res = await fetch(`${API_BASE}/schedulers/${name}/run`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                const msg = data.result?.message || 'Executat correctament';
                setRunResult({ name, type: 'success', text: `✅ ${msg}` });
                fetchSources();
                fetchScheduler();
                if (onRefresh) onRefresh();
            } else {
                setRunResult({ name, type: 'error', text: `❌ ${data.error || 'Error desconegut'}` });
                fetchScheduler();
            }
        } catch (e) {
            setRunResult({ name, type: 'error', text: '❌ No s\'ha pogut executar' });
            console.error('Error running task:', e);
        } finally {
            setRunningTask(null);
        }
    }

    const tabs = [
        { id: 'sources', label: 'Fonts', icon: Rss },
        { id: 'add', label: 'Afegir', icon: Plus },
        { id: 'scheduler', label: 'Automàtic', icon: Clock },
    ];

    const rssSources = sources.filter(s => s.type === 'rss');
    const newsletterSources = sources.filter(s => s.type === 'newsletter');

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="feed-modal" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="settings-modal__header">
                    <h2 className="settings-modal__title">📡 Gestió de Feeds</h2>
                    <button className="settings-modal__close" onClick={onClose}>
                        <X size={20} />
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
                                <p className="feed-empty">Carregant...</p>
                            ) : sources.length === 0 ? (
                                <p className="feed-empty">Cap font configurada. Afegeix feeds RSS o importa un OPML.</p>
                            ) : (
                                <>
                                    {rssSources.length > 0 && (
                                        <div className="feed-source-group">
                                            <h3 className="feed-source-group__title">
                                                <Rss size={14} /> RSS ({rssSources.length})
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
                                                        title="Eliminar"
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
                                                <Mail size={14} /> Newsletters ({newsletterSources.length})
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
                                    <Rss size={16} /> Afegir Feed RSS
                                </h3>
                                <form onSubmit={handleAddFeed} className="feed-add-form">
                                    <input
                                        type="url"
                                        placeholder="URL del feed RSS *"
                                        value={newUrl}
                                        onChange={(e) => setNewUrl(e.target.value)}
                                        required
                                        className="feed-input"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Nom (opcional)"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        className="feed-input"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Categoria (opcional)"
                                        value={newCategory}
                                        onChange={(e) => setNewCategory(e.target.value)}
                                        className="feed-input"
                                    />
                                    <button type="submit" className="feed-submit-btn" disabled={addLoading}>
                                        <Plus size={16} />
                                        <span>{addLoading ? 'Afegint...' : 'Afegir Feed'}</span>
                                    </button>
                                </form>
                                {addMessage && (
                                    <p className={`feed-msg feed-msg--${addMessage.type}`}>{addMessage.text}</p>
                                )}
                            </section>

                            {/* OPML Import */}
                            <section className="feed-add-section">
                                <h3 className="feed-add-section__title">
                                    <Upload size={16} /> Importar OPML
                                </h3>
                                <p className="feed-add-desc">
                                    Puja un fitxer .opml per importar tots els feeds d'un cop.
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
                                    <span>Arrossega un fitxer .opml o clica per seleccionar</span>
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept=".opml,.xml"
                                        onChange={(e) => handleOpmlUpload(e.target.files[0])}
                                        hidden
                                    />
                                </div>
                                {opmlMessage && (
                                    <p className={`feed-msg feed-msg--${opmlMessage.type}`}>{opmlMessage.text}</p>
                                )}
                            </section>
                        </div>
                    )}

                    {/* TAB: Scheduler */}
                    {activeTab === 'scheduler' && (
                        <div className="feed-scheduler">
                            <p className="feed-add-desc">
                                Tasques automàtiques que s'executen periòdicament.
                            </p>
                            {schedulerTasks.length === 0 ? (
                                <p className="feed-empty">No s'han pogut carregar les tasques.</p>
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
                                                            {runningTask === task.name ? 'executant...' : task.status}
                                                        </span>
                                                    </div>
                                                    <span className="feed-source-meta">
                                                        Cada {task.interval_minutes < 60
                                                            ? `${task.interval_minutes} min`
                                                            : `${Math.round(task.interval_minutes / 60)}h`}
                                                        {task.last_run ? ` · Últim: ${new Date(task.last_run).toLocaleString('ca')}` : ''}
                                                    </span>
                                                </div>
                                                <div className="feed-task-actions">
                                                    <button
                                                        className={`feed-task-run ${runningTask === task.name ? 'feed-task-run--active' : ''}`}
                                                        onClick={() => handleRunTask(task.name)}
                                                        title="Executar ara"
                                                        disabled={runningTask !== null}
                                                    >
                                                        <RefreshCw size={14} className={runningTask === task.name ? 'feed-spin' : ''} />
                                                    </button>
                                                    <button
                                                        className={`feed-task-toggle ${task.enabled ? 'feed-task-toggle--on' : ''}`}
                                                        onClick={() => handleToggleTask(task.name, task.enabled, task.interval_minutes)}
                                                        title={task.enabled ? 'Desactivar' : 'Activar'}
                                                    >
                                                        <div className="feed-task-toggle__dot" />
                                                    </button>
                                                </div>
                                            </div>
                                            {runResult && runResult.name === task.name && (
                                                <p className={`feed-msg feed-msg--${runResult.type}`} style={{ padding: '4px 16px 8px' }}>{runResult.text}</p>
                                            )}
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
                    title="Eliminar Feed"
                    message="Segur que vols eliminar aquest feed i tots els seus articles? Aquesta acció no es pot desfer."
                    confirmText="Eliminar"
                    isDestructive={true}
                />
            </div>
        </div>
    );
}
