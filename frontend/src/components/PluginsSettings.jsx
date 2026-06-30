import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { CalendarDays, Hash, MessageSquare, Share2, LayoutDashboard, Puzzle, Settings } from 'lucide-react';
import { BUILTIN_PLUGINS } from '../plugins/registry';
import { usePlugins } from '../plugins/usePlugins';

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
        </div>
    );
}

export default PluginsSettings;
