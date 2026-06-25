import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { Database, Link2, Download, Check, Loader, Unlink, GitCompare, AlertTriangle } from 'lucide-react';

/**
 * Importador de Notion → Vault. Connecta amb un token d'integració, llista les BD
 * compartides i les importa (esquema → taula, files → pàgines, relacions, contingut,
 * vistes heurístiques). Consumeix /api/notion/{token,status,databases,import}.
 */
export default function NotionImportSettings() {
    const [connected, setConnected] = useState(null);
    const [name, setName] = useState('');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');
    const [databases, setDatabases] = useState([]);
    const [selected, setSelected] = useState(new Set());
    const [folder, setFolder] = useState('Importades/Notion');
    const [groupViews, setGroupViews] = useState(true);
    const [followLinks, setFollowLinks] = useState(true);
    const [report, setReport] = useState(null);
    const [diff, setDiff] = useState(null);

    const loadStatus = useCallback(async () => {
        try {
            const { data } = await axios.get('/api/notion/status');
            setConnected(!!data.connected);
        } catch { setConnected(false); }
    }, []);
    useEffect(() => { loadStatus(); }, [loadStatus]);

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
            const { data } = await axios.get('/api/notion/databases');
            setDatabases(data.databases || []);
            setSelected(new Set((data.databases || []).map(d => d.id)));
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    const toggle = (id) => setSelected(s => {
        const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
    });

    const runDiff = async () => {
        setBusy('diff'); setError(''); setDiff(null); setReport(null);
        try {
            const { data } = await axios.post('/api/notion/diff', {
                database_ids: databases.length ? Array.from(selected) : null,
                deep: true,
            });
            setDiff(data);
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    const runImport = async () => {
        setBusy('import'); setError(''); setReport(null);
        try {
            const { data } = await axios.post('/api/notion/import', {
                database_ids: databases.length ? Array.from(selected) : null,
                create_group_views: groupViews,
                target_folder: folder.trim() || 'Importades/Notion',
                follow_links: followLinks,
            });
            setReport(data);
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
                    <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--text-primary)' }}>Importar de Notion</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Reprodueix bases de dades, pàgines, relacions i contingut. Les vistes es generen per heurística (taula + agrupada).
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
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 220, overflowY: 'auto' }}>
                                {databases.map(d => (
                                    <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.83rem', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 10, border: '1px solid var(--settings-border)' }}>
                                        <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                                        {d.title}
                                    </label>
                                ))}
                            </div>

                            <div style={{ marginTop: 16, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                                <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                    Carpeta destí:&nbsp;
                                    <input style={{ ...inp, width: 220, display: 'inline-block' }} value={folder} onChange={e => setFolder(e.target.value)} />
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                    <div className={`gnosi-toggle ${groupViews ? 'active' : ''}`} onClick={() => setGroupViews(v => !v)}>
                                        <div className="gnosi-toggle-handle" />
                                    </div>
                                    Crear vista agrupada (per status/select)
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: 'var(--text-secondary)' }}
                                    title="Importa també les BD relacionades, sub-pàgines i mencions perquè res quedi orfe (workspace sencer).">
                                    <div className={`gnosi-toggle ${followLinks ? 'active' : ''}`} onClick={() => setFollowLinks(v => !v)}>
                                        <div className="gnosi-toggle-handle" />
                                    </div>
                                    Seguir relacions i enllaços (sense orfes)
                                </label>
                                <button onClick={runDiff} disabled={busy === 'diff' || selected.size === 0}
                                    style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px' }}>
                                    {busy === 'diff' ? <Loader size={15} className="spin" /> : <GitCompare size={15} />}
                                    {busy === 'diff' ? 'Comparant…' : 'Previsualitza diferències'}
                                </button>
                                <button className="btn-gnosi-primary" onClick={runImport} disabled={busy === 'import' || selected.size === 0}
                                    style={{ padding: '9px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                                    {busy === 'import' ? <Loader size={15} className="spin" /> : <Download size={15} />}
                                    {busy === 'import' ? 'Important…' : `Importa ${selected.size} BD (només noves)`}
                                </button>
                            </div>
                        </div>
                    )}

                    {diff && (
                        <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: 'var(--bg-primary)', border: '1px solid var(--settings-border)', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, marginBottom: 8 }}>
                                <GitCompare size={16} /> Diferències (dry-run, no s'ha tocat res)
                            </div>
                            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
                                <span>🆕 Noves: <b>{diff.summary?.new ?? 0}</b></span>
                                <span style={{ color: '#e0a52e' }}>⚠️ Divergides: <b>{diff.summary?.diverged ?? 0}</b></span>
                                <span>✅ Idèntiques: <b>{diff.summary?.identical ?? 0}</b></span>
                                <span>≈ Similars: <b>{diff.summary?.similar ?? 0}</b></span>
                                <span>📁 Només al vault: <b>{diff.summary?.vault_only ?? 0}</b></span>
                            </div>
                            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 6 }}>
                                {(diff.tables || []).map((t, i) => (
                                    <div key={i} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--settings-border)' }}>
                                        <b>{t.notion_db}</b> → {t.vault_table || <span style={{ color: '#e0a52e' }}>taula inexistent</span>}
                                        {' · '}{t.new || 0} noves · {t.matched || 0} coincidents
                                        {t.diverged?.length > 0 && (
                                            <div style={{ marginTop: 4, color: '#e0a52e', fontSize: '0.78rem' }}>
                                                <AlertTriangle size={12} style={{ verticalAlign: 'middle' }} /> {t.diverged.length} divergides (p.ex. {t.diverged.slice(0, 3).map(d => `${d.title} ${d.similarity != null ? `(${Math.round(d.similarity * 100)}%)` : ''}`).join(', ')})
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>
                                «Importa» només afegirà les <b>noves</b>; les divergides no es toquen (el vault mana).
                            </div>
                        </div>
                    )}

                    {report && (
                        <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: 'var(--bg-primary)', border: '1px solid var(--settings-border)', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                            ✓ Importat: <b>{report.databases ?? report.tables}</b> bases de dades · <b>{report.pages}</b> pàgines · <b>{report.views}</b> vistes
                            {report.skipped_existing > 0 && <span> · <b>{report.skipped_existing}</b> ja existents (saltades)</span>}
                            {report.truncated && (
                                <div style={{ marginTop: 6, color: '#e0a52e' }}>⚠️ Límit de pàgines assolit: el workspace és més gran. Augmenta el límit o importa per parts.</div>
                            )}
                            {report.errors?.length > 0 && (
                                <div style={{ marginTop: 6, color: '#e0a52e' }}>{report.errors.length} errors (revisa els logs)</div>
                            )}
                        </div>
                    )}
                </>
            )}

            {error && <div style={{ marginTop: 14, color: '#e05252', fontSize: '0.82rem' }}>{error}</div>}
        </div>
    );
}
