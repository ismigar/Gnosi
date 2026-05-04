import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import './SettingsModal.css'; // We'll create this for basic styling

export function SettingsModal({ isOpen, onClose }) {
    const { t, i18n } = useTranslation();
    const [config, setConfig] = useState(null);
    const [envVars, setEnvVars] = useState(null);
    const [activeTab, setActiveTab] = useState('general');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showToken, setShowToken] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [credentials, setCredentials] = useState([]);
    const [editingCredential, setEditingCredential] = useState(null);
    const [credentialValue, setCredentialValue] = useState('');
    const [schedulers, setSchedulers] = useState([]);
    const [syncing, setSyncing] = useState(false);
    const [syncStatus, setSyncStatus] = useState(null);

    useEffect(() => {
        if (isOpen) {
            loadConfig();
            loadEnvVars();
            loadSchedulers();
            loadSyncStatus();
            loadCredentials();
        }
    }, [isOpen]);

    const loadSchedulers = async () => {
        try {
            const res = await fetch('/api/schedulers');
            const data = await res.json();
            setSchedulers(data);
        } catch (err) {
            console.error("Error loading schedulers:", err);
        }
    };

    const loadSyncStatus = async () => {
        try {
            const res = await fetch('/api/sync/status');
            const data = await res.json();
            setSyncStatus(data.last_sync);
        } catch (err) {
            console.error("Error loading sync status:", err);
        }
    };

    const loadCredentials = async () => {
        try {
            const res = await fetch('/api/credentials/');
            const data = await res.json();
            setCredentials(data);
        } catch (err) {
            console.error("Error loading credentials:", err);
        }
    };

    const loadConfig = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/config');
            const data = await res.json();
            setConfig(data);
        } catch (err) {
            console.error("Error loading config:", err);
        } finally {
            setLoading(false);
        }
    };

    const loadEnvVars = async () => {
        try {
            const res = await fetch('/api/env');
            const data = await res.json();
            setEnvVars(data);
        } catch (err) {
            console.error("Error loading env vars:", err);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Save params.yaml config
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            // Save .env variables
            if (envVars) {
                await fetch('/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(envVars)
                });
            }

            onClose();
            // Reload page to apply all changes cleanly
            window.location.reload();
        } catch (err) {
            console.error("Error saving config:", err);
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (path, value) => {
        setConfig(prev => {
            const newConfig = { ...prev };
            let current = newConfig;
            const keys = path.split('.');
            const lastKey = keys.pop();

            for (const key of keys) {
                if (!current[key]) current[key] = {};
                current = current[key];
            }
            current[lastKey] = value;
            return newConfig;
        });
    };

    const handleLanguageChange = (lang) => {
        i18n.changeLanguage(lang);
        // We don't necessarily save this to params.yaml unless we want it persistent across server restarts
        // For now, let's just change it in the session. 
        // If we want to save it, we'd need a 'language' field in params.yaml.
    };

    const handleEnvChange = (key, value) => {
        setEnvVars(prev => ({
            ...prev,
            [key]: value
        }));
    };

    if (!isOpen) return null;

    return (
        <div className="settings-modal-overlay">
            <div className="settings-modal">
                <div className="settings-header">
                    <h2>{t('settings') || 'Settings'}</h2>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="settings-tabs">
                    <button className={activeTab === 'general' ? 'active' : ''} onClick={() => setActiveTab('general')}>General</button>
                    <button className={activeTab === 'visual' ? 'active' : ''} onClick={() => setActiveTab('visual')}>Visual</button>
                    <button className={activeTab === 'ai' ? 'active' : ''} onClick={() => setActiveTab('ai')}>AI</button>
                    <button className={activeTab === 'notion' ? 'active' : ''} onClick={() => setActiveTab('notion')}>Notion</button>
                    <button className={activeTab === 'schedulers' ? 'active' : ''} onClick={() => setActiveTab('schedulers')}>Schedulers</button>
                    <button className={activeTab === 'credentials' ? 'active' : ''} onClick={() => setActiveTab('credentials')}>Credentials</button>
                </div>

                <div className="settings-content">
                    {loading ? <p>Loading...</p> : (
                        <>
                            {activeTab === 'general' && (
                                <div className="settings-section">
                                    <h3>Language</h3>
                                    <select value={i18n.language} onChange={(e) => handleLanguageChange(e.target.value)}>
                                        <option value="en">English</option>
                                        <option value="es">Español</option>
                                        <option value="ca">Català</option>
                                        <option value="fr">Français</option>
                                    </select>
                                </div>
                            )}

                            {activeTab === 'visual' && config && config.colors && (
                                <div className="settings-section">
                                    <h3>Node Colors</h3>
                                    <div className="color-grid">
                                        {Object.entries(config.colors.node_types || {}).map(([type, styles]) => (
                                            <div key={type} className="color-item">
                                                <label style={{ fontWeight: 'bold', marginBottom: '5px', display: 'block' }}>{type}</label>
                                                <div className="color-inputs" style={{ display: 'flex', gap: '10px' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                        <input
                                                            type="color"
                                                            value={styles.bg}
                                                            onChange={(e) => handleChange(`colors.node_types.${type}.bg`, e.target.value)}
                                                            title="Background"
                                                        />
                                                        <span style={{ fontSize: '0.8em', marginTop: '2px' }}>Bg</span>
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                        <input
                                                            type="color"
                                                            value={styles.border}
                                                            onChange={(e) => handleChange(`colors.node_types.${type}.border`, e.target.value)}
                                                            title="Border"
                                                        />
                                                        <span style={{ fontSize: '0.8em', marginTop: '2px' }}>Border</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <h3>Edge Colors</h3>
                                    {config.colors.edges && (
                                        <div className="color-grid">
                                            <div className="color-item">
                                                <label>Explicit (Real)</label>
                                                <input
                                                    type="color"
                                                    value={config.colors.edges.explicit_color}
                                                    onChange={(e) => handleChange('colors.edges.explicit_color', e.target.value)}
                                                />
                                            </div>
                                            <div className="color-item">
                                                <label>Direct</label>
                                                <input
                                                    type="color"
                                                    value={config.colors.edges.direct_color}
                                                    onChange={(e) => handleChange('colors.edges.direct_color', e.target.value)}
                                                />
                                            </div>
                                            <div className="color-item">
                                                <label>Default Inferred</label>
                                                <input
                                                    type="color"
                                                    value={config.colors.edges.default_inferred_color}
                                                    onChange={(e) => handleChange('colors.edges.default_inferred_color', e.target.value)}
                                                />
                                            </div>
                                            <div className="color-item">
                                                <label>Tag Edge</label>
                                                <input
                                                    type="color"
                                                    value={config.colors.edges.tag_edge_color || "#E0E0E0"}
                                                    onChange={(e) => handleChange('colors.edges.tag_edge_color', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {config.colors.edges && config.colors.edges.similarity_buckets && (
                                        <>
                                            <h4>Similarity Levels</h4>
                                            <div className="color-grid">
                                                {config.colors.edges.similarity_buckets.map((bucket, index) => (
                                                    <div key={index} className="color-item">
                                                        <label>{bucket.label} (&gt; {bucket.min}%)</label>
                                                        <input
                                                            type="color"
                                                            value={bucket.color}
                                                            onChange={(e) => handleChange(`colors.edges.similarity_buckets.${index}.color`, e.target.value)}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}

                                    <h3>Graph Colors</h3>
                                    <div className="form-group">
                                        <label>Background</label>
                                        <input
                                            type="color"
                                            value={config.colors.default_bg}
                                            onChange={(e) => handleChange('colors.default_bg', e.target.value)}
                                        />
                                    </div>
                                </div>
                            )}

                            {activeTab === 'ai' && envVars && config && config.ai && (
                                <div className="settings-section">
                                    <h3>HuggingFace Credentials</h3>
                                    <div className="form-group">
                                        <label>API Key</label>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <input
                                                type={showApiKey ? "text" : "password"}
                                                value={envVars.HF_API_KEY || ''}
                                                onChange={(e) => handleEnvChange('HF_API_KEY', e.target.value)}
                                                placeholder="hf_..."
                                                style={{ flex: 1 }}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowApiKey(!showApiKey)}
                                                style={{ padding: '8px 12px' }}
                                            >
                                                {showApiKey ? '👁️' : '👁️‍🗨️'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label>HuggingFace Model</label>
                                        <input
                                            type="text"
                                            value={envVars.HF_MODEL || ''}
                                            onChange={(e) => handleEnvChange('HF_MODEL', e.target.value)}
                                            placeholder="deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"
                                        />
                                    </div>

                                    <h3>Local AI Settings</h3>
                                    <div className="form-group">
                                        <label>Model Name</label>
                                        <input
                                            type="text"
                                            value={config.ai.model_name}
                                            onChange={(e) => handleChange('ai.model_name', e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Model URL</label>
                                        <input
                                            type="text"
                                            value={config.ai.model_url}
                                            onChange={(e) => handleChange('ai.model_url', e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Timeout (seconds)</label>
                                        <input
                                            type="number"
                                            value={config.ai.timeout}
                                            onChange={(e) => handleChange('ai.timeout', parseInt(e.target.value))}
                                        />
                                    </div>
                                </div>
                            )}

                            {activeTab === 'notion' && envVars && config && config.notion && (
                                <div className="settings-section">
                                    <h3>Notion Credentials</h3>
                                    <div className="form-group">
                                        <label>Notion Token</label>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <input
                                                type={showToken ? "text" : "password"}
                                                value={envVars.NOTION_TOKEN || ''}
                                                onChange={(e) => handleEnvChange('NOTION_TOKEN', e.target.value)}
                                                placeholder="ntn_..."
                                                style={{ flex: 1 }}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowToken(!showToken)}
                                                style={{ padding: '8px 12px' }}
                                            >
                                                {showToken ? '👁️' : '👁️‍🗨️'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="form-group">
                                        <label>Database ID</label>
                                        <input
                                            type="text"
                                            value={envVars.DATABASE_ID || ''}
                                            onChange={(e) => handleEnvChange('DATABASE_ID', e.target.value)}
                                            placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                        />
                                    </div>

                                    <h3>Notion Properties</h3>
                                    <div className="form-group">
                                        <label>Title Property</label>
                                        <input
                                            type="text"
                                            value={config.notion.title_property}
                                            onChange={(e) => handleChange('notion.title_property', e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Links Property</label>
                                        <input
                                            type="text"
                                            value={config.notion.links_property}
                                            onChange={(e) => handleChange('notion.links_property', e.target.value)}
                                        />
                                    </div>

                                    <h3>Sincronització</h3>
                                    <div className="form-group">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                setSyncing(true);
                                                try {
                                                    const res = await fetch('/api/sync/directives-to-notion', { method: 'POST' });
                                                    const data = await res.json();
                                                    setSyncStatus(data);
                                                    alert(`Sincronitzat: ${data.synced || 0} directives`);
                                                } catch (e) {
                                                    alert('Error sincronitzant: ' + e.message);
                                                }
                                                setSyncing(false);
                                            }}
                                            disabled={syncing}
                                            style={{ padding: '10px 20px', background: '#4a5568', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                                        >
                                            {syncing ? 'Sincronitzant...' : '📤 Sincronitzar Directives a Notion'}
                                        </button>
                                        {syncStatus && (
                                            <p style={{ marginTop: '10px', fontSize: '0.9em', color: '#a0aec0' }}>
                                                Última sincronització: {new Date(syncStatus.timestamp).toLocaleString()}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'schedulers' && (
                                <div className="settings-section">
                                    <h3>Tasques Programades</h3>
                                    <p style={{ marginBottom: '20px', color: '#a0aec0' }}>
                                        Configura tasques automàtiques del sistema.
                                    </p>
                                    {schedulers.length === 0 ? (
                                        <p>Carregant tasques...</p>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                            {schedulers.map(task => (
                                                <div
                                                    key={task.name}
                                                    style={{
                                                        background: '#2d3748',
                                                        padding: '15px',
                                                        borderRadius: '8px',
                                                        border: task.enabled ? '1px solid #48bb78' : '1px solid #4a5568'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <div>
                                                            <strong>{task.name.replace(/_/g, ' ').toUpperCase()}</strong>
                                                            <p style={{ margin: '5px 0', color: '#a0aec0', fontSize: '0.9em' }}>
                                                                {task.description}
                                                            </p>
                                                        </div>
                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={task.enabled}
                                                                onChange={async (e) => {
                                                                    const res = await fetch(`/api/schedulers/${task.name}`, {
                                                                        method: 'PUT',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({
                                                                            interval_minutes: task.interval_minutes,
                                                                            enabled: e.target.checked
                                                                        })
                                                                    });
                                                                    if (res.ok) {
                                                                        setSchedulers(prev => prev.map(t =>
                                                                            t.name === task.name ? { ...t, enabled: e.target.checked } : t
                                                                        ));
                                                                    }
                                                                }}
                                                            />
                                                            {task.enabled ? '✅ Actiu' : '⏸️ Inactiu'}
                                                        </label>
                                                    </div>
                                                    <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                        <label>Cada:</label>
                                                        <select
                                                            value={task.interval_minutes}
                                                            onChange={async (e) => {
                                                                const newInterval = parseInt(e.target.value);
                                                                const res = await fetch(`/api/schedulers/${task.name}`, {
                                                                    method: 'PUT',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({
                                                                        interval_minutes: newInterval,
                                                                        enabled: task.enabled
                                                                    })
                                                                });
                                                                if (res.ok) {
                                                                    setSchedulers(prev => prev.map(t =>
                                                                        t.name === task.name ? { ...t, interval_minutes: newInterval } : t
                                                                    ));
                                                                }
                                                            }}
                                                            style={{ padding: '5px', borderRadius: '4px', background: '#1a202c', color: 'white' }}
                                                        >
                                                            <option value={60}>1 hora</option>
                                                            <option value={360}>6 hores</option>
                                                            <option value={720}>12 hores</option>
                                                            <option value={1440}>1 dia</option>
                                                            <option value={10080}>1 setmana</option>
                                                        </select>
                                                        <button
                                                            onClick={async () => {
                                                                const res = await fetch(`/api/schedulers/${task.name}/run`, { method: 'POST' });
                                                                const data = await res.json();
                                                                if (data.success) {
                                                                    alert('Tasca executada correctament!');
                                                                } else {
                                                                    alert('Error: ' + (data.error || 'desconegut'));
                                                                }
                                                            }}
                                                            style={{ padding: '5px 10px', background: '#4a5568', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                                        >
                                                            ▶️ Executar ara
                                                        </button>
                                                    </div>
                                                    {task.last_run && (
                                                        <p style={{ marginTop: '5px', fontSize: '0.8em', color: '#718096' }}>
                                                            Última execució: {new Date(task.last_run).toLocaleString()}
                                                        </p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === 'credentials' && (
                                <div className="settings-section">
                                    <h3>API Keys & Credentials</h3>
                                    <p style={{ marginBottom: '20px', color: '#a0aec0', fontSize: '0.9em' }}>
                                        Les teves claus API s'emmagatzemen de forma segura al Keychain del teu ordinador.
                                        Aquesta pestanya mostra quines claus estan configurades.
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        {credentials.map(cred => (
                                            <div
                                                key={cred.key}
                                                style={{
                                                    background: '#2d3748',
                                                    padding: '15px',
                                                    borderRadius: '8px',
                                                    border: cred.has_value ? '1px solid #48bb78' : '1px solid #4a5568'
                                                }}
                                            >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <div>
                                                        <strong style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            {cred.has_value ? '🔐' : '🔓'}
                                                            {cred.name}
                                                        </strong>
                                                        <p style={{ margin: '5px 0 0 24px', color: '#a0aec0', fontSize: '0.85em' }}>
                                                            {cred.description}
                                                        </p>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        {cred.has_value ? (
                                                            <>
                                                                <span style={{ color: '#48bb78', fontSize: '0.85em' }}>✓ Configurat</span>
                                                                <button
                                                                    onClick={() => {
                                                                        setEditingCredential(cred.key);
                                                                        setCredentialValue('');
                                                                    }}
                                                                    style={{ padding: '5px 10px', background: '#4a5568', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em' }}
                                                                >
                                                                    Editar
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <button
                                                                onClick={() => {
                                                                    setEditingCredential(cred.key);
                                                                    setCredentialValue('');
                                                                }}
                                                                style={{ padding: '5px 10px', background: '#4a90d9', border: 'none', borderRadius: '4px', cursor: 'pointer', color: 'white', fontSize: '0.85em' }}
                                                            >
                                                                + Afegir
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                {editingCredential === cred.key && (
                                                    <div style={{ marginTop: '15px', paddingTop: '15px', borderTop: '1px solid #4a5568' }}>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                            <input
                                                                type="password"
                                                                value={credentialValue}
                                                                onChange={(e) => setCredentialValue(e.target.value)}
                                                                placeholder={`Introdueix la clau per a ${cred.name}`}
                                                                style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #4a5568', background: '#1a202c', color: 'white' }}
                                                            />
                                                            <button
                                                                onClick={async () => {
                                                                    try {
                                                                        const res = await fetch('/api/credentials/', {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ key: cred.key, value: credentialValue })
                                                                        });
                                                                        if (res.ok) {
                                                                            setEditingCredential(null);
                                                                            setCredentialValue('');
                                                                            loadCredentials();
                                                                        }
                                                                    } catch (err) {
                                                                        alert('Error guardant: ' + err.message);
                                                                    }
                                                                }}
                                                                disabled={!credentialValue}
                                                                style={{ padding: '8px 16px', background: '#48bb78', border: 'none', borderRadius: '4px', cursor: 'pointer', color: 'white' }}
                                                            >
                                                                Guardar
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    setEditingCredential(null);
                                                                    setCredentialValue('');
                                                                }}
                                                                style={{ padding: '8px 16px', background: '#4a5568', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                                            >
                                                                Cancel·lar
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ marginTop: '20px', padding: '15px', background: '#1a202c', borderRadius: '8px' }}>
                                        <h4 style={{ marginTop: 0 }}>Migració des de .env_shared</h4>
                                        <p style={{ color: '#a0aec0', fontSize: '0.9em', marginBottom: '15px' }}>
                                            Si tens claus al fitxer .env_shared, pots migrar-les al Keychain automàticament.
                                        </p>
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const res = await fetch('/api/credentials/migrate', { method: 'POST' });
                                                    const data = await res.json();
                                                    if (data.status === 'success') {
                                                        alert(`Migrades ${data.total} claus!`);
                                                        loadCredentials();
                                                    }
                                                } catch (err) {
                                                    alert('Error migrant: ' + err.message);
                                                }
                                            }}
                                            style={{ padding: '10px 20px', background: '#805ad5', border: 'none', borderRadius: '5px', cursor: 'pointer', color: 'white' }}
                                        >
                                            🔄 Migrar claus des de .env_shared
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>

                <div className="settings-footer">
                    <button className="cancel-btn" onClick={onClose}>Cancel</button>
                    <button className="save-btn" onClick={handleSave} disabled={saving}>
                        {saving ? 'Saving...' : 'Save & Reload'}
                    </button>
                </div>
            </div>
        </div>
    );
}
