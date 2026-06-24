import React from 'react';
import { CalendarDays, Hash, MessageSquare, Share2, LayoutDashboard, Puzzle } from 'lucide-react';
import { BUILTIN_PLUGINS } from '../plugins/registry';
import { usePlugins } from '../plugins/usePlugins';

const ICONS = { CalendarDays, Hash, MessageSquare, Share2, LayoutDashboard };

/**
 * Panell de configuració de Plugins: activa/desactiva les features opcionals
 * (registre intern). L'estat es persisteix per vault a `.gnosi/plugins.json`.
 */
export function PluginsSettings() {
    const { isEnabled, setPluginEnabled } = usePlugins();

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
                    return (
                        <div
                            key={plugin.id}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '12px 14px', borderRadius: 10,
                                border: '1px solid var(--border-primary, #e2e8f0)',
                                background: 'var(--bg-secondary, #f8fafc)',
                            }}
                        >
                            <Icon size={18} style={{ color: '#6366f1', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #0f172a)' }}>
                                    {plugin.name}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                                    {plugin.description}
                                </div>
                            </div>
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
                    );
                })}
            </div>
        </div>
    );
}

export default PluginsSettings;
