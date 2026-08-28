import React, { useEffect, useState, useCallback, useRef } from 'react';
import axios from '../shared/api/legacy-http';
import { Database, Link2, Check, Loader, Unlink, Settings, X, RotateCw } from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { SchemaConfigModal } from './Vault/SchemaConfigModal';
import { ConfirmModal } from './ConfirmModal';
import {
    createVault,
    deleteVault,
    fetchVaultCatalog,
} from '../shared/api/vaults';

// Import config persistence: the source of truth is the SERVER (GET/PUT
// /api/notion/import-config, per-workspace) so it survives origin changes
// (http→https, preview ports, another Mac, browser profile — incident 2026-07-03).
// localStorage remains as an offline fallback and migration path: it paints the initial state
// instantly, and if the server doesn't have config yet but localStorage does, it gets uploaded there. The Sets
// are serialized as arrays. Point-in-time state (report, verify, busy, error) is NOT persisted.
const CFG_KEY = 'gnosi_notion_import_cfg';
const loadCfg = () => {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; }
    catch { return {}; }
};

// Sorts databases and pages by title with the default English collation.
const byTitle = (a, b) => (a?.title || '').localeCompare(b?.title || '', 'en', { sensitivity: 'base' });
const sortByTitle = (list) => [...(list || [])].sort(byTitle);

/**
 * Notion → Vault clone. Connects with an integration token + the hosted MCP (OAuth) and does an
 * EXACT CLONE into a new folder (schema, pages, relations, embedded views, colors,
 * columns, attachments, covers). Consumes /api/notion/{token,status,databases,schema,
 * loose-pages,clone} and /api/notion-oauth/*.
 */
export default function NotionImportSettings() {
    const { t } = useTranslation();
    const saved = useRef(loadCfg()).current;
    const [connected, setConnected] = useState(null);
    const [name, setName] = useState('');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [databases, setDatabases] = useState(sortByTitle(saved.databases));
    const [selected, setSelected] = useState(new Set(saved.selected || []));
    const [report, setReport] = useState(null);
    const [progress, setProgress] = useState(null);   // {phase,done,total,pages,...} of the clone in progress
    const [confirmAbort, setConfirmAbort] = useState(false);   // abort confirmation modal
    const pollRef = useRef(null);                      // id of the progress-polling setInterval
    const pollResumeRef = useRef(false);               // true = polling in "resume" mode (modal reopened)
    const [vaults, setVaults] = useState([]);          // [{id,name,path,active}] workspace vaults
    const [cloneVaultId, setCloneVaultId] = useState(saved.cloneVaultId || '__new__'); // destination vault for the clone ('__new__' = create one)
    const [newVaultName, setNewVaultName] = useState(saved.newVaultName || 'Notion');   // name of the new vault to create
    const [usedVaultId, setUsedVaultId] = useState(null);  // vault where it was actually cloned (to verify it there)
    const [usedVaultName, setUsedVaultName] = useState('');  // name of that vault (for the "switch to it" hint)
    const [destClone, setDestClone] = useState(null);   // {tables} if the destination vault ALREADY has a clone (or null)
    const [confirmDelClone, setConfirmDelClone] = useState(false);  // confirmation modal for deleting the clone
    const [verify, setVerify] = useState(null);
    const [linkedDbs, setLinkedDbs] = useState(null);   // {linked:[{title,page_title,kind}],scanned,capped} or null
    const [mcpConnected, setMcpConnected] = useState(false);
    const [schemaOverrides, setSchemaOverrides] = useState(saved.schemaOverrides || {});   // {dbId: SchemaConfigModal schema}
    const [cfg, setCfg] = useState(null);                          // {db, schema} of the DB being configured
    const [loosePages, setLoosePages] = useState(saved.loosePages || false);          // show/include loose pages
    // The list of loose pages is NOT restored from localStorage: it's SERVER state and
    // it used to become fossilized (a list captured with an old backend would be shown forever
    // because it was only re-requested if it was empty). It's requested fresh when opening with the toggle
    // active and on every activation; only the SELECTION persists (looseSelected/loosePageTypes).
    const [loosePagesList, setLoosePagesList] = useState([]);     // [{id,title}] pages outside a DB
    const [loosePageTypes, setLoosePageTypes] = useState(saved.loosePageTypes || {});     // {pageId: "wiki"|"dashboard"}
    const [looseSelected, setLooseSelected] = useState(new Set(saved.looseSelected || [])); // loose pages to clone/import

    // true when the initial GET to /import-config has succeeded: until then NO PUT is made
    // (this would avoid clobbering the server config with the component's initial/default state).
    const serverCfgOkRef = useRef(false);

    // Applies a saved config (from the server) to the panel state. Same shape as loadCfg().
    const applyCfg = useCallback((c) => {
        setDatabases(sortByTitle(c.databases));
        setSelected(new Set(c.selected || []));
        setSchemaOverrides(c.schemaOverrides || {});
        setCloneVaultId(c.cloneVaultId || '__new__');
        setNewVaultName(c.newVaultName || 'Notion');
        setLoosePages(!!c.loosePages);
        setLoosePageTypes(c.loosePageTypes || {});
        setLooseSelected(new Set(c.looseSelected || []));
    }, []);

    // On open: loads the config from the SERVER (source of truth). If the server doesn't have one yet
    // but localStorage does (old installation), it uploads it there (migration). If the GET fails
    // (old backend, offline), the localStorage-only behavior remains and it is never PUT.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const { data } = await axios.get('/api/notion/import-config');
                if (!alive) return;
                if (data?.config && Object.keys(data.config).length > 0) {
                    applyCfg(data.config);
                } else {
                    const local = loadCfg();
                    if (Object.keys(local).length > 0) {
                        await axios.put('/api/notion/import-config', local).catch(() => {});
                    }
                }
                serverCfgOkRef.current = true;
            } catch { /* backend without the endpoint or offline: localStorage only */ }
        })();
        return () => { alive = false; };
    }, [applyCfg]);

    // Autosave: every change is saved to localStorage (instant fallback) and, with debounce,
    // to the server (per-workspace). The PUT only activates once the server config has been read.
    useEffect(() => {
        const cfg = {
            databases, schemaOverrides, loosePages, loosePageTypes,
            cloneVaultId, newVaultName,
            selected: Array.from(selected),
            looseSelected: Array.from(looseSelected),
        };
        try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
        catch { /* quota full or private: ignore */ }
        if (!serverCfgOkRef.current) return undefined;
        const tid = setTimeout(() => { axios.put('/api/notion/import-config', cfg).catch(() => {}); }, 800);
        return () => clearTimeout(tid);
    }, [databases, selected, schemaOverrides, loosePages, loosePageTypes, looseSelected, cloneVaultId, newVaultName]);

    const openSchemaConfig = async (d) => {
        setBusy('schema:' + d.id); setError('');
        try {
            const { data } = await axios.get(`/api/notion/databases/${d.id}/schema`);
            setCfg({ db: d, schema: schemaOverrides[d.id] || data.schema || {} });
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    const loadVaults = useCallback(async () => {
        try {
            const data = await fetchVaultCatalog();
            setVaults(data.vaults || []);
        } catch { /* multi-vault not available: clones to the active vault */ }
    }, []);

    // If the saved destination vault (localStorage) no longer exists (deleted), it falls back to "Create new vault"
    // so the selector doesn't end up blank pointing at a ghost id (the cause of the clone incident).
    useEffect(() => {
        if (cloneVaultId && cloneVaultId !== '__new__' && vaults.length && !vaults.some(v => v.id === cloneVaultId)) {
            setCloneVaultId('__new__');
        }
    }, [vaults, cloneVaultId]);

    // Detects whether the chosen destination vault ALREADY has a clone (checks its registry). Re-evaluated on change,
    // of vault and when opening the panel → the state (verify/delete vs clone) persists even though
    // even if you close and reopen it, because it's derived from the vault, not from volatile React state.
    useEffect(() => {
        let alive = true;
        if (busy === 'clone' || !cloneVaultId || cloneVaultId === '__new__' || !vaults.some(v => v.id === cloneVaultId)) {
            setDestClone(null); return;
        }
        axios.get('/api/vault/registry', { headers: { 'X-Vault-Id': cloneVaultId } })
            .then(({ data }) => { if (alive) setDestClone((data.tables || []).length ? { tables: data.tables.length } : null); })
            .catch(() => { if (alive) setDestClone(null); });
        return () => { alive = false; };
    }, [cloneVaultId, vaults, busy]);

    const loadStatus = useCallback(async () => {
        try {
            const { data } = await axios.get('/api/notion/status');
            setConnected(!!data.connected);
        } catch { setConnected(false); }
        try {
            const { data } = await axios.get('/api/notion-oauth/status');
            setMcpConnected(!!data.connected);
        } catch { setMcpConnected(false); }
        loadVaults();
    }, [loadVaults]);
    useEffect(() => { loadStatus(); }, [loadStatus]);

    // Resolves the clone's destination vault: if it's '__new__', creates a sibling vault at the root (…/Gnosi/<name>)
    // and returns its id; otherwise, the chosen id. The clone writes to it via the X-Vault-Id header.
    const resolveCloneVault = async () => {
        // Reuses the chosen vault ONLY if it still exists (avoids sending the id of a deleted vault, which
        // the backend would resolve as Principal). Otherwise, or if it's '__new__', it creates a new one.
        if (cloneVaultId && cloneVaultId !== '__new__' && vaults.some(v => v.id === cloneVaultId)) {
            return cloneVaultId;
        }
        const name = (newVaultName.trim() || 'Notion');
        const data = await createVault(name);
        await loadVaults();
        setCloneVaultId(data.id);
        return data.id;
    };

    // When returning from OAuth consent (?notion_mcp=ok), refresh the state and clean up the URL
    useEffect(() => {
        const p = new URLSearchParams(window.location.search).get('notion_mcp');
        if (p) {
            loadStatus();
            const url = new URL(window.location.href); url.searchParams.delete('notion_mcp');
            window.history.replaceState({}, '', url.toString());
        }
    }, [loadStatus]);

    const connect = async () => {
        setBusy('token'); setError('');
        try {
            const { data } = await axios.post('/api/notion/token', { token: token.trim() });
            setName(data.name || 'Notion'); setConnected(true); setToken('');
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    const disconnect = async () => {
        setBusy('token');
        try { await axios.delete('/api/notion/token'); setConnected(false); setDatabases([]); setReport(null); }
        catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    // Detects linked views (linked databases): they're visible in Notion but the API can't
    // clone them and `/search` doesn't return them. The SOURCE needs to be shared. On-demand scan.
    const checkLinked = async () => {
        setBusy('linked'); setError(''); setLinkedDbs(null);
        try {
            const { data } = await axios.get('/api/notion/linked-databases', { timeout: 0 });
            setLinkedDbs(data);
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    const listDbs = async () => {
        setBusy('list'); setError(''); setReport(null);
        try {
            const { data } = await axios.get('/api/notion/databases', { timeout: 120000 });
            const list = data.databases || [];
            // Preserves the selection: keeps the DBs you already had checked and checks the NEW ones
            // (the ones that weren't in the previous list, e.g. a DB that was just shared). On the
            // first load (there were none) → all checked.
            const prevIds = new Set(databases.map(d => d.id));
            setSelected(prev => {
                const next = new Set();
                for (const d of list) {
                    if (!prevIds.has(d.id) || prev.has(d.id)) next.add(d.id);
                }
                return next;
            });
            setDatabases(sortByTitle(list));
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    // Requests the FRESH list of loose pages and reconciles the user's selection with it by id:
    // keeps the selection and type of pages that still exist, new ones come in
    // unchecked (the user decides) and ones that disappeared drop out of the selection.
    const fetchLoosePages = useCallback(async () => {
        setBusy('loose'); setError('');
        try {
            const lp = await axios.get('/api/notion/loose-pages', { timeout: 120000 });
            const pages = sortByTitle(lp.data.pages);
            const ids = new Set(pages.map(p => p.id));
            setLoosePagesList(pages);
            setLoosePageTypes(prev => Object.fromEntries(pages.map(p => [p.id, prev[p.id] || 'wiki'])));
            setLooseSelected(prev => new Set([...prev].filter(id => ids.has(id))));
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    }, []);

    // The list is requested when there is a connection and the toggle is active: when opening the panel with the
    // toggle persisted and on every activation. A saved list is never reused (see above).
    useEffect(() => {
        if (connected && loosePages) fetchLoosePages();
    }, [connected, loosePages, fetchLoosePages]);

    const toggleLoosePages = () => setLoosePages(v => !v);

    const toggle = (id) => setSelected(s => {
        const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
    });

    // Only CHECKED loose pages are included (with their wiki/dashboard type). If the
    // loose pages toggle is off, none are included.
    const selectedLooseTypes = () => {
        if (!loosePages) return null;
        const out = {};
        looseSelected.forEach(id => { out[id] = loosePageTypes[id] || 'wiki'; });
        return Object.keys(out).length ? out : null;
    };

    // Stops progress polling (if any) and clears the bar.
    const stopProgressPoll = () => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
    useEffect(() => stopProgressPoll, []);   // cleanup on unmount

    // Polls the clone's progress every 1.5s. In "resume" mode (modal reopened with a clone already in
    // progress) the original /clone request has been lost, so it's the same polling that detects the
    // end (running=false) and closes the bar with the accumulated counters.
    const startProgressPoll = (resume) => {
        pollResumeRef.current = resume;
        stopProgressPoll();
        pollRef.current = setInterval(async () => {
            try {
                const { data } = await axios.get('/api/notion/clone/progress', { timeout: 8000 });
                setProgress(data);
                if (pollResumeRef.current && data?.vault_id) setUsedVaultId(data.vault_id);  // to verify in the right vault
                if (pollResumeRef.current && data && data.running === false) {
                    stopProgressPoll(); setBusy(''); setProgress(null);
                    setReport({ status: 'success', tables: data.tables, pages: data.pages,
                        views: data.views, attachments: data.attachments,
                        errors: [], warnings: [], truncated: false });
                }
            } catch { /* transient: ignore, the next tick will retry it */ }
        }, 1500);
    };

    // When opening the panel, if a clone is ALREADY running (e.g. the modal was closed without waiting),
    // recovers its state and resumes the bar instead of offering to trigger the clone again.
    useEffect(() => {
        let alive = true;
        axios.get('/api/notion/clone/progress', { timeout: 8000 }).then(({ data }) => {
            if (alive && data?.vault_id) setUsedVaultId(data.vault_id);  // remembers the clone's vault to verify against
            if (alive && data && data.running) {
                setBusy('clone'); setProgress(data); startProgressPoll(true);
            }
        }).catch(() => {});
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const runClone = async () => {
        setBusy('clone'); setError(''); setReport(null);
        // Resolves/creates the destination vault BEFORE anything else; the clone will write to it via X-Vault-Id (without touching
        // the active global vault). If it fails, we don't start the clone.
        let vid;
        try { vid = await resolveCloneVault(); }
        catch (e) {
            setError(t('settings.notion.err_prepare_vault', "Couldn't prepare the destination vault: {{detail}}", { detail: String(e?.response?.data?.detail || e.message) }));
            setBusy(''); return;
        }
        setUsedVaultId(vid);
        setUsedVaultName(cloneVaultId === '__new__' ? (newVaultName.trim() || 'Notion')
            : (vaults.find(v => v.id === vid)?.name || ''));
        const vaultHeader = { 'X-Vault-Id': vid };
        setProgress({ phase: 'starting', done: 0, total: 0, pages: 0 });
        // The clone is a single blocking request; meanwhile, we poll the progress every 1.5s.
        startProgressPoll(false);
        try {
            const { data } = await axios.post('/api/notion/clone', {
                database_ids: databases.length ? Array.from(selected) : null,
                target_folder: '',   // root of the destination vault (no subfolder)
                schema_overrides: Object.keys(schemaOverrides).length ? schemaOverrides : null,
                loose_page_types: selectedLooseTypes(),
            }, { timeout: 0, headers: vaultHeader });  // clone = many MCP calls: no timeout; on the destination vault
            setReport(data);
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); stopProgressPoll(); setProgress(null); }
    };

    // Aborts the clone in progress (after confirming in the modal). The backend stops at the next
    // checkpoint between pages; the /clone request stays open and will return the partial report.
    const doAbortClone = async () => {
        setConfirmAbort(false);
        try {
            await axios.post('/api/notion/clone/abort');
            setProgress(p => p ? { ...p, phase: 'cancelled' } : p);
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
    };

    const runVerify = async () => {
        setBusy('verify'); setError(''); setVerify(null);
        // Verifies in the vault WHERE THE CLONE HAPPENED: prioritizes the vault used by the clone; if unknown, the
        // one chosen in the selector (if it's a real vault). NEVER without a vault → it would verify the ACTIVE vault
        // (often Principal) and would give a false result ("DB OK 0/16"), the 2026-07-01 incident.
        const verifyVault = usedVaultId
            || (cloneVaultId && cloneVaultId !== '__new__' && vaults.some(v => v.id === cloneVaultId) ? cloneVaultId : null);
        if (!verifyVault) {
            setError(t('settings.notion.err_unknown_clone_vault', "I don't know which vault the clone is in. Switch to the clone's vault (vault selector) and verify again."));
            setBusy(''); return;
        }
        try {
            const { data } = await axios.post('/api/notion/verify-clone', {
                database_ids: databases.length ? Array.from(selected) : null,
                target_folder: '',   // root of the destination vault (no subfolder)
            }, { timeout: 0, headers: { 'X-Vault-Id': verifyVault } });
            setVerify(data);
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    // Deletes the clone: removes the entire destination vault (row + folder on disk) and resets the panel
    // to "Create new vault" so it can be cloned again cleanly.
    const doDeleteClone = async () => {
        setConfirmDelClone(false);
        const vid = cloneVaultId;
        if (!vid || vid === '__new__') return;
        setBusy('delclone'); setError('');
        try {
            await deleteVault(vid, true);
            setDestClone(null); setReport(null); setVerify(null); setUsedVaultId(null);
            setCloneVaultId('__new__');
            await loadVaults();
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    const card = { marginTop: 32, padding: 24, borderRadius: 24, border: '1px solid var(--settings-border)', background: 'var(--settings-sidebar-bg)' };
    const inp = { background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--settings-border)', borderRadius: 10, padding: '9px 12px', fontSize: '0.85rem' };

    return (
        <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <Database size={20} />
                <div>
                    <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--text-primary)' }}>{t('settings.notion.title', "Clone from Notion")}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {t('settings.notion.subtitle', "Exact clone into a new folder: databases, pages, relations, embedded views, colors, columns, attachments and covers. Migrate to Gnosi in one shot.")}
                    </div>
                </div>
            </div>

            {connected === null && <div style={{ color: 'var(--text-tertiary)', padding: 8 }}>{t('common.loading', "Loading...")}</div>}

            {/* Connection */}
            {connected === false && (
                <div style={{ marginTop: 14 }}>
                    <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                        {t('settings.notion.token_label', "Internal integration token (notion.so/my-integrations → share the databases with the integration)")}
                    </label>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <input style={{ ...inp, flex: 1 }} type="password" placeholder={t('settings.notion.token_placeholder', "ntn_… or secret_…")}
                            value={token} onChange={e => setToken(e.target.value)} />
                        <button className="btn-gnosi-primary" onClick={connect} disabled={busy === 'token' || !token.trim()}
                            style={{ padding: '9px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                            <Link2 size={15} /> {busy === 'token' ? t('settings.notion.validating', "Validating…") : t('settings.notion.connect_button', "Connect")}
                        </button>
                    </div>
                </div>
            )}

            {connected === true && (
                <>
                    <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gnosi-primary)', fontWeight: 700, fontSize: '0.85rem' }}>
                            <Check size={16} /> {t('settings.notion.connected_label', "Connected")}{name ? ` · ${name}` : ''}
                        </span>
                        <button onClick={disconnect} disabled={busy === 'token'}
                            style={{ ...inp, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', padding: '5px 10px' }}>
                            <Unlink size={14} /> {t('settings.notion.disconnect_button', "Disconnect")}
                        </button>
                        <button className="btn-gnosi-primary" onClick={listDbs} disabled={busy === 'list'}
                            style={{ padding: '7px 14px', borderRadius: 10, fontSize: '0.82rem' }}>
                            {busy === 'list' ? t('common.loading', "Loading...") : t('settings.notion.list_databases_button', "List databases")}
                        </button>
                        <button onClick={checkLinked} disabled={busy === 'linked'}
                            title={t('settings.notion.detect_linked_title', "Search for DBs visible in Notion that are actually linked views (not importable): you need to share their source.")}
                            style={{ ...inp, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px' }}>
                            {busy === 'linked' ? <Loader size={14} className="animate-spin" /> : <Unlink size={14} />}
                            {busy === 'linked' ? t('settings.notion.searching', "Searching…") : t('settings.notion.detect_linked_button', "Detect linked views")}
                        </button>
                    </div>

                    {linkedDbs && (
                        linkedDbs.linked.length === 0 ? (
                            <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'var(--bg-primary)', border: '1px solid var(--settings-border)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                {linkedDbs.capped
                                    ? t('settings.notion.no_linked_found_partial', "✓ No non-importable linked views detected (partial scan: there are more pages than the ones reviewed).")
                                    : t('settings.notion.no_linked_found', "✓ No non-importable linked views detected.")}
                            </div>
                        ) : (
                            <div style={{ marginTop: 12, padding: 14, borderRadius: 12, background: 'var(--bg-primary)', border: '1px solid #e0a52e', fontSize: '0.83rem', color: 'var(--text-primary)' }}>
                                <div style={{ fontWeight: 800, color: '#e0a52e', marginBottom: 6 }}>
                                    ⚠️ {t('settings.notion.linked_db_count', "{{count}} linked DB (not importable)", { count: linkedDbs.linked.length })}
                                </div>
                                <div style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>
                                    <Trans i18nKey="settings.notion.linked_views_explanation" components={{ b: <b /> }} />
                                </div>
                                {linkedDbs.linked.map((l, i) => {
                                    const named = l.title && l.title !== 'Untitled';
                                    return (
                                        <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
                                            <span>🔗</span>
                                            <span>
                                                {named ? <><b>{l.title}</b> <span style={{ color: 'var(--text-tertiary)' }}>{t('settings.notion.linked_db_location', "— in “{{page}}”", { page: l.page_title })}</span></>
                                                    : <>{t('settings.notion.linked_view_in_page_prefix', "Linked view inside")} <b>«{l.page_title}»</b></>}
                                            </span>
                                        </div>
                                    );
                                })}
                                {linkedDbs.capped && (
                                    <div style={{ marginTop: 6, color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                                        {t('settings.notion.partial_scan_note', "Partial scan ({{count}} pages): there may be more.", { count: linkedDbs.scanned })}
                                    </div>
                                )}
                            </div>
                        )
                    )}

                    {databases.length > 0 && (
                        <div style={{ marginTop: 18 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                    {t('settings.notion.databases_header', "Databases — check which ones to include ({{selected}}/{{total}})", { selected: selected.size, total: databases.length })}
                                </div>
                                <button type="button"
                                    onClick={() => setSelected(selected.size === databases.length
                                        ? new Set() : new Set(databases.map(d => d.id)))}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--gnosi-primary)' }}>
                                    {selected.size === databases.length ? t('settings.notion.select_none', "None") : t('settings.notion.select_all', "All")}
                                </button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 220, overflowY: 'auto', overflowX: 'hidden' }}>
                                {databases.map(d => (
                                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '6px 10px', borderRadius: 10, border: '1px solid var(--settings-border)' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.83rem', color: 'var(--text-primary)', flex: 1, minWidth: 0, cursor: 'pointer' }}>
                                            <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                                        </label>
                                        <button onClick={() => openSchemaConfig(d)} disabled={busy === 'schema:' + d.id}
                                            title={schemaOverrides[d.id] ? t('settings.notion.schema_configured_title', "Fields configured — edit") : t('settings.notion.schema_configure_title', "Configure this DB's fields (type, attachments…)")}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: schemaOverrides[d.id] ? 'var(--gnosi-primary)' : 'var(--text-tertiary)' }}>
                                            {busy === 'schema:' + d.id ? <Loader size={14} className="animate-spin" /> : <Settings size={14} />}
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 16, cursor: 'pointer' }}
                                title={t('settings.notion.loose_pages_toggle_title', "Show the shared pages that don't belong to any database, to choose which ones to include (wiki or dashboard).")}>
                                <div className={`gnosi-toggle ${loosePages ? 'active' : ''}`} onClick={toggleLoosePages}>
                                    <div className="gnosi-toggle-handle" />
                                </div>
                                {t('settings.notion.loose_pages_toggle_label', "Include loose pages (not in any DB)")}
                                {busy === 'loose' && <Loader size={13} className="animate-spin" />}
                            </label>

                            {loosePages && loosePagesList.length > 0 && (
                                <div style={{ marginTop: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                            {t('settings.notion.loose_pages_header', "Pages outside a DB — check which ones to include ({{selected}}/{{total}})", { selected: looseSelected.size, total: loosePagesList.length })}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <button type="button" onClick={fetchLoosePages} disabled={busy === 'loose'}
                                                title={t('settings.notion.refresh_loose_title', "Request the list from Notion again")}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--text-tertiary)' }}>
                                                <RotateCw size={13} className={busy === 'loose' ? 'animate-spin' : undefined} />
                                            </button>
                                            <button type="button"
                                                onClick={() => setLooseSelected(looseSelected.size === loosePagesList.length
                                                    ? new Set() : new Set(loosePagesList.map(p => p.id)))}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--gnosi-primary)' }}>
                                                {looseSelected.size === loosePagesList.length ? t('settings.notion.select_none', "None") : t('settings.notion.select_all', "All")}
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gap: 6, maxHeight: 200, overflowY: 'auto', overflowX: 'hidden' }}>
                                        {loosePagesList.map(p => {
                                            const included = looseSelected.has(p.id);
                                            return (
                                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, padding: '6px 10px', borderRadius: 10, border: '1px solid var(--settings-border)', opacity: included ? 1 : 0.5 }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={included}
                                                        onChange={() => setLooseSelected(s => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} />
                                                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.83rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                                                </label>
                                                <div style={{ display: 'flex', flexShrink: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--settings-border)' }}>
                                                    {['wiki', 'dashboard'].map(opt => {
                                                        // The highlight only counts if the page is included,
                                                        // so an unchecked page doesn't appear to have a chosen type.
                                                        const active = included && (loosePageTypes[p.id] || 'wiki') === opt;
                                                        return (
                                                            // Clicking Wiki/Dashboard SELECTS the page (checks it)
                                                            // and sets its type, without having to click the checkbox.
                                                            <button key={opt}
                                                                onClick={() => {
                                                                    setLoosePageTypes(s => ({ ...s, [p.id]: opt }));
                                                                    setLooseSelected(s => { const n = new Set(s); n.add(p.id); return n; });
                                                                }}
                                                                style={{ padding: '4px 11px', fontSize: '0.76rem', border: 'none', cursor: 'pointer',
                                                                    background: active ? 'var(--gnosi-primary)' : 'transparent',
                                                                    color: active ? '#fff' : 'var(--text-secondary)' }}>
                                                                {opt === 'wiki' ? t('settings.notion.loose_page_type_wiki', 'Wiki') : t('settings.notion.loose_page_type_dashboard', 'Dashboard')}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Destination vault: the clone goes to a SEPARATE vault at the root (sibling of the main one)
                                so you can validate it in isolation and adopt or discard it, without mixing it
                                with the active vault. By default, it creates a new one. */}
                            <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                    {t('settings.notion.dest_vault_label', "Destination vault:")}&nbsp;
                                    <select style={{ ...inp, display: 'inline-block', cursor: 'pointer' }}
                                        value={cloneVaultId} onChange={e => setCloneVaultId(e.target.value)}>
                                        <option value="__new__">➕ {t('settings.notion.new_vault_option', "Create a new vault (at the root)")}</option>
                                        {vaults.map(v => (
                                            <option key={v.id} value={v.id}>{v.name}{v.active ? t('settings.notion.active_suffix', " (active)") : ''}</option>
                                        ))}
                                    </select>
                                </label>
                                {cloneVaultId === '__new__' && (
                                    <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                        {t('settings.notion.new_vault_name_label', "Name:")}&nbsp;
                                        <input style={{ ...inp, width: 160, display: 'inline-block' }}
                                            value={newVaultName} onChange={e => setNewVaultName(e.target.value)}
                                            placeholder="Notion" />
                                    </label>
                                )}
                                <span style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
                                    {t('settings.notion.clone_path_hint', "The clone is created directly at …/Gnosi/{{name}}.", { name: cloneVaultId === '__new__' ? (newVaultName.trim() || 'Notion') : (vaults.find(v => v.id === cloneVaultId)?.name || '?') })}
                                </span>
                            </div>

                            <div style={{ marginTop: 12, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                                {mcpConnected ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--gnosi-primary)', fontWeight: 700 }}>
                                        <Check size={14} /> {t('settings.notion.mcp_connected', "MCP connected")}
                                    </span>
                                ) : (
                                    <button onClick={() => { window.location.href = '/api/notion-oauth/login'; }}
                                        style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px' }}
                                        title={t('settings.notion.mcp_connect_title', "Connect with Notion's hosted MCP (OAuth). ESSENTIAL for the clone: embedded views, columns and colors come from the MCP.")}>
                                        <Link2 size={15} /> {t('settings.notion.mcp_connect_button', "Connect MCP (required)")}
                                    </button>
                                )}
                                {/* If the destination vault ALREADY has a clone: we don't let it be cloned there
                                    again (duplicates); instead of the Clone button we show Verify + Delete.
                                    Persists on reopen. */}
                                {destClone && busy !== 'clone' ? (
                                    <>
                                        <span style={{ fontSize: '0.82rem', color: '#e0a52e', fontWeight: 700 }}>
                                            ⚠️ {t('settings.notion.dest_has_clone', "This vault already has a clone ({{count}} DB)", { count: destClone.tables })}
                                        </span>
                                        <button className="btn-gnosi-primary" onClick={runVerify} disabled={busy === 'verify'}
                                            title={t('settings.notion.verify_title', "Compare Notion ↔ this vault's clone.")}
                                            style={{ padding: '9px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
                                            {busy === 'verify' ? <Loader size={15} className="animate-spin" /> : <Check size={15} />}
                                            {busy === 'verify' ? t('settings.notion.verifying', "Verifying…") : t('settings.notion.verify_button', "Verify the clone")}
                                        </button>
                                        <button onClick={() => setConfirmDelClone(true)} disabled={busy === 'delclone'}
                                            title={t('settings.notion.delete_clone_title', "Delete this cloned vault (row + folder) so you can clone it again cleanly.")}
                                            style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', color: '#e0524e', borderColor: '#e0524e' }}>
                                            {busy === 'delclone' ? <Loader size={15} className="animate-spin" /> : <X size={15} />}
                                            {busy === 'delclone' ? t('settings.notion.deleting', "Deleting…") : t('settings.notion.delete_clone_button', "Delete the clone")}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button className="btn-gnosi-primary" onClick={runClone}
                                            disabled={busy === 'clone' || selected.size === 0 || !mcpConnected}
                                            title={mcpConnected
                                                ? t('settings.notion.clone_button_title', "EXACT clone of Notion into a NEW folder. Doesn't touch the current vault.")
                                                : t('settings.notion.clone_button_title_disabled', "Connect the MCP first for the exact clone.")}
                                            style={{ padding: '9px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: mcpConnected ? 'pointer' : 'not-allowed', opacity: mcpConnected ? 1 : 0.6 }}>
                                            {busy === 'clone' ? <Loader size={15} className="animate-spin" /> : <Database size={15} />}
                                            {busy === 'clone' ? t('notion_cloning') : t('notion_clone')}
                                        </button>
                                        {busy === 'clone' && (
                                            <button onClick={() => setConfirmAbort(true)}
                                                disabled={progress?.phase === 'cancelled'}
                                                title={t('settings.notion.abort_title', "Stop the clone. Whatever has already been cloned stays on disk (partial).")}
                                                style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', color: '#e0524e', borderColor: '#e0524e' }}>
                                                <X size={15} /> {progress?.phase === 'cancelled' ? t('settings.notion.aborting', "Aborting…") : t('settings.notion.abort_button', "Abort")}
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>

                            {busy === 'clone' && progress && (() => {
                                const labels = {
                                    starting: t('settings.notion.progress_starting', "Preparing…"),
                                    schema: t('settings.notion.progress_schema', "Cloning DB schemas"),
                                    collect: t('settings.notion.progress_collect', "Collecting rows"),
                                    pages: t('settings.notion.progress_pages', "Writing pages"),
                                    loose: t('settings.notion.progress_loose', "Loose pages"),
                                    subpages: t('settings.notion.progress_subpages', "Subpages"),
                                    done: t('settings.notion.progress_done', "Finishing…"),
                                };
                                const total = progress.total || 0;
                                const done = progress.done || 0;
                                const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
                                return (
                                    <div style={{ marginTop: 14 }}>
                                        <style>{'@keyframes gnosi-indeterminate{0%{margin-left:-40%}100%{margin-left:100%}}'}</style>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                                            {/* During «collect» the pages are still 0 (they get written in the next
                                                phase): we show the rows collected so there's a sign of life. */}
                                            {/* During «subpages» the BFS may scan thousands of parents without finding
                                                new children: the scanned/known counter is the only sign of life. */}
                                            <span>{labels[progress.phase] || progress.phase}{total > 0 ? ` — ${done}/${total}` : ''}{progress.phase === 'collect' ? ` (${t('settings.notion.progress_files_count', "{{count}} rows", { count: progress.collected || 0 })})` : ''}{progress.phase === 'subpages' && progress.scan_total ? ` — ${t('settings.notion.progress_scanning', "scanning {{done}}/{{total}} pages", { done: progress.scan_done || 0, total: progress.scan_total })}` : ''}</span>
                                            {/* Each metric as «done/total» when the total is known (pages
                                                after collecting; DBs from the start). Views and attachments are
                                                discovered on the fly → no denominator. */}
                                            <span>
                                                {progress.pages || 0}{progress.pages_total ? `/${progress.pages_total}` : ''} {t('settings.notion.unit_pages', "pages")}
                                                {' · '}{progress.tables || 0}{progress.tables_total ? `/${progress.tables_total}` : ''} {t('settings.notion.unit_databases', "DB")}
                                                {' · '}{progress.views || 0} {t('settings.notion.unit_views', "views")}
                                                {' · '}{progress.attachments || 0} {t('settings.notion.unit_attachments', "attachments")}
                                            </span>
                                        </div>
                                        <div style={{ height: 8, borderRadius: 99, background: 'var(--bg-primary)', border: '1px solid var(--settings-border)', overflow: 'hidden' }}>
                                            <div style={{
                                                height: '100%', borderRadius: 99, background: 'var(--gnosi-primary)',
                                                transition: 'width 0.4s ease',
                                                width: pct !== null ? `${pct}%` : '40%',
                                                ...(pct === null ? { animation: 'gnosi-indeterminate 1.2s ease-in-out infinite' } : {}),
                                            }} />
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {report && (
                        <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: 'var(--bg-primary)', border: `1px solid ${report.status === 'cancelled' ? '#e0a52e' : 'var(--settings-border)'}`, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                            <div>
                                {report.status === 'cancelled' ? t('settings.notion.report_cancelled_prefix', "⏹️ Clone aborted (partial): ") : t('settings.notion.report_success_prefix', "✓ Cloned: ")}<b>{report.tables}</b> {t('settings.notion.unit_databases_full', "databases")} · <b>{report.pages}</b> {t('settings.notion.unit_pages', "pages")} · <b>{report.views}</b> {t('settings.notion.unit_views', "views")}
                                {report.attachments > 0 && <span> · <b>{report.attachments}</b> {t('settings.notion.unit_attachments', "attachments")}</span>}
                            </div>
                            {usedVaultName && (
                                <div style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
                                    {t('settings.notion.used_vault_hint', "📁 In the vault “{{name}}” (at the root). Switch to it from the vault selector to see it and validate it.", { name: usedVaultName })}
                                </div>
                            )}
                            {report.truncated && (
                                <div style={{ marginTop: 6, color: '#e0a52e' }}>{t('settings.notion.truncated_warning', "⚠️ Page limit reached: the workspace is bigger. Increase the limit.")}</div>
                            )}
                            {report.warnings?.length > 0 && (
                                <div style={{ marginTop: 6, color: '#e0a52e' }}>
                                    {report.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
                                </div>
                            )}
                            {report.errors?.length > 0 && (
                                <div style={{ marginTop: 6, color: '#e0a52e' }}>{t('settings.notion.errors_count', "{{count}} errors (check the logs)", { count: report.errors.length })}</div>
                            )}
                            <button onClick={runVerify} disabled={busy === 'verify'}
                                style={{ ...inp, marginTop: 10, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px' }}
                                title={t('settings.notion.verify_title_detailed', "Compare Notion ↔ clone: count per DB, empty bodies, orphan relations, views and attachments.")}>
                                {busy === 'verify' ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                                {busy === 'verify' ? t('settings.notion.verifying', "Verifying…") : t('settings.notion.verify_button', "Verify the clone")}
                            </button>
                        </div>
                    )}

                    {verify && (() => {
                        // Complete DBs (tables_ok == total) are already a good clone: empty bodies and
                        // orphan relations are minor details, not "issues". Only if DBs are MISSING
                        // ho marquem com a incomplet (àmbar).
                        const tablesComplete = verify.summary?.tables_ok === verify.summary?.tables_total;
                        const ok = verify.summary?.healthy || tablesComplete;
                        return (
                        <div style={{ marginTop: 14, padding: 14, borderRadius: 12, fontSize: '0.85rem', color: 'var(--text-primary)',
                            background: 'var(--bg-primary)', border: `1px solid ${ok ? 'var(--gnosi-primary)' : '#e0a52e'}` }}>
                            <div style={{ fontWeight: 800, marginBottom: 8 }}>
                                {verify.summary?.healthy ? t('settings.notion.verify_healthy', "✅ Healthy clone")
                                    : tablesComplete ? t('settings.notion.verify_complete_minor', "✅ Complete clone (minor details)")
                                    : t('settings.notion.verify_incomplete', "⚠️ Incomplete clone: pages are missing")}
                            </div>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                                <span>{t('settings.notion.verify_db_ok_label', "DBs OK:")} <b>{verify.summary?.tables_ok}/{verify.summary?.tables_total}</b></span>
                                <span>{t('settings.notion.verify_pages_label', "Pages:")} <b>{verify.summary?.pages}</b></span>
                                <span>{t('settings.notion.verify_views_label', "Views:")} <b>{verify.summary?.views}</b></span>
                                <span style={{ color: verify.summary?.empty_bodies ? '#e0a52e' : 'inherit' }}>{t('settings.notion.verify_empty_bodies_label', "Empty bodies:")} <b>{verify.summary?.empty_bodies}</b></span>
                                <span style={{ color: verify.summary?.orphan_relations ? '#e0a52e' : 'inherit' }}>{t('settings.notion.verify_orphan_relations_label', "Orphan relations:")} <b>{verify.summary?.orphan_relations}</b></span>
                                <span style={{ color: verify.summary?.missing_assets ? '#e0a52e' : 'inherit' }}>{t('settings.notion.verify_missing_assets_label', "Missing attachments:")} <b>{verify.summary?.missing_assets}</b></span>
                            </div>
                            {tablesComplete && !verify.summary?.healthy && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                                    <Trans i18nKey="settings.notion.verify_minor_details_note" components={{ b: <b /> }} />
                                </div>
                            )}
                            {(verify.tables || []).filter(row => !row.ok).length > 0 && (
                                <div style={{ display: 'grid', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                                    {verify.tables.filter(row => !row.ok).map((row, i) => (
                                        <div key={i} style={{ color: '#e0a52e', fontSize: '0.8rem' }}>
                                            ⚠️ <Trans i18nKey="settings.notion.verify_table_mismatch" values={{ notion: row.notion, clone: row.clone }} components={{ b: <b /> }} /> {row.missing > 0 ? t('settings.notion.verify_table_missing_suffix', "(missing {{missing}})", { missing: row.missing }) : ''}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        );
                    })()}
                </>
            )}

            {error && <div style={{ marginTop: 14, color: '#e05252', fontSize: '0.82rem' }}>{error}</div>}

            {cfg && (
                <SchemaConfigModal
                    isOpen={true}
                    onClose={() => setCfg(null)}
                    folder={cfg.db.title || 'Notion'}
                    tableName={cfg.db.title}
                    currentSchema={cfg.schema}
                    // Relations must point to DBs in the NOTION workspace (not to the
                    // local vault's tables). Id without dashes = the backend's table_id_for,
                    // which is how relation_database_id arrives in the preconfigured schema.
                    availableTables={databases.map(d => ({ id: String(d.id || '').replace(/-/g, ''), name: d.title }))}
                    onSave={(newSchema) => {
                        // SchemaConfigModal is AUTOSAVE: it calls onSave on every change (and once on
                        // open). We do NOT close here (it would close on its own on open); we only save the override.
                        const dbId = cfg.db.id;
                        setSchemaOverrides(prev => ({ ...prev, [dbId]: newSchema }));
                    }}
                />
            )}

            <ConfirmModal
                isOpen={confirmAbort}
                onClose={() => setConfirmAbort(false)}
                onConfirm={doAbortClone}
                title={t('settings.notion.confirm_abort_title', "Abort the clone?")}
                message={t('settings.notion.confirm_abort_message', "The clone will stop at the next checkpoint (between pages). Whatever has already been cloned will stay on disk as a partial clone; you can delete the destination folder and start over.")}
                confirmText={t('settings.notion.confirm_abort_confirm', "Abort the clone")}
                cancelText={t('settings.notion.confirm_abort_cancel', "Keep cloning")}
                isDestructive={true}
            />

            <ConfirmModal
                isOpen={confirmDelClone}
                onClose={() => setConfirmDelClone(false)}
                onConfirm={doDeleteClone}
                title={t('settings.notion.confirm_delete_clone_title', "Delete the clone?")}
                message={t('settings.notion.confirm_delete_clone_message', "The entire vault “{{name}}” will be deleted (row + folder on disk) along with the whole clone. This action cannot be undone. Afterwards you'll be able to clone again cleanly.", { name: vaults.find(v => v.id === cloneVaultId)?.name || '' })}
                confirmText={t('settings.notion.delete_clone_button', "Delete the clone")}
                cancelText={t('settings.notion.confirm_delete_clone_cancel', "Cancel")}
                isDestructive={true}
            />
        </div>
    );
}
