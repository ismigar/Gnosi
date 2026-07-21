import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { Plus, Trash2, Server, Cloud, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from '../lib/toast';
import { ConfirmModal } from './ConfirmModal';

/**
 * Editor for the router's model registry (data-driven) + budget policy.
 * Consumes GET/PUT /api/ai/models. The router (backend/agent/model_router.py) selects the
 * model per request based on capability + availability + tokens/cost.
 *
 * Provider/model are hierarchical dropdowns fed by GET /api/ai/model-catalog
 * (models.dev snapshot + live Ollama list); picking a model auto-fills cost,
 * context window, capabilities and quality. Cost and context window are
 * provider-defined and therefore read-only; capabilities and quality stay
 * editable. A "custom" escape hatch keeps free-text entry for
 * providers/models outside the catalog.
 * Cards + flex-wrap instead of a table: no horizontal scroll at any width.
 */
const EMPTY_MODEL = {
    provider: '', model_id: '', is_local: false, enabled: true, priority: 100,
    cost_in: 0, cost_out: 0, context_window: 8192, quality: 2, tags: [], monthly_quota: 0,
    // Prices are owned by the catalog (read-only in the UI); until a catalogued
    // model is picked there is no price to show.
    price_from_catalog: false, price_unknown: true,
};

const QUALITY_LABELS = { 1: 'Ràpid', 2: 'Equilibrat', 3: 'Alta qualitat' };
const QUALITY_KEYS = { 1: 'quality_fast', 2: 'quality_balanced', 3: 'quality_high' };
// Capability tags: stored verbatim in model.tags and matched by the backend router
// (backend/agent/model_router.py) — never translate these, they are data, not labels.
const TAG_OPTIONS = ['fast', 'code', 'vision', 'long', 'tools', 'reasoning'];

const CUSTOM = '__custom__';

/** Small labelled group used inside a model card (label on top, control below). */
function Field({ label, children }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
            {children}
        </div>
    );
}

export default function ModelRegistrySettings() {
    const { t } = useTranslation();
    const ta = useCallback((k, opts) => t('settings.ai.model_registry.' + k, opts), [t]);
    const [models, setModels] = useState([]);
    const [catalog, setCatalog] = useState(null); // {providers: [{id, name, is_local, connected, models: [...]}]}
    const [budget, setBudget] = useState({ prefer_local: false, remaining_tokens: '', prefer_local_below: 0, monthly_cost_cap: '' });
    const [usage, setUsage] = useState(null); // GET /api/ai/usage: period spend + currency
    const [loading, setLoading] = useState(true);
    // Silent autosave (see useEffect below): no save button, no "saved" badge.
    const initializedRef = useRef(false);
    const skipNextAutosaveRef = useRef(false);
    // Rows where the user chose free-text entry instead of the catalog dropdowns
    const [customProviderRows, setCustomProviderRows] = useState(() => new Set());
    const [customModelRows, setCustomModelRows] = useState(() => new Set());
    // Pending row removal awaiting confirmation: {index, label} | null
    const [confirmRemove, setConfirmRemove] = useState(null);

    const loadUsage = useCallback(async () => {
        // Spend panel is best-effort: the registry stays editable without it
        try {
            const { data } = await axios.get('/api/ai/usage');
            setUsage(data || null);
        } catch { setUsage(null); }
    }, []);

    const load = useCallback(async () => {
        try {
            const [{ data }, catalogRes] = await Promise.all([
                axios.get('/api/ai/models'),
                // The registry must stay editable even if the catalog is unreachable
                axios.get('/api/ai/model-catalog').catch(() => null),
                loadUsage(),
            ]);
            // Mark skip before applying the setters, otherwise the autosave
            // effect would fire with the payload just loaded from the backend.
            skipNextAutosaveRef.current = true;
            setModels((data.models || []).map(m => ({ ...EMPTY_MODEL, ...m })));
            setBudget({
                prefer_local: false, remaining_tokens: '', prefer_local_below: 0,
                monthly_cost_cap: '', ...(data.budget || {}),
            });
            setCatalog(catalogRes?.data?.providers?.length ? catalogRes.data : null);
            initializedRef.current = true;
        } catch (e) {
            toast.error(ta('load_error', 'Error carregant els models'));
            console.error('ModelRegistrySettings load:', e);
        } finally {
            setLoading(false);
        }
    }, [loadUsage, ta]);

    useEffect(() => { load(); }, [load]);

    const providersById = useMemo(() => {
        const map = {};
        for (const p of catalog?.providers || []) map[p.id] = p;
        return map;
    }, [catalog]);

    const update = (i, patch) => setModels(ms => ms.map((m, idx) => idx === i ? { ...m, ...patch } : m));
    const addRow = () => setModels(ms => [...ms, { ...EMPTY_MODEL }]);
    const removeRow = (i) => {
        setModels(ms => ms.filter((_, idx) => idx !== i));
        // Row indexes shift after removal: rebuild the custom-mode sets
        const shift = (set) => new Set([...set].filter(idx => idx !== i).map(idx => idx > i ? idx - 1 : idx));
        setCustomProviderRows(shift);
        setCustomModelRows(shift);
    };
    const requestRemoveRow = (i) => {
        const m = models[i] || {};
        // Nothing typed yet → nothing to protect; skip the confirmation
        if (!m.provider && !m.model_id) { removeRow(i); return; }
        setConfirmRemove({ index: i, label: [m.provider, m.model_id].filter(Boolean).join(' · ') });
    };
    const setRowCustom = (setter, i, on) => setter(prev => {
        const next = new Set(prev);
        if (on) next.add(i); else next.delete(i);
        return next;
    });
    const toggleTag = (i, tag) => update(i, {
        tags: models[i].tags.includes(tag) ? models[i].tags.filter(t => t !== tag) : [...models[i].tags, tag],
    });

    // Switching provider clears the model: also reset the per-model metadata
    // to neutral defaults — otherwise the previous model's cost/context/tags
    // linger in the fields and read as if they belonged to the new provider.
    const MODEL_META_RESET = {
        cost_in: 0, cost_out: 0,
        price_from_catalog: false, price_unknown: true,
        context_window: EMPTY_MODEL.context_window,
        quality: EMPTY_MODEL.quality, tags: [],
    };

    const onProviderChange = (i, value) => {
        if (value === CUSTOM) {
            setRowCustom(setCustomProviderRows, i, true);
            setRowCustom(setCustomModelRows, i, true);
            update(i, { provider: '', model_id: '', ...MODEL_META_RESET });
            return;
        }
        const entry = providersById[value];
        update(i, {
            provider: value, model_id: '', ...MODEL_META_RESET,
            ...(entry ? { is_local: !!entry.is_local } : {}),
        });
        setRowCustom(setCustomModelRows, i, false);
    };

    const onModelChange = (i, providerId, value) => {
        const isLocal = !!providersById[providerId]?.is_local;
        if (value === CUSTOM) {
            setRowCustom(setCustomModelRows, i, true);
            // Free-text model: outside the catalog, so it has no known price
            update(i, { model_id: '', cost_in: 0, cost_out: 0,
                price_from_catalog: false, price_unknown: !isLocal });
            return;
        }
        const entry = (providersById[providerId]?.models || []).find(m => m.id === value);
        if (!entry) {
            update(i, { model_id: value, price_from_catalog: false, price_unknown: !isLocal });
            return;
        }
        // Auto-fill metadata from the catalog. Cost and context window are
        // READ-ONLY from here on (the catalog/provider owns them);
        // quality/tags stay editable.
        update(i, {
            model_id: entry.id,
            cost_in: entry.cost_in, cost_out: entry.cost_out,
            price_from_catalog: true, price_unknown: false,
            context_window: entry.context_window,
            quality: entry.quality, tags: entry.tags || [],
            is_local: isLocal,
        });
    };

    // Silent autosave (800ms debounce, same cadence as SettingsModal): there is
    // no save button — every edit to models/budget persists on its own. The
    // skip flag suppresses the autosave triggered by load() applying the
    // backend payload to state. Errors surface via toast, not inline text.
    useEffect(() => {
        if (!initializedRef.current) return;
        if (skipNextAutosaveRef.current) {
            skipNextAutosaveRef.current = false;
            return;
        }
        const handle = setTimeout(async () => {
            try {
                const payload = {
                    models: models.map(m => ({ ...m, monthly_quota: Number(m.monthly_quota) || undefined })),
                    budget: {
                        prefer_local: !!budget.prefer_local,
                        prefer_local_below: Number(budget.prefer_local_below) || 0,
                        ...(budget.remaining_tokens !== '' && budget.remaining_tokens != null
                            ? { remaining_tokens: Number(budget.remaining_tokens) } : {}),
                        ...(Number(budget.monthly_cost_cap) > 0
                            ? { monthly_cost_cap: Number(budget.monthly_cost_cap) } : {}),
                    },
                };
                await axios.put('/api/ai/models', payload);
                loadUsage(); // the cap/ratio shown in the spend panel just changed
            } catch (e) {
                console.error('ModelRegistrySettings autosave:', e);
                toast.error(ta('save_error', 'No s\'han pogut desar els canvis'));
            }
        }, 800);
        return () => clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [models, budget]);

    if (loading) return <div style={{ padding: 24, color: 'var(--text-secondary)' }}>{ta('loading', 'Carregant models…')}</div>;

    const inp = { background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--settings-border)', borderRadius: 8, padding: '5px 8px', fontSize: '0.82rem', minWidth: 0 };
    const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center' };
    // Spend figures come in the Settings currency (GET /api/ai/usage)
    const currencySymbol = usage?.currency?.symbol || '€';
    const fmtCcy = (v) => `${Number(v || 0).toFixed(2)} ${currencySymbol}`;
    // Catalog prices are USD per 1M tokens. Sub-0.1 tariffs need 3 decimals
    // (0.038 must not collapse to 0.04); trailing zeros are stripped so the
    // common cases read as "0.6" and "15", not "0.60" and "15.00".
    const fmtPrice = (v) => {
        const n = Number(v || 0);
        if (!n) return '0';
        return (n < 0.1 ? n.toFixed(3) : n.toFixed(2)).replace(/\.?0+$/, '');
    };
    // Context windows come from the catalog (provider-defined) and are shown
    // read-only. K-suffix keeps large limits legible (128K, 1M) without losing
    // precision on small ones (8 192 stays explicit).
    const fmtContext = (v) => {
        const n = Number(v || 0);
        if (!n) return '0';
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0).replace(/\.0$/, '')}M`;
        if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
        return String(n);
    };

    const renderProviderControl = (m, i) => {
        const isCustom = customProviderRows.has(i) || (m.provider && !providersById[m.provider] && catalog);
        if (!catalog || isCustom) {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input style={{ ...inp, width: 120 }} value={m.provider} placeholder="ollama"
                        onChange={e => update(i, { provider: e.target.value.trim().toLowerCase() })} />
                    {catalog && (
                        <button title={ta('back_to_list', 'Tornar a la llista')} style={iconBtn}
                            onClick={() => { setRowCustom(setCustomProviderRows, i, false); update(i, { provider: '', model_id: '' }); }}>
                            <List size={14} color="var(--text-tertiary)" />
                        </button>
                    )}
                </div>
            );
        }
        // Usable providers first (credential/env present, or local), the rest
        // of the catalog after — 160+ options stay navigable.
        const connected = (catalog.providers || []).filter(p => p.connected);
        const others = (catalog.providers || []).filter(p => !p.connected);
        const opt = p => (
            <option key={p.id} value={p.id}>{p.name}{p.live ? ' ●' : ''}</option>
        );
        return (
            <select style={{ ...inp, width: 150 }} value={m.provider}
                onChange={e => onProviderChange(i, e.target.value)}>
                <option value="">{t('settings.ai.select_provider_option')}</option>
                {connected.length > 0 && (
                    <optgroup label={ta('connected_group', 'Connectats')}>{connected.map(opt)}</optgroup>
                )}
                {others.length > 0 && (
                    <optgroup label={ta('all_providers_group', 'Tots els proveïdors')}>{others.map(opt)}</optgroup>
                )}
                <option value={CUSTOM}>{ta('custom_option', 'Personalitzat…')}</option>
            </select>
        );
    };

    const renderModelControl = (m, i) => {
        const providerEntry = providersById[m.provider];
        const providerIsCustom = customProviderRows.has(i) || (m.provider && !providerEntry && catalog);
        const isCustom = customModelRows.has(i) || providerIsCustom || !catalog;
        if (isCustom) {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 200px', minWidth: 0 }}>
                    <input style={{ ...inp, flex: 1 }} value={m.model_id} placeholder="llama3.2"
                        onChange={e => update(i, { model_id: e.target.value.trim() })} />
                    {catalog && providerEntry && (
                        <button title={ta('back_to_list', 'Tornar a la llista')} style={iconBtn}
                            onClick={() => { setRowCustom(setCustomModelRows, i, false); update(i, { model_id: '' }); }}>
                            <List size={14} color="var(--text-tertiary)" />
                        </button>
                    )}
                </div>
            );
        }
        const catalogModels = providerEntry?.models || [];
        const inCatalog = catalogModels.some(cm => cm.id === m.model_id);
        return (
            <select style={{ ...inp, flex: '1 1 200px' }} value={m.model_id} disabled={!m.provider}
                onChange={e => onModelChange(i, m.provider, e.target.value)}>
                <option value="">{t('settings.ai.select_model_option')}</option>
                {/* Registry rows saved before this catalog existed (or with retired ids)
                    must keep their value visible instead of silently blanking out */}
                {m.model_id && !inCatalog && <option value={m.model_id}>{m.model_id}</option>}
                {catalogModels.map(cm => (
                    <option key={cm.id} value={cm.id} title={cm.id}>{cm.name}</option>
                ))}
                <option value={CUSTOM}>{ta('custom_option', 'Personalitzat…')}</option>
            </select>
        );
    };

    return (
        <div style={{ padding: 24, borderRadius: 24, border: '1px solid var(--settings-border)', background: 'var(--settings-sidebar-bg)' }}>
            {/* Section title/icon live in GlobalSettingsModal's <Section> wrapper */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {ta('subtitle', "Registra els models (locals o remots); l'orquestrador tria segons la petició, tokens i cost.")}
                    </div>
                    {catalog && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                            {ta('catalog_hint', {
                                defaultValue: 'Catàleg de models actualitzat automàticament (font: {{source}}).',
                                source: catalog.source || 'models.dev',
                            })}
                        </div>
                    )}
                </div>
                <button className="btn-gnosi-primary" onClick={addRow}
                    style={{ padding: '8px 16px', fontSize: '0.82rem', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <Plus size={15} /> {ta('add_model', 'Afegir model')}
                </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {models.map((m, i) => (
                    <div key={i} style={{ border: '1px solid var(--settings-border)', borderRadius: 14, padding: '10px 14px', background: 'var(--bg-primary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {/* Marking a row local also settles its price: local
                                models are free, not "unknown price" */}
                            <button title={m.is_local ? ta('local_tooltip', 'Local') : ta('remote_tooltip', 'Remot')}
                                onClick={() => update(i, { is_local: !m.is_local, price_unknown: m.is_local && !m.price_from_catalog })}
                                style={{ ...iconBtn, color: m.is_local ? 'var(--gnosi-primary)' : 'var(--text-tertiary)' }}>
                                {m.is_local ? <Server size={18} /> : <Cloud size={18} />}
                            </button>
                            {renderProviderControl(m, i)}
                            {renderModelControl(m, i)}
                            {catalog && providersById[m.provider] && !providersById[m.provider].connected && !m.is_local && (
                                <span
                                    title={ta('not_connected_tooltip', "El router ometrà aquest model: el proveïdor no té cap credencial configurada. Connecta'l a «Proveïdors de Models».")}
                                    style={{ fontSize: '0.68rem', fontWeight: 800, padding: '2px 8px', borderRadius: 8,
                                        background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', whiteSpace: 'nowrap' }}>
                                    {ta('not_connected_badge', 'Sense connectar')}
                                </span>
                            )}
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div className={`gnosi-toggle ${m.enabled ? 'active' : ''}`} title={ta('col_active', 'Actiu')}
                                    onClick={() => update(i, { enabled: !m.enabled })}>
                                    <div className="gnosi-toggle-handle" />
                                </div>
                                <button title={ta('remove_model', 'Treure')} onClick={() => requestRemoveRow(i)}
                                    style={{ ...iconBtn, color: 'var(--text-tertiary)' }}>
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
                            <Field label={ta('col_quality', 'Qualitat')}>
                                <select style={{ ...inp, width: 128 }} value={m.quality} onChange={e => update(i, { quality: Number(e.target.value) })}>
                                    {[1, 2, 3].map(q => <option key={q} value={q}>{ta(QUALITY_KEYS[q], QUALITY_LABELS[q])}</option>)}
                                </select>
                            </Field>
                            {/* Read-only: the catalog owns prices (models.dev,
                                refreshed daily). An editable field here froze a
                                tariff into params.yaml that silently rotted. */}
                            <Field label={ta('col_cost', 'Cost in/out ($/M)')}>
                                <div title={m.price_unknown
                                    ? ta('price_unknown_tooltip', 'Model fora del catàleg: es comptabilitza com a cost 0.')
                                    : ta('price_catalog_tooltip', 'Preu del catàleg (models.dev), actualitzat automàticament.')}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, fontSize: '0.82rem',
                                        color: m.price_unknown ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                                    {m.price_unknown ? (
                                        <span>{ta('price_unknown', 'desconegut')}</span>
                                    ) : (
                                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                            {fmtPrice(m.cost_in)} / {fmtPrice(m.cost_out)}
                                        </span>
                                    )}
                                </div>
                            </Field>
                            {/* Read-only: context window comes from the catalog
                                (provider-defined), same as cost. An editable field
                                here froze a provider limit into params.yaml that
                                silently drifted from reality. */}
                            <Field label={ta('col_context', 'Context')}>
                                <div title={m.price_unknown
                                    ? ta('context_unknown_tooltip', 'Model fora del catàleg: no se\'n coneix el context.')
                                    : ta('context_catalog_tooltip', 'Finestra de context del catàleg (models.dev), definida pel proveïdor.')}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, fontSize: '0.82rem',
                                        color: m.price_unknown ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                        {m.price_unknown
                                            ? ta('context_unknown', 'desconegut')
                                            : fmtContext(m.context_window)}
                                    </span>
                                </div>
                            </Field>
                            <Field label={ta('col_capabilities', 'Capacitats')}>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {TAG_OPTIONS.map(tag => (
                                        <button key={tag} onClick={() => toggleTag(i, tag)}
                                            style={{ fontSize: '0.68rem', padding: '2px 6px', borderRadius: 6, cursor: 'pointer',
                                                border: '1px solid var(--settings-border)',
                                                background: m.tags.includes(tag) ? 'var(--gnosi-primary)' : 'transparent',
                                                color: m.tags.includes(tag) ? '#fff' : 'var(--text-secondary)' }}>{tag}</button>
                                    ))}
                                </div>
                            </Field>
                        </div>
                    </div>
                ))}
            </div>

            {/* Budget policy */}
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--settings-border)' }}>
                <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 10 }}>{ta('budget_policy_title', 'Política de pressupost')}</div>

                {/* Monthly money cap (Settings currency) + live spend meter */}
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
                    <Field label={`${ta('cost_cap_label', 'Sostre de despesa mensual')} (${currencySymbol})`}>
                        <input style={{ ...inp, width: 140 }} type="number" min="0" step="0.5"
                            placeholder={ta('cost_cap_none', '(sense sostre)')}
                            value={budget.monthly_cost_cap ?? ''}
                            onChange={e => setBudget(b => ({ ...b, monthly_cost_cap: e.target.value }))} />
                    </Field>
                    {usage && (
                        <div style={{ flex: '1 1 260px', minWidth: 220 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                                <span>{ta('spent_this_month', 'Gastat aquest mes')} ({usage.period})</span>
                                <span style={{ fontWeight: 800, color: usage.over_cap ? '#ef4444' : 'var(--text-primary)' }}>
                                    {fmtCcy(usage.spent_ccy)}{usage.cap_ccy ? ` / ${fmtCcy(usage.cap_ccy)}` : ''}
                                </span>
                            </div>
                            {usage.cap_ccy > 0 && (
                                <div style={{ height: 8, borderRadius: 6, background: 'var(--settings-border)', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', borderRadius: 6, transition: 'width 0.3s',
                                        width: `${Math.min(100, (usage.ratio || 0) * 100)}%`,
                                        background: usage.over_cap ? '#ef4444' : ((usage.ratio || 0) >= 0.8 ? '#f59e0b' : 'var(--gnosi-primary)') }} />
                                </div>
                            )}
                            {usage.over_cap && (
                                <div style={{ marginTop: 6, fontSize: '0.75rem', fontWeight: 700, color: '#ef4444' }}>
                                    {ta('budget_exhausted_warning', 'Sostre assolit: el router només farà servir models de cost 0 (locals).')}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        <div className={`gnosi-toggle ${budget.prefer_local ? 'active' : ''}`} onClick={() => setBudget(b => ({ ...b, prefer_local: !b.prefer_local }))}>
                            <div className="gnosi-toggle-handle" />
                        </div>
                        {ta('prefer_local_label', 'Prioritzar models locals (cost 0)')}
                    </label>
                    <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        {ta('remaining_tokens_label', 'Tokens de pagament restants:')}&nbsp;
                        <input style={{ ...inp, width: 120, display: 'inline-block' }} type="number" placeholder={ta('remaining_tokens_placeholder', '(sense límit)')}
                            value={budget.remaining_tokens ?? ''} onChange={e => setBudget(b => ({ ...b, remaining_tokens: e.target.value }))} />
                    </label>
                    <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        {ta('budget_below_label', 'Si en queden menys de:')}&nbsp;
                        <input style={{ ...inp, width: 110, display: 'inline-block' }} type="number"
                            value={budget.prefer_local_below ?? 0} onChange={e => setBudget(b => ({ ...b, prefer_local_below: e.target.value }))} />
                        &nbsp;{ta('budget_below_suffix', '→ local')}
                    </label>
                </div>

                {/* Per-model spend breakdown for the current period */}
                {(usage?.per_model?.length || 0) > 0 && (
                    <details style={{ marginTop: 14 }}>
                        <summary style={{ cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                            {ta('spend_breakdown', 'Desglossament per model')}
                        </summary>
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {usage.per_model.map((row, idx) => (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.78rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                                    <span style={{ fontFamily: 'monospace', minWidth: 0, overflowWrap: 'anywhere' }}>{row.provider}:{row.model_id}</span>
                                    <span style={{ whiteSpace: 'nowrap' }}>
                                        {(row.in + row.out).toLocaleString()} tokens · <b style={{ color: 'var(--text-primary)' }}>{fmtCcy(row.cost_ccy)}</b>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </details>
                )}
            </div>

            {/* Row removal confirmation. Portal to <body>: this component sits
                inside the Settings panel, whose animated (transformed)
                ancestors trap ConfirmModal's position:fixed overlay and clip
                it invisible (memory feedback_fixed_portal_animated_ancestor).
                Esc-wise the useModalKeyboard layer stack still guarantees only
                this dialog closes, not the Settings modal underneath. */}
            {confirmRemove && createPortal(
                <ConfirmModal
                    isOpen={!!confirmRemove}
                    onClose={() => setConfirmRemove(null)}
                    onConfirm={() => {
                        if (confirmRemove) removeRow(confirmRemove.index);
                        setConfirmRemove(null);
                    }}
                    title={ta('remove_confirm_title', 'Treure el model del registre?')}
                    message={ta('remove_confirm_msg', {
                        defaultValue: 'Es traurà «{{model}}» de la llista del router. El canvi es desa automàticament.',
                        model: confirmRemove?.label || '',
                    })}
                    confirmText={ta('remove_model', 'Treure')}
                    isDestructive={true}
                />,
                document.body,
            )}
        </div>
    );
}
