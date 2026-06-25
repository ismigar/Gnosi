import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Cpu, Plus, Trash2, Save, Server, Cloud } from 'lucide-react';

/**
 * Editor del registry de models del router (data-driven) + política de pressupost.
 * Consumeix GET/PUT /api/ai/models. El router (backend/agent/model_router.py) tria el
 * model per petició segons capacitat + disponibilitat + tokens/cost.
 */
const EMPTY_MODEL = {
    provider: '', model_id: '', is_local: false, enabled: true, priority: 100,
    cost_in: 0, cost_out: 0, context_window: 8192, quality: 2, tags: [], monthly_quota: 0,
};

const QUALITY_LABELS = { 1: 'Ràpid', 2: 'Equilibrat', 3: 'Alta qualitat' };
const TAG_OPTIONS = ['fast', 'code', 'vision', 'long', 'tools'];

export default function ModelRegistrySettings() {
    const [models, setModels] = useState([]);
    const [budget, setBudget] = useState({ prefer_local: false, remaining_tokens: '', prefer_local_below: 0 });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const { data } = await axios.get('/api/ai/models');
            setModels((data.models || []).map(m => ({ ...EMPTY_MODEL, ...m })));
            setBudget({ prefer_local: false, remaining_tokens: '', prefer_local_below: 0, ...(data.budget || {}) });
        } catch (e) {
            setError(String(e?.response?.data?.detail || e.message));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const update = (i, patch) => setModels(ms => ms.map((m, idx) => idx === i ? { ...m, ...patch } : m));
    const addRow = () => setModels(ms => [...ms, { ...EMPTY_MODEL }]);
    const removeRow = (i) => setModels(ms => ms.filter((_, idx) => idx !== i));
    const toggleTag = (i, tag) => update(i, {
        tags: models[i].tags.includes(tag) ? models[i].tags.filter(t => t !== tag) : [...models[i].tags, tag],
    });

    const save = async () => {
        setSaving(true); setError(''); setSaved(false);
        try {
            const payload = {
                models: models.map(m => ({ ...m, monthly_quota: Number(m.monthly_quota) || undefined })),
                budget: {
                    prefer_local: !!budget.prefer_local,
                    prefer_local_below: Number(budget.prefer_local_below) || 0,
                    ...(budget.remaining_tokens !== '' && budget.remaining_tokens != null
                        ? { remaining_tokens: Number(budget.remaining_tokens) } : {}),
                },
            };
            await axios.put('/api/ai/models', payload);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e) {
            setError(String(e?.response?.data?.detail || e.message));
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>Carregant models…</div>;

    const cell = { padding: '6px 8px', verticalAlign: 'middle' };
    const inp = { width: '100%', background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--settings-border)', borderRadius: 8, padding: '5px 8px', fontSize: '0.82rem' };

    return (
        <div style={{ marginTop: 32, padding: 24, borderRadius: 24, border: '1px solid var(--settings-border)', background: 'var(--settings-sidebar-bg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Cpu size={20} />
                    <div>
                        <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--text-primary)' }}>Models del router</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Registra els models (locals o remots); l'orquestrador tria segons la petició, tokens i cost.
                        </div>
                    </div>
                </div>
                <button className="btn-gnosi-primary" onClick={addRow}
                    style={{ padding: '8px 16px', fontSize: '0.82rem', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Plus size={15} /> Afegir model
                </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                        <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}>
                            <th style={cell}>On</th><th style={cell}>Proveïdor</th><th style={cell}>Model</th>
                            <th style={cell}>Qualitat</th><th style={cell}>Cost in/out</th><th style={cell}>Context</th>
                            <th style={cell}>Capacitats</th><th style={cell}>Actiu</th><th style={cell}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {models.map((m, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--settings-border)' }}>
                                <td style={cell}>
                                    <button title={m.is_local ? 'Local' : 'Remot'} onClick={() => update(i, { is_local: !m.is_local })}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: m.is_local ? 'var(--gnosi-primary)' : 'var(--text-tertiary)' }}>
                                        {m.is_local ? <Server size={18} /> : <Cloud size={18} />}
                                    </button>
                                </td>
                                <td style={cell}><input style={{ ...inp, width: 110 }} value={m.provider} placeholder="ollama" onChange={e => update(i, { provider: e.target.value })} /></td>
                                <td style={cell}><input style={{ ...inp, width: 170 }} value={m.model_id} placeholder="llama3.2" onChange={e => update(i, { model_id: e.target.value })} /></td>
                                <td style={cell}>
                                    <select style={{ ...inp, width: 130 }} value={m.quality} onChange={e => update(i, { quality: Number(e.target.value) })}>
                                        {[1, 2, 3].map(q => <option key={q} value={q}>{QUALITY_LABELS[q]}</option>)}
                                    </select>
                                </td>
                                <td style={cell}>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                        <input style={{ ...inp, width: 56 }} type="number" step="0.01" value={m.cost_in} onChange={e => update(i, { cost_in: Number(e.target.value) })} />
                                        <input style={{ ...inp, width: 56 }} type="number" step="0.01" value={m.cost_out} onChange={e => update(i, { cost_out: Number(e.target.value) })} />
                                    </div>
                                </td>
                                <td style={cell}><input style={{ ...inp, width: 80 }} type="number" value={m.context_window} onChange={e => update(i, { context_window: Number(e.target.value) })} /></td>
                                <td style={cell}>
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 180 }}>
                                        {TAG_OPTIONS.map(tag => (
                                            <button key={tag} onClick={() => toggleTag(i, tag)}
                                                style={{ fontSize: '0.68rem', padding: '2px 6px', borderRadius: 6, cursor: 'pointer',
                                                    border: '1px solid var(--settings-border)',
                                                    background: m.tags.includes(tag) ? 'var(--gnosi-primary)' : 'transparent',
                                                    color: m.tags.includes(tag) ? '#fff' : 'var(--text-secondary)' }}>{tag}</button>
                                        ))}
                                    </div>
                                </td>
                                <td style={cell}>
                                    <div className={`gnosi-toggle ${m.enabled ? 'active' : ''}`} onClick={() => update(i, { enabled: !m.enabled })}>
                                        <div className="gnosi-toggle-handle" />
                                    </div>
                                </td>
                                <td style={cell}>
                                    <button title="Treure" onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Política de pressupost */}
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--settings-border)' }}>
                <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 10 }}>Política de pressupost</div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        <div className={`gnosi-toggle ${budget.prefer_local ? 'active' : ''}`} onClick={() => setBudget(b => ({ ...b, prefer_local: !b.prefer_local }))}>
                            <div className="gnosi-toggle-handle" />
                        </div>
                        Prioritzar models locals (cost 0)
                    </label>
                    <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        Tokens de pagament restants:&nbsp;
                        <input style={{ ...inp, width: 120, display: 'inline-block' }} type="number" placeholder="(sense límit)"
                            value={budget.remaining_tokens ?? ''} onChange={e => setBudget(b => ({ ...b, remaining_tokens: e.target.value }))} />
                    </label>
                    <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        Si en queden menys de:&nbsp;
                        <input style={{ ...inp, width: 110, display: 'inline-block' }} type="number"
                            value={budget.prefer_local_below ?? 0} onChange={e => setBudget(b => ({ ...b, prefer_local_below: e.target.value }))} />
                        &nbsp;→ local
                    </label>
                </div>
            </div>

            <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
                <button className="btn-gnosi-primary" onClick={save} disabled={saving}
                    style={{ padding: '10px 20px', fontSize: '0.85rem', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Save size={16} /> {saving ? 'Desant…' : 'Desar models'}
                </button>
                {saved && <span style={{ color: 'var(--gnosi-primary)', fontSize: '0.82rem', fontWeight: 700 }}>✓ Desat</span>}
                {error && <span style={{ color: '#e05252', fontSize: '0.82rem' }}>{error}</span>}
            </div>
        </div>
    );
}
