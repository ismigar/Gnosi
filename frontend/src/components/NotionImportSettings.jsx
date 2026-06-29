import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Database, Link2, Check, Loader, Unlink, Settings } from 'lucide-react';
import { SchemaConfigModal } from './Vault/SchemaConfigModal';

/**
 * Clon de Notion → Vault. Connecta amb un token d'integració + l'MCP allotjat (OAuth) i fa un
 * CLON EXACTE a una carpeta nova (esquema, pàgines, relacions, vistes incrustades, colors,
 * columnes, adjunts, portades). Consumeix /api/notion/{token,status,databases,schema,
 * loose-pages,clone} i /api/notion-oauth/*.
 */
export default function NotionImportSettings() {
    const [connected, setConnected] = useState(null);
    const [name, setName] = useState('');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [databases, setDatabases] = useState([]);
    const [selected, setSelected] = useState(new Set());
    const [folder, setFolder] = useState('Clon Notion');
    const [report, setReport] = useState(null);
    const [verify, setVerify] = useState(null);
    const [mcpConnected, setMcpConnected] = useState(false);
    const [schemaOverrides, setSchemaOverrides] = useState({});   // {dbId: esquema SchemaConfigModal}
    const [cfg, setCfg] = useState(null);                          // {db, schema} de la BD que es configura
    const [loosePages, setLoosePages] = useState(false);          // mostra/inclou pàgines soltes
    const [loosePagesList, setLoosePagesList] = useState([]);     // [{id,title}] pàgines fora de BD
    const [loosePageTypes, setLoosePageTypes] = useState({});     // {pageId: "wiki"|"dashboard"}
    const [looseSelected, setLooseSelected] = useState(new Set()); // pàgines soltes a clonar/importar

    const openSchemaConfig = async (d) => {
        setBusy('schema:' + d.id); setError('');
        try {
            const { data } = await axios.get(`/api/notion/databases/${d.id}/schema`);
            setCfg({ db: d, schema: schemaOverrides[d.id] || data.schema || {} });
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    const loadStatus = useCallback(async () => {
        try {
            const { data } = await axios.get('/api/notion/status');
            setConnected(!!data.connected);
        } catch { setConnected(false); }
        try {
            const { data } = await axios.get('/api/notion-oauth/status');
            setMcpConnected(!!data.connected);
        } catch { setMcpConnected(false); }
    }, []);
    useEffect(() => { loadStatus(); }, [loadStatus]);

    // En tornar del consentiment OAuth (?notion_mcp=ok), refresca l'estat i neteja la URL
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

    const listDbs = async () => {
        setBusy('list'); setError(''); setReport(null);
        try {
            const { data } = await axios.get('/api/notion/databases', { timeout: 120000 });
            setDatabases(data.databases || []);
            setSelected(new Set((data.databases || []).map(d => d.id)));
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    // Carrega les pàgines fora de BD només quan l'usuari activa el toggle (són moltes; evita
    // la crida si no les vol). Per defecte cap seleccionada: l'usuari tria quines incloure.
    const toggleLoosePages = async () => {
        const next = !loosePages;
        setLoosePages(next);
        if (next && loosePagesList.length === 0) {
            setBusy('loose'); setError('');
            try {
                const lp = await axios.get('/api/notion/loose-pages', { timeout: 120000 });
                const pages = lp.data.pages || [];
                setLoosePagesList(pages);
                setLoosePageTypes(Object.fromEntries(pages.map(p => [p.id, 'wiki'])));
                setLooseSelected(new Set());
            } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
            finally { setBusy(''); }
        }
    };

    const toggle = (id) => setSelected(s => {
        const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
    });

    // Només les pàgines soltes MARCADES s'inclouen (amb el seu tipus wiki/dashboard). Si el
    // toggle de pàgines soltes està desactivat, no se n'inclou cap.
    const selectedLooseTypes = () => {
        if (!loosePages) return null;
        const out = {};
        looseSelected.forEach(id => { out[id] = loosePageTypes[id] || 'wiki'; });
        return Object.keys(out).length ? out : null;
    };

    const runClone = async () => {
        setBusy('clone'); setError(''); setReport(null);
        try {
            const { data } = await axios.post('/api/notion/clone', {
                database_ids: databases.length ? Array.from(selected) : null,
                target_folder: folder.trim() || 'Clon Notion',
                schema_overrides: Object.keys(schemaOverrides).length ? schemaOverrides : null,
                loose_page_types: selectedLooseTypes(),
            }, { timeout: 0 });  // clon = moltes crides MCP: sense timeout de client
            setReport(data);
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    const runVerify = async () => {
        setBusy('verify'); setError(''); setVerify(null);
        try {
            const { data } = await axios.post('/api/notion/verify-clone', {
                database_ids: databases.length ? Array.from(selected) : null,
                target_folder: folder.trim() || 'Clon Notion',
            }, { timeout: 0 });  // recompta totes les files de Notion: sense timeout
            setVerify(data);
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
                    <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--text-primary)' }}>Clonar de Notion</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Clon exacte a una carpeta nova: BD, pàgines, relacions, vistes incrustades, colors, columnes, adjunts i portades. Per migrar a Gnosi d'un sol tret.
                    </div>
                </div>
            </div>

            {connected === null && <div style={{ color: 'var(--text-tertiary)', padding: 8 }}>Carregant…</div>}

            {/* Connexió */}
            {connected === false && (
                <div style={{ marginTop: 14 }}>
                    <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                        Token d'integració interna (notion.so/my-integrations → comparteix les BD amb la integració)
                    </label>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <input style={{ ...inp, flex: 1 }} type="password" placeholder="ntn_… o secret_…"
                            value={token} onChange={e => setToken(e.target.value)} />
                        <button className="btn-gnosi-primary" onClick={connect} disabled={busy === 'token' || !token.trim()}
                            style={{ padding: '9px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                            <Link2 size={15} /> {busy === 'token' ? 'Validant…' : 'Connecta'}
                        </button>
                    </div>
                </div>
            )}

            {connected === true && (
                <>
                    <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--gnosi-primary)', fontWeight: 700, fontSize: '0.85rem' }}>
                            <Check size={16} /> Connectat{name ? ` · ${name}` : ''}
                        </span>
                        <button onClick={disconnect} disabled={busy === 'token'}
                            style={{ ...inp, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', padding: '5px 10px' }}>
                            <Unlink size={14} /> Desconnecta
                        </button>
                        <button className="btn-gnosi-primary" onClick={listDbs} disabled={busy === 'list'}
                            style={{ padding: '7px 14px', borderRadius: 10, fontSize: '0.82rem' }}>
                            {busy === 'list' ? 'Carregant…' : 'Llista bases de dades'}
                        </button>
                    </div>

                    {databases.length > 0 && (
                        <div style={{ marginTop: 18 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                    Bases de dades — marca quines incloure ({selected.size}/{databases.length})
                                </div>
                                <button type="button"
                                    onClick={() => setSelected(selected.size === databases.length
                                        ? new Set() : new Set(databases.map(d => d.id)))}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--gnosi-primary)' }}>
                                    {selected.size === databases.length ? 'Cap' : 'Tots'}
                                </button>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                                {databases.map(d => (
                                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 10, border: '1px solid var(--settings-border)' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.83rem', color: 'var(--text-primary)', flex: 1, cursor: 'pointer' }}>
                                            <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                                            {d.title}
                                        </label>
                                        <button onClick={() => openSchemaConfig(d)} disabled={busy === 'schema:' + d.id}
                                            title={schemaOverrides[d.id] ? 'Camps configurats — editar' : "Configura els camps d'aquesta BD (tipus, adjunts…)"}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: schemaOverrides[d.id] ? 'var(--gnosi-primary)' : 'var(--text-tertiary)' }}>
                                            {busy === 'schema:' + d.id ? <Loader size={14} className="animate-spin" /> : <Settings size={14} />}
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 16, cursor: 'pointer' }}
                                title="Mostra les pàgines compartides que no pengen de cap base de dades, per triar quines incloure (wiki o dashboard).">
                                <div className={`gnosi-toggle ${loosePages ? 'active' : ''}`} onClick={toggleLoosePages}>
                                    <div className="gnosi-toggle-handle" />
                                </div>
                                Incloure pàgines soltes (no a cap BD)
                                {busy === 'loose' && <Loader size={13} className="animate-spin" />}
                            </label>

                            {loosePages && loosePagesList.length > 0 && (
                                <div style={{ marginTop: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                                            Pàgines fora de BD — marca quines incloure ({looseSelected.size}/{loosePagesList.length})
                                        </div>
                                        <button type="button"
                                            onClick={() => setLooseSelected(looseSelected.size === loosePagesList.length
                                                ? new Set() : new Set(loosePagesList.map(p => p.id)))}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--gnosi-primary)' }}>
                                            {looseSelected.size === loosePagesList.length ? 'Cap' : 'Tots'}
                                        </button>
                                    </div>
                                    <div style={{ display: 'grid', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                                        {loosePagesList.map(p => {
                                            const included = looseSelected.has(p.id);
                                            return (
                                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 10, border: '1px solid var(--settings-border)', opacity: included ? 1 : 0.5 }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={included}
                                                        onChange={() => setLooseSelected(s => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} />
                                                    <span style={{ flex: 1, fontSize: '0.83rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                                                </label>
                                                <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--settings-border)' }}>
                                                    {['wiki', 'dashboard'].map(opt => {
                                                        const active = (loosePageTypes[p.id] || 'wiki') === opt;
                                                        return (
                                                            <button key={opt} disabled={!included}
                                                                onClick={() => setLoosePageTypes(s => ({ ...s, [p.id]: opt }))}
                                                                style={{ padding: '4px 11px', fontSize: '0.76rem', border: 'none', cursor: included ? 'pointer' : 'not-allowed',
                                                                    background: active ? 'var(--gnosi-primary)' : 'transparent',
                                                                    color: active ? '#fff' : 'var(--text-secondary)' }}>
                                                                {opt === 'wiki' ? 'Wiki' : 'Dashboard'}
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

                            <div style={{ marginTop: 16, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                                <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                    Carpeta destí:&nbsp;
                                    <input style={{ ...inp, width: 220, display: 'inline-block' }} value={folder} onChange={e => setFolder(e.target.value)} />
                                </label>
                                {mcpConnected ? (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', color: 'var(--gnosi-primary)', fontWeight: 700 }}>
                                        <Check size={14} /> MCP connectat
                                    </span>
                                ) : (
                                    <button onClick={() => { window.location.href = '/api/notion-oauth/login'; }}
                                        style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px' }}
                                        title="Connecta amb l'MCP allotjat de Notion (OAuth). IMPRESCINDIBLE per al clon: vistes incrustades, columnes i colors vénen de l'MCP.">
                                        <Link2 size={15} /> Connecta MCP (imprescindible)
                                    </button>
                                )}
                                <button className="btn-gnosi-primary" onClick={runClone}
                                    disabled={busy === 'clone' || selected.size === 0 || !mcpConnected}
                                    title={mcpConnected
                                        ? "Clon EXACTE de Notion a una carpeta NOVA. No toca el vault actual."
                                        : "Connecta primer l'MCP per al clon exacte."}
                                    style={{ padding: '9px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: mcpConnected ? 'pointer' : 'not-allowed', opacity: mcpConnected ? 1 : 0.6 }}>
                                    {busy === 'clone' ? <Loader size={15} className="animate-spin" /> : <Database size={15} />}
                                    {busy === 'clone' ? 'Clonant…' : `Clon exacte (${selected.size} BD)`}
                                </button>
                            </div>
                        </div>
                    )}

                    {report && (
                        <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: 'var(--bg-primary)', border: '1px solid var(--settings-border)', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                            ✓ Clonat: <b>{report.tables}</b> bases de dades · <b>{report.pages}</b> pàgines · <b>{report.views}</b> vistes
                            {report.attachments > 0 && <span> · <b>{report.attachments}</b> adjunts</span>}
                            {report.truncated && (
                                <div style={{ marginTop: 6, color: '#e0a52e' }}>⚠️ Límit de pàgines assolit: el workspace és més gran. Augmenta el límit.</div>
                            )}
                            {report.warnings?.length > 0 && (
                                <div style={{ marginTop: 6, color: '#e0a52e' }}>
                                    {report.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
                                </div>
                            )}
                            {report.errors?.length > 0 && (
                                <div style={{ marginTop: 6, color: '#e0a52e' }}>{report.errors.length} errors (revisa els logs)</div>
                            )}
                            <button onClick={runVerify} disabled={busy === 'verify'}
                                style={{ ...inp, marginTop: 10, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px' }}
                                title="Compara Notion ↔ clon: recompte per BD, cossos buits, relacions òrfenes, vistes i adjunts.">
                                {busy === 'verify' ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                                {busy === 'verify' ? 'Verificant…' : 'Verifica el clon'}
                            </button>
                        </div>
                    )}

                    {verify && (
                        <div style={{ marginTop: 14, padding: 14, borderRadius: 12, fontSize: '0.85rem', color: 'var(--text-primary)',
                            background: 'var(--bg-primary)', border: `1px solid ${verify.summary?.healthy ? 'var(--gnosi-primary)' : '#e0a52e'}` }}>
                            <div style={{ fontWeight: 800, marginBottom: 8 }}>
                                {verify.summary?.healthy ? '✅ Clon saludable' : '⚠️ Clon amb incidències'}
                            </div>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                                <span>BD OK: <b>{verify.summary?.tables_ok}/{verify.summary?.tables_total}</b></span>
                                <span>Pàgines: <b>{verify.summary?.pages}</b></span>
                                <span>Vistes: <b>{verify.summary?.views}</b></span>
                                <span style={{ color: verify.summary?.empty_bodies ? '#e0a52e' : 'inherit' }}>Cossos buits: <b>{verify.summary?.empty_bodies}</b></span>
                                <span style={{ color: verify.summary?.orphan_relations ? '#e0a52e' : 'inherit' }}>Relacions òrfenes: <b>{verify.summary?.orphan_relations}</b></span>
                                <span style={{ color: verify.summary?.missing_assets ? '#e0a52e' : 'inherit' }}>Adjunts que falten: <b>{verify.summary?.missing_assets}</b></span>
                            </div>
                            {(verify.tables || []).filter(t => !t.ok).length > 0 && (
                                <div style={{ display: 'grid', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                                    {verify.tables.filter(t => !t.ok).map((t, i) => (
                                        <div key={i} style={{ color: '#e0a52e', fontSize: '0.8rem' }}>
                                            ⚠️ Una BD: Notion <b>{t.notion}</b> · clon <b>{t.clone}</b> {t.missing > 0 ? `(falten ${t.missing})` : ''}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {error && <div style={{ marginTop: 14, color: '#e05252', fontSize: '0.82rem' }}>{error}</div>}

            {cfg && (
                <SchemaConfigModal
                    isOpen={true}
                    onClose={() => setCfg(null)}
                    folder={folder.trim() || 'Importades/Notion'}
                    currentSchema={cfg.schema}
                    onSave={(newSchema) => {
                        // SchemaConfigModal és d'AUTOSAVE: crida onSave a cada canvi (i un cop en
                        // obrir). NO tanquem aquí (tancaria sol en obrir); només desem l'override.
                        const dbId = cfg.db.id;
                        setSchemaOverrides(prev => ({ ...prev, [dbId]: newSchema }));
                    }}
                />
            )}
        </div>
    );
}
