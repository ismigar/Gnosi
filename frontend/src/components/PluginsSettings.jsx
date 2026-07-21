import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useTranslation, Trans } from 'react-i18next';
import { CalendarDays, Hash, MessageSquare, Share2, LayoutDashboard, BrainCircuit, Puzzle, Settings, Trash2, Upload, Download, ShieldCheck, Globe, KeyRound, Scissors } from 'lucide-react';
import { BUILTIN_PLUGINS } from '../plugins/registry';
import { usePlugins } from '../plugins/usePlugins';
import { reloadPlugins } from '../plugins/usePluginHost';

const ICONS = { CalendarDays, Hash, MessageSquare, Share2, LayoutDashboard, BrainCircuit, Scissors };

const SELECT_STYLE = {
    width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--border-primary, #e2e8f0)',
    background: 'var(--bg-primary, #fff)', color: 'var(--text-primary, #0f172a)',
};

/**
 * Configuration for the daily-notes plugin: allows using a database (table)
 * as the source of the "Daily Note" (e.g. "Logbook") instead of the
 * `Daily Notes/` folder. The date column is auto-detected (first field of type
 * `date`) and can be confirmed/changed. Clearing the DB reverts to the classic behavior.
 */
function DailyNotesConfig() {
    const { t } = useTranslation();
    const tp = (k, opts) => t('settings.plugins.' + k, opts);
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
                <Trans i18nKey="settings.plugins.daily_intro" components={{ code: <code /> }} />
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                    {tp('source_db')}
                </span>
                <select
                    style={SELECT_STYLE}
                    value={cfg.source_table_id || ''}
                    disabled={loading}
                    onChange={(e) => onPickTable(e.target.value)}
                >
                    <option value="">{tp('source_none')}</option>
                    {tables.map((t) => (
                        <option key={t.id} value={t.id}>{t.name || t.id}</option>
                    ))}
                </select>
            </label>

            {selectedTable && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                        {tp('date_column')}
                    </span>
                    {dateProps.length === 0 ? (
                        <span style={{ fontSize: 12, color: '#dc2626' }}>
                            {tp('no_date_column')}
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

/* Column types the browser extension can render as a form control. Mirrors
 * PROMPTABLE_TYPES in `backend/services/web_clipper.py`: computed columns and
 * the ones needing the app's own pickers cannot be filled from the popup. */
const CLIPPER_PROMPTABLE_TYPES = new Set([
    'text', 'rich_text', 'number', 'select', 'multi_select',
    'status', 'date', 'datetime', 'checkbox', 'url',
]);

/* Sentinel for "do not feed this role" (empty means auto-detect instead). */
const CLIPPER_NO_MAPPING = '__none__';

/**
 * Configuration for the web-clipper plugin: which table the browser extension
 * saves into, which columns receive the URL/tags/note, and which columns the
 * popup prompts for. With no table designated the clipper keeps its classic
 * behaviour (a note in `Clips/`).
 */
function WebClipperConfig() {
    const { t } = useTranslation();
    const tp = (k, opts) => t('settings.plugins.' + k, opts);
    const { getPluginSettings, setPluginSettings } = usePlugins();
    const cfg = getPluginSettings('web-clipper');
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        axios.get('/api/vault/tables')
            .then((res) => { if (alive) setTables(Array.isArray(res.data) ? res.data : []); })
            .catch((err) => { if (alive) { console.error('Web clipper: could not load tables:', err); setTables([]); } })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    const table = tables.find((tbl) => tbl.id === cfg.table_id) || null;
    const properties = (table?.properties || []).filter((p) => CLIPPER_PROMPTABLE_TYPES.has(p.type));
    const selectedFields = Array.isArray(cfg.fields) ? cfg.fields : [];

    const onPickTable = (tableId) => {
        // Changing table invalidates every column reference: keep nothing.
        setPluginSettings('web-clipper', {
            table_id: tableId,
            url_property: '',
            tags_property: '',
            content_property: '',
            fields: [],
        });
    };

    const toggleField = (fieldId) => {
        const next = selectedFields.includes(fieldId)
            ? selectedFields.filter((f) => f !== fieldId)
            : [...selectedFields, fieldId];
        setPluginSettings('web-clipper', { fields: next });
    };

    const roleSelect = (key, label, types) => (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>{label}</span>
            <select
                style={SELECT_STYLE}
                value={cfg[key] || ''}
                onChange={(e) => setPluginSettings('web-clipper', { [key]: e.target.value })}
            >
                <option value="">{tp('clipper_auto', { defaultValue: 'Automàtic' })}</option>
                <option value={CLIPPER_NO_MAPPING}>{tp('clipper_unmapped', { defaultValue: 'Cap columna' })}</option>
                {(table?.properties || [])
                    .filter((p) => types.includes(p.type))
                    .map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
            </select>
        </label>
    );

    return (
        <div style={{
            marginTop: 8, padding: '12px 14px', borderRadius: 10,
            border: '1px dashed var(--border-primary, #e2e8f0)',
            background: 'var(--bg-primary, #fff)',
            display: 'flex', flexDirection: 'column', gap: 12,
        }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                {tp('clipper_intro', { defaultValue: 'Tria a quina taula desa l\'extensió del navegador. Els camps que marquis apareixeran al formulari de l\'extensió per omplir-los abans de desar.' })}
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                    {tp('clipper_table', { defaultValue: 'Taula destí' })}
                </span>
                <select
                    style={SELECT_STYLE}
                    value={cfg.table_id || ''}
                    disabled={loading}
                    onChange={(e) => onPickTable(e.target.value)}
                >
                    <option value="">{tp('clipper_table_none', { defaultValue: 'Cap (nota a la carpeta Clips/)' })}</option>
                    {tables.map((tbl) => (
                        <option key={tbl.id} value={tbl.id}>{tbl.name || tbl.id}</option>
                    ))}
                </select>
            </label>

            {table && (
                <>
                    {roleSelect('url_property', tp('clipper_url_column', { defaultValue: 'Columna de l\'URL' }), ['url', 'text'])}
                    {roleSelect('tags_property', tp('clipper_tags_column', { defaultValue: 'Columna d\'etiquetes' }), ['multi_select'])}
                    {roleSelect('content_property', tp('clipper_content_column', { defaultValue: 'Columna de la nota' }), ['text', 'rich_text'])}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                            {tp('clipper_fields', { defaultValue: 'Camps que demana l\'extensió' })}
                        </span>
                        {properties.length === 0 ? (
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                                {tp('clipper_no_fields', { defaultValue: 'Aquesta taula no té columnes que es puguin omplir des del navegador.' })}
                            </span>
                        ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {properties.map((p) => {
                                    const checked = selectedFields.includes(p.id);
                                    return (
                                        <label
                                            key={p.id}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                                                padding: '5px 9px', borderRadius: 999, fontSize: 12,
                                                border: '1px solid var(--border-primary, #e2e8f0)',
                                                background: checked ? '#eef2ff' : 'var(--bg-secondary, #f8fafc)',
                                                color: checked ? '#4338ca' : 'var(--text-secondary, #475569)',
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleField(p.id)}
                                                style={{ margin: 0 }}
                                            />
                                            {p.name || p.id}
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

/**
 * Configuration for the llm-wiki plugin: designates which table plays the
 * "Cervell" (LLM Wiki knowledge base) role. Mirrors the References designation
 * but per-vault (`<vault>/.gnosi/llm_wiki.json`). The backend guarantees the
 * knowledge schema (Tipus, Fonts→Recursos, verification status, ...).
 */
function LlmWikiConfig() {
    const { t } = useTranslation();
    const tp = (k, opts) => t('settings.plugins.' + k, opts);
    const [tables, setTables] = useState([]);
    const [brain, setBrain] = useState({ table_id: null, configured: false, name: null });
    const [busy, setBusy] = useState(false);
    const [lint, setLint] = useState(null);
    const [lintBusy, setLintBusy] = useState(false);
    const [pendingSuggestions, setPendingSuggestions] = useState(0);

    const reload = () => Promise.all([
        axios.get('/api/vault/tables').then((r) => (Array.isArray(r.data) ? r.data : [])).catch(() => []),
        axios.get('/api/vault/brain-table').then((r) => r.data || {}).catch(() => ({})),
        axios.get('/api/vault/llm-wiki/suggestions').then((r) => (r.data?.suggestions || []).length).catch(() => 0),
    ]).then(([tbls, b, pending]) => { setTables(tbls); setBrain(b); setPendingSuggestions(pending); });

    const runLint = async () => {
        setLintBusy(true);
        try {
            const r = await axios.get('/api/vault/llm-wiki/lint');
            setLint(r.data || null);
        } catch (err) {
            console.error('llm-wiki lint error:', err);
        } finally { setLintBusy(false); }
    };

    useEffect(() => { reload(); return undefined; }, []);

    const onPick = async (tableId) => {
        setBusy(true);
        try {
            if (!tableId) {
                await axios.delete('/api/vault/brain-table');
            } else {
                await axios.post('/api/vault/brain-table', { table_id: tableId });
            }
            await reload();
        } catch (err) {
            console.error('Set brain table error:', err);
        } finally { setBusy(false); }
    };

    const onCreate = async () => {
        setBusy(true);
        try {
            await axios.post('/api/vault/brain-table/create', {});
            await reload();
        } catch (err) {
            console.error('Create brain table error:', err);
        } finally { setBusy(false); }
    };

    return (
        <div style={{
            marginTop: 8, padding: '12px 14px', borderRadius: 10,
            border: '1px dashed var(--border-primary, #e2e8f0)',
            background: 'var(--bg-primary, #fff)',
            display: 'flex', flexDirection: 'column', gap: 12,
        }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                {tp('llm_wiki_intro', { defaultValue: 'Tria quina taula fa de Cervell (base de coneixement). Les notes generades s\'hi guarden, enllaçades als recursos font.' })}
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                    {tp('llm_wiki_table', { defaultValue: 'Taula del Cervell' })}
                </span>
                <select
                    style={SELECT_STYLE}
                    value={brain.table_id || ''}
                    disabled={busy}
                    onChange={(e) => onPick(e.target.value)}
                >
                    <option value="">{tp('llm_wiki_none', { defaultValue: 'Cap (desactivat)' })}</option>
                    {tables.map((tbl) => (
                        <option key={tbl.id} value={tbl.id}>{tbl.name || tbl.id}</option>
                    ))}
                </select>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                    type="button"
                    onClick={onCreate}
                    disabled={busy}
                    style={{
                        padding: '8px 14px', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                        border: '1px solid var(--border-primary, #e2e8f0)',
                        background: 'var(--bg-secondary, #f8fafc)', fontWeight: 600,
                        color: 'var(--text-primary, #0f172a)', fontSize: 13, opacity: busy ? 0.6 : 1,
                    }}
                >
                    {tp('llm_wiki_create', { defaultValue: 'Crea una taula Cervell' })}
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                    {brain.configured
                        ? tp('llm_wiki_active', { name: brain.name, defaultValue: `Actiu a «${brain.name}»` })
                        : tp('llm_wiki_inactive', { defaultValue: 'Cap taula designada encara.' })}
                    {brain.configured && pendingSuggestions > 0 && (
                        <span style={{ marginLeft: 8, fontWeight: 700, color: 'var(--gnosi-primary, #6366f1)' }}>
                            {tp('llm_wiki_pending', { count: pendingSuggestions, defaultValue: '{{count}} suggeriments pendents a la Bústia' })}
                        </span>
                    )}
                </span>
            </div>

            {brain.configured && (
                <div style={{ borderTop: '1px solid var(--border-primary, #e2e8f0)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button
                            type="button"
                            onClick={runLint}
                            disabled={lintBusy}
                            style={{
                                padding: '8px 14px', borderRadius: 8, cursor: lintBusy ? 'default' : 'pointer',
                                border: '1px solid var(--border-primary, #e2e8f0)',
                                background: 'var(--bg-secondary, #f8fafc)', fontWeight: 600,
                                color: 'var(--text-primary, #0f172a)', fontSize: 13, opacity: lintBusy ? 0.6 : 1,
                            }}
                        >
                            {tp('llm_wiki_lint_run', { defaultValue: 'Revisar el Cervell (lint)' })}
                        </button>
                        {lintBusy && <span style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>{tp('llm_wiki_lint_running', { defaultValue: 'Revisant…' })}</span>}
                    </div>
                    {lint && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary, #475569)', lineHeight: 1.6 }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary, #0f172a)', marginBottom: 4 }}>
                                {tp('llm_wiki_lint_summary', { count: lint.note_count, defaultValue: '{{count}} notes revisades' })}
                            </div>
                            <div>• {tp('llm_wiki_lint_orphans', { count: lint.counts?.orphans || 0, defaultValue: '{{count}} òrfenes (cap altra nota hi enllaça)' })}</div>
                            <div>• {tp('llm_wiki_lint_stale', { count: lint.counts?.stale || 0, defaultValue: '{{count}} sense revisar fa temps' })}</div>
                            <div>• {tp('llm_wiki_lint_xref', { count: lint.counts?.missing_xref || 0, defaultValue: '{{count}} referències creuades que falten' })}</div>
                            <div>• {tp('llm_wiki_lint_reprocess', { count: lint.counts?.reprocess || 0, defaultValue: '{{count}} recursos modificats després de processar-se' })}</div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * THIRD-PARTY plugins section (v2): plugins installed at `.gnosi/plugins/<id>/`
 * with their own manifest. Allows enabling/disabling, viewing and granting the
 * permissions they declare, and they run code in a sandbox (UI iframe / data Node). See
 * the `plugin_system.md` directive.
 */
function ThirdPartyPlugins() {
    const { t } = useTranslation();
    const tp = (k, opts) => t('settings.plugins.' + k, opts);
    const { isEnabled, setPluginEnabled } = usePlugins();
    const [installed, setInstalled] = useState([]);
    const [catalog, setCatalog] = useState({});
    const [gallery, setGallery] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [trustKeys, setTrustKeys] = useState([]);
    const [registryUrl, setRegistryUrl] = useState('');
    const [newKey, setNewKey] = useState({ name: '', public_key: '' });
    const fileRef = React.useRef(null);

    // Doesn't do synchronous setState: `loading` already starts as true and is set to false at the end
    // (avoids cascading renders; cf. react-hooks/set-state-in-effect).
    const refresh = () => Promise.all([
        axios.get('/api/vault/plugins/installed').then((r) => r.data?.plugins || []).catch(() => []),
        axios.get('/api/vault/plugins/catalog').then((r) => r.data?.permissions || {}).catch(() => ({})),
        axios.get('/api/vault/plugins/catalog/list').then((r) => r.data?.catalog || []).catch(() => []),
        axios.get('/api/vault/plugins/trust').then((r) => r.data?.keys || []).catch(() => []),
        axios.get('/api/vault/plugins/registry-url').then((r) => r.data?.url || '').catch(() => ''),
    ]).then(([plugins, perms, gal, keys, regUrl]) => {
        setInstalled(plugins);
        setCatalog(perms);
        setGallery(gal);
        setTrustKeys(keys);
        setRegistryUrl(regUrl);
    }).finally(() => setLoading(false));

    useEffect(() => { refresh(); return undefined; }, []);

    const saveRegistryUrl = async () => {
        setError(''); setBusy('reg');
        try {
            await axios.put('/api/vault/plugins/registry-url', { url: registryUrl });
            await refresh();
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_save_url'));
        } finally { setBusy(''); }
    };

    const addTrustKey = async () => {
        if (!newKey.name.trim() || !newKey.public_key.trim()) return;
        setError(''); setBusy('key');
        try {
            await axios.post('/api/vault/plugins/trust', newKey);
            setNewKey({ name: '', public_key: '' });
            await refresh();
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_invalid_key'));
        } finally { setBusy(''); }
    };

    const removeTrustKey = async (name) => {
        setBusy(`key:${name}`);
        try {
            await axios.delete(`/api/vault/plugins/trust/${encodeURIComponent(name)}`);
            await refresh();
        } catch { /* noop */ } finally { setBusy(''); }
    };

    const togglePermission = async (pid, declared, current, perm) => {
        const has = current.includes(perm);
        const next = has ? current.filter((p) => p !== perm) : [...current, perm];
        // We only send permissions declared by the manifest (the backend also validates this).
        const clean = next.filter((p) => declared.includes(p));
        try {
            await axios.post(`/api/vault/plugins/${encodeURIComponent(pid)}/permissions`, { permissions: clean });
            refresh();
            reloadPlugins();
        } catch { /* noop */ }
    };

    const onInstallZip = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setError(''); setBusy('zip');
        try {
            const fd = new FormData();
            fd.append('file', file);
            await axios.post('/api/vault/plugins/install', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            await refresh(); reloadPlugins();
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_install_plugin'));
        } finally { setBusy(''); }
    };

    const onInstallFromCatalog = async (id) => {
        setError(''); setBusy(`cat:${id}`);
        try {
            await axios.post('/api/vault/plugins/catalog/install', { id });
            await refresh(); reloadPlugins();
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_install'));
        } finally { setBusy(''); }
    };

    const onUninstall = async (id) => {
        setError(''); setBusy(`del:${id}`);
        try {
            await axios.delete(`/api/vault/plugins/${encodeURIComponent(id)}`);
            await refresh(); reloadPlugins();
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_uninstall'));
        } finally { setBusy(''); }
    };

    return (
        <div style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Puzzle size={18} />
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{tp('third_party_title')}</h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary, #94a3b8)', marginBottom: 12 }}>
                <Trans i18nKey="settings.plugins.third_party_desc" components={{ code: <code /> }} />
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <input ref={fileRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={onInstallZip} />
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy === 'zip'}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
                        border: '1px solid var(--border-primary, #e2e8f0)', cursor: busy === 'zip' ? 'wait' : 'pointer',
                        background: 'var(--bg-primary, #fff)', color: 'var(--text-primary, #0f172a)', fontSize: 13, fontWeight: 600,
                    }}
                >
                    <Upload size={15} /> {busy === 'zip' ? tp('installing') : tp('install_zip')}
                </button>
            </div>
            {error && (
                <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca' }}>
                    {error}
                </div>
            )}

            {loading && <div style={{ fontSize: 13, color: 'var(--text-tertiary, #94a3b8)' }}>{tp('loading')}</div>}
            {!loading && installed.length === 0 && (
                <div style={{
                    fontSize: 13, color: 'var(--text-tertiary, #94a3b8)', padding: '12px 14px',
                    borderRadius: 10, border: '1px dashed var(--border-primary, #e2e8f0)',
                }}>
                    <Trans i18nKey="settings.plugins.empty_state" components={{ code: <code /> }} />
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
                                <Trans i18nKey="settings.plugins.broken_plugin" values={{ id: p.id, error: p.error }} components={{ b: <strong /> }} />
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
                                        {m.description || tp('no_description')}{m.author ? ` · ${m.author}` : ''}
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
                                    title={enabled ? tp('disable') : tp('enable')}
                                >
                                    <span style={{
                                        position: 'absolute', top: 2, left: enabled ? 20 : 2, width: 20, height: 20,
                                        borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                    }} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onUninstall(m.id)}
                                    disabled={busy === `del:${m.id}`}
                                    aria-label={tp('uninstall')}
                                    title={tp('uninstall')}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                        border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                                        background: 'transparent', color: '#dc2626',
                                    }}
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>

                            {declared.length > 0 && (
                                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary, #94a3b8)' }}>
                                        {tp('permissions')}
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

            {gallery.length > 0 && (
                <div style={{ marginTop: 22 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Download size={16} />
                        <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{tp('gallery')}</h4>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {gallery.map((g) => (
                            <div key={g.id} style={{
                                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10,
                                border: '1px solid var(--border-primary, #e2e8f0)', background: 'var(--bg-primary, #fff)',
                            }}>
                                <Puzzle size={16} style={{ color: '#6366f1', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #0f172a)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {g.name}
                                        {g.signed && (
                                            <span title={tp('signed_tip')} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: '#16a34a' }}>
                                                <ShieldCheck size={12} /> {tp('signed')}
                                            </span>
                                        )}
                                        {g.source === 'url' && !g.signed && (
                                            <span title={tp('unsigned_tip')} style={{ fontSize: 10, fontWeight: 600, color: '#d97706' }}>{tp('not_verified')}</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>{g.description}</div>
                                </div>
                                {g.installed ? (
                                    <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>{tp('installed')}</span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => onInstallFromCatalog(g.id)}
                                        disabled={busy === `cat:${g.id}`}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, flexShrink: 0,
                                            border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                                            background: 'var(--bg-secondary, #f8fafc)', color: 'var(--text-primary, #0f172a)', fontSize: 12, fontWeight: 600,
                                        }}
                                    >
                                        <Download size={14} /> {busy === `cat:${g.id}` ? tp('installing') : tp('install')}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div style={{ marginTop: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Globe size={16} />
                    <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{tp('remote_title')}</h4>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                        {tp('registry_url_label')}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            type="url" placeholder="https://github.com/ismigar/Gnosi/releases/latest/download/plugins-index.json"
                            value={registryUrl}
                            onChange={(e) => setRegistryUrl(e.target.value)}
                            style={{ ...SELECT_STYLE, flex: 1 }}
                        />
                        <button
                            type="button" onClick={saveRegistryUrl} disabled={busy === 'reg'}
                            style={{
                                padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                                border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                                background: 'var(--bg-secondary, #f8fafc)', color: 'var(--text-primary, #0f172a)',
                            }}
                        >{tp('save')}</button>
                    </div>
                </label>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <KeyRound size={14} style={{ color: 'var(--text-tertiary, #94a3b8)' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                        {tp('trust_keys')}
                    </span>
                </div>
                {trustKeys.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)', marginBottom: 8 }}>
                        {tp('no_trust_keys')}
                    </div>
                )}
                {trustKeys.map((k) => (
                    <div key={k.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
                        <ShieldCheck size={13} style={{ color: '#16a34a', flexShrink: 0 }} />
                        <span style={{ fontWeight: 600 }}>{k.name}</span>
                        <code style={{ fontSize: 11, color: 'var(--text-tertiary, #94a3b8)' }}>{k.fingerprint}…</code>
                        <button
                            type="button" onClick={() => removeTrustKey(k.name)}
                            aria-label={tp('remove')} title={tp('remove')}
                            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer' }}
                        ><Trash2 size={13} /></button>
                    </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input
                        type="text" placeholder={tp('publisher_placeholder')}
                        value={newKey.name}
                        onChange={(e) => setNewKey((k) => ({ ...k, name: e.target.value }))}
                        style={{ ...SELECT_STYLE, width: 160 }}
                    />
                    <input
                        type="text" placeholder={tp('pubkey_placeholder')}
                        value={newKey.public_key}
                        onChange={(e) => setNewKey((k) => ({ ...k, public_key: e.target.value }))}
                        style={{ ...SELECT_STYLE, flex: 1 }}
                    />
                    <button
                        type="button" onClick={addTrustKey} disabled={busy === 'key'}
                        style={{
                            padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                            border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                            background: 'var(--bg-secondary, #f8fafc)', color: 'var(--text-primary, #0f172a)',
                        }}
                    >{tp('add')}</button>
                </div>
            </div>
        </div>
    );
}

/**
 * Plugin configuration panel: enables/disables the optional features
 * (internal registry). State is persisted per vault in `.gnosi/plugins.json`.
 */
const CONFIGURABLE = {
    'daily-notes': DailyNotesConfig,
    'llm-wiki': LlmWikiConfig,
    'web-clipper': WebClipperConfig,
};

export function PluginsSettings() {
    const { t } = useTranslation();
    const tp = (k, opts) => t('settings.plugins.' + k, opts);
    const { isEnabled, setPluginEnabled } = usePlugins();
    const [openConfig, setOpenConfig] = useState(null);

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Puzzle size={18} />
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{tp('title')}</h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary, #94a3b8)', marginBottom: 16 }}>
                {tp('desc')}
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
                                    {tp(`${plugin.id}.name`, { defaultValue: plugin.name })}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                                    {tp(`${plugin.id}.desc`, { defaultValue: plugin.description })}
                                </div>
                            </div>
                            {ConfigPanel && enabled && (
                                <button
                                    type="button"
                                    onClick={() => setOpenConfig((cur) => (cur === plugin.id ? null : plugin.id))}
                                    aria-label={tp('configure')}
                                    title={tp('configure')}
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
                                title={enabled ? tp('disable') : tp('enable')}
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
