import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { CalendarDays, Hash, MessageSquare, Share2, LayoutDashboard, Puzzle, Settings } from 'lucide-react';
import { BUILTIN_PLUGINS } from '../plugins/registry';
import { usePlugins } from '../plugins/usePlugins';
import { reloadPlugins } from '../plugins/usePluginHost';

const ICONS = { CalendarDays, Hash, MessageSquare, Share2, LayoutDashboard };

const SELECT_STYLE = {
    width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--border-primary, #e2e8f0)',
    background: 'var(--bg-primary, #fff)', color: 'var(--text-primary, #0f172a)',
};

/**
 * Configuració del plugin daily-notes: permet usar una base de dades (taula)
 * com a font de la "Nota del dia" (p. ex. "Bitàcora") en lloc de la carpeta
 * `Daily Notes/`. La columna de data s'auto-detecta (primer camp de tipus
 * `date`) i es pot confirmar/canviar. Buidar la BD torna al comportament clàssic.
 */
function DailyNotesConfig() {
    const { getPluginSettings, setPluginSettings } = usePlugins();
    const cfg = getPluginSettings('daily-notes');
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        axios.get('/api/vault/tables')
            .then((res) => { if (alive) setTables(Array.isArray(res.data) ? res.data : []); })
            .catch(() => { if (alive) setTables([]); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    const selectedTable = tables.find((t) => t.id === cfg.source_table_id) || null;
    const dateProps = (selectedTable?.properties || []).filter((p) => p.type === 'date');

    const onPickTable = (tableId) => {
        if (!tableId) {
            setPluginSettings('daily-notes', { source_table_id: '', date_property: '' });
            return;
        }
        const t = tables.find((x) => x.id === tableId);
        const firstDate = (t?.properties || []).find((p) => p.type === 'date');
        setPluginSettings('daily-notes', {
            source_table_id: tableId,
            date_property: firstDate ? firstDate.id : '',
        });
    };

    return (
        <div style={{
            marginTop: 8, padding: '12px 14px', borderRadius: 10,
            border: '1px dashed var(--border-primary, #e2e8f0)',
            background: 'var(--bg-primary, #fff)',
            display: 'flex', flexDirection: 'column', gap: 12,
        }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                Per defecte la nota del dia es desa a la carpeta <code>Daily Notes/</code>. Tria una base
                de dades per desar-la com a fila d'aquesta taula (p. ex. «Bitàcora»).
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                    Base de dades font
                </span>
                <select
                    style={SELECT_STYLE}
                    value={cfg.source_table_id || ''}
                    disabled={loading}
                    onChange={(e) => onPickTable(e.target.value)}
                >
                    <option value="">— Cap (carpeta Daily Notes) —</option>
                    {tables.map((t) => (
                        <option key={t.id} value={t.id}>{t.name || t.id}</option>
                    ))}
                </select>
            </label>

            {selectedTable && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                        Columna de data
                    </span>
                    {dateProps.length === 0 ? (
                        <span style={{ fontSize: 12, color: '#dc2626' }}>
                            Aquesta taula no té cap columna de tipus «data». Afegeix-ne una per identificar
                            la nota de cada dia.
                        </span>
                    ) : (
                        <select
                            style={SELECT_STYLE}
                            value={cfg.date_property || (dateProps[0] && dateProps[0].id) || ''}
                            onChange={(e) => setPluginSettings('daily-notes', { date_property: e.target.value })}
                        >
                            {dateProps.map((p) => (
                                <option key={p.id} value={p.id}>{p.name || p.id}</option>
                            ))}
                        </select>
                    )}
                </label>
            )}
        </div>
    );
}

/**
 * Secció de plugins de TERCERS (v2): plugins instal·lats a `.gnosi/plugins/<id>/`
 * amb manifest propi. Permet activar/desactivar, veure i concedir els permisos
 * que declaren, i executen codi en sandbox (iframe UI / Node dades). Veure
 * directiva `plugin_system.md`.
 */
function ThirdPartyPlugins() {
    const { isEnabled, setPluginEnabled } = usePlugins();
    const [installed, setInstalled] = useState([]);
    const [catalog, setCatalog] = useState({});
    const [loading, setLoading] = useState(true);

    // No fa setState síncron: `loading` ja arrenca a true i es baixa al final
    // (evita cascading renders; cf. react-hooks/set-state-in-effect).
    const refresh = () => Promise.all([
        axios.get('/api/vault/plugins/installed').then((r) => r.data?.plugins || []).catch(() => []),
        axios.get('/api/vault/plugins/catalog').then((r) => r.data?.permissions || {}).catch(() => ({})),
    ]).then(([plugins, perms]) => {
        setInstalled(plugins);
        setCatalog(perms);
    }).finally(() => setLoading(false));

    useEffect(() => { refresh(); return undefined; }, []);

    const togglePermission = async (pid, declared, current, perm) => {
        const has = current.includes(perm);
        const next = has ? current.filter((p) => p !== perm) : [...current, perm];
        // Només enviem permisos declarats pel manifest (el backend també ho valida).
        const clean = next.filter((p) => declared.includes(p));
        try {
            await axios.post(`/api/vault/plugins/${encodeURIComponent(pid)}/permissions`, { permissions: clean });
            refresh();
            reloadPlugins();
        } catch { /* noop */ }
    };

    return (
        <div style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Puzzle size={18} />
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Plugins de tercers</h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary, #94a3b8)', marginBottom: 12 }}>
                Plugins instal·lats a <code>.gnosi/plugins/</code>. Corren aïllats en sandbox i només
                poden fer el que declaren i tu aprovis.
            </p>

            {loading && <div style={{ fontSize: 13, color: 'var(--text-tertiary, #94a3b8)' }}>Carregant…</div>}
            {!loading && installed.length === 0 && (
                <div style={{
                    fontSize: 13, color: 'var(--text-tertiary, #94a3b8)', padding: '12px 14px',
                    borderRadius: 10, border: '1px dashed var(--border-primary, #e2e8f0)',
                }}>
                    Cap plugin de tercers instal·lat. Copia una carpeta de plugin (amb el seu
                    <code> manifest.json</code>) a <code>.gnosi/plugins/</code>.
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {installed.map((p) => {
                    if (!p.manifest) {
                        return (
                            <div key={p.id} style={{
                                padding: '12px 14px', borderRadius: 10, fontSize: 13, color: '#dc2626',
                                border: '1px solid #fecaca', background: '#fef2f2',
                            }}>
                                <strong>{p.id}</strong>: plugin trencat — {p.error}
                            </div>
                        );
                    }
                    const m = p.manifest;
                    const enabled = isEnabled(m.id);
                    const granted = p.granted || [];
                    const declared = m.permissions || [];
                    return (
                        <div key={m.id} style={{
                            padding: '12px 14px', borderRadius: 10,
                            border: '1px solid var(--border-primary, #e2e8f0)',
                            background: 'var(--bg-secondary, #f8fafc)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <Puzzle size={18} style={{ color: '#6366f1', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #0f172a)' }}>
                                        {m.name} <span style={{ fontSize: 11, color: 'var(--text-tertiary, #94a3b8)', fontWeight: 400 }}>v{m.version}</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                                        {m.description || 'Sense descripció'}{m.author ? ` · ${m.author}` : ''}
                                    </div>
                                </div>
                                <button
                                    type="button" role="switch" aria-checked={enabled}
                                    onClick={() => setPluginEnabled(m.id, !enabled)}
                                    style={{
                                        position: 'relative', width: 42, height: 24, borderRadius: 999,
                                        border: 'none', cursor: 'pointer', flexShrink: 0,
                                        background: enabled ? '#6366f1' : 'var(--border-primary, #cbd5e1)',
                                    }}
                                    title={enabled ? 'Desactiva' : 'Activa'}
                                >
                                    <span style={{
                                        position: 'absolute', top: 2, left: enabled ? 20 : 2, width: 20, height: 20,
                                        borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                    }} />
                                </button>
                            </div>

                            {declared.length > 0 && (
                                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary, #94a3b8)' }}>
                                        Permisos
                                    </span>
                                    {declared.map((perm) => (
                                        <label key={perm} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={granted.includes(perm)}
                                                onChange={() => togglePermission(m.id, declared, granted, perm)}
                                            />
                                            <code style={{ fontSize: 11 }}>{perm}</code>
                                            <span style={{ color: 'var(--text-tertiary, #94a3b8)' }}>{catalog[perm] || ''}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * Panell de configuració de Plugins: activa/desactiva les features opcionals
 * (registre intern). L'estat es persisteix per vault a `.gnosi/plugins.json`.
 */
const CONFIGURABLE = { 'daily-notes': DailyNotesConfig };

export function PluginsSettings() {
    const { isEnabled, setPluginEnabled } = usePlugins();
    const [openConfig, setOpenConfig] = useState(null);

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Puzzle size={18} />
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Plugins</h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary, #94a3b8)', marginBottom: 16 }}>
                Activa o desactiva les funcionalitats opcionals del Vault. Els canvis es desen per vault.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {BUILTIN_PLUGINS.map((plugin) => {
                    const Icon = ICONS[plugin.icon] || Puzzle;
                    const enabled = isEnabled(plugin.id);
                    const ConfigPanel = CONFIGURABLE[plugin.id];
                    const showConfig = ConfigPanel && enabled && openConfig === plugin.id;
                    return (
                        <div
                            key={plugin.id}
                            style={{
                                display: 'flex', flexDirection: 'column', gap: 0,
                                padding: '12px 14px', borderRadius: 10,
                                border: '1px solid var(--border-primary, #e2e8f0)',
                                background: 'var(--bg-secondary, #f8fafc)',
                            }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <Icon size={18} style={{ color: '#6366f1', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #0f172a)' }}>
                                    {plugin.name}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                                    {plugin.description}
                                </div>
                            </div>
                            {ConfigPanel && enabled && (
                                <button
                                    type="button"
                                    onClick={() => setOpenConfig((cur) => (cur === plugin.id ? null : plugin.id))}
                                    aria-label="Configura"
                                    title="Configura"
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                        border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                                        background: showConfig ? '#eef2ff' : 'transparent',
                                        color: showConfig ? '#6366f1' : 'var(--text-tertiary, #94a3b8)',
                                    }}
                                >
                                    <Settings size={16} />
                                </button>
                            )}
                            <button
                                type="button"
                                role="switch"
                                aria-checked={enabled}
                                onClick={() => setPluginEnabled(plugin.id, !enabled)}
                                style={{
                                    position: 'relative', width: 42, height: 24, borderRadius: 999,
                                    border: 'none', cursor: 'pointer', flexShrink: 0,
                                    background: enabled ? '#6366f1' : 'var(--border-primary, #cbd5e1)',
                                    transition: 'background 0.15s',
                                }}
                                title={enabled ? 'Desactiva' : 'Activa'}
                            >
                                <span
                                    style={{
                                        position: 'absolute', top: 2, left: enabled ? 20 : 2,
                                        width: 20, height: 20, borderRadius: '50%', background: '#fff',
                                        transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                    }}
                                />
                            </button>
                          </div>
                          {showConfig && <ConfigPanel />}
                        </div>
                    );
                })}
            </div>

            <ThirdPartyPlugins />
        </div>
    );
}

export default PluginsSettings;
