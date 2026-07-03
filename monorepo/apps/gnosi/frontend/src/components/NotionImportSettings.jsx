import React, { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { Database, Link2, Check, Loader, Unlink, Settings, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SchemaConfigModal } from './Vault/SchemaConfigModal';
import { ConfirmModal } from './ConfirmModal';

// Persistència de la config d'import: en tancar el modal de Configuració l'estat de React es
// perd, així que la desem a localStorage amb autosave i la restaurem en obrir. Els Set es
// serialitzen com a array. La feina puntual (report, verify, busy, error) NO es persisteix.
const CFG_KEY = 'gnosi_notion_import_cfg';
const loadCfg = () => {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; }
    catch { return {}; }
};

// Ordena BD/pàgines pel títol, alfabètic i insensible a accents/majúscules (locale català).
const byTitle = (a, b) => (a?.title || '').localeCompare(b?.title || '', 'ca', { sensitivity: 'base' });
const sortByTitle = (list) => [...(list || [])].sort(byTitle);

/**
 * Clon de Notion → Vault. Connecta amb un token d'integració + l'MCP allotjat (OAuth) i fa un
 * CLON EXACTE a una carpeta nova (esquema, pàgines, relacions, vistes incrustades, colors,
 * columnes, adjunts, portades). Consumeix /api/notion/{token,status,databases,schema,
 * loose-pages,clone} i /api/notion-oauth/*.
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
    const [progress, setProgress] = useState(null);   // {phase,done,total,pages,...} del clon en curs
    const [confirmAbort, setConfirmAbort] = useState(false);   // modal de confirmació d'avortar
    const pollRef = useRef(null);                      // id del setInterval de polling del progrés
    const pollResumeRef = useRef(false);               // true = polling en mode "resume" (modal reobert)
    const [vaults, setVaults] = useState([]);          // [{id,name,path,active}] vaults del workspace
    const [cloneVaultId, setCloneVaultId] = useState(saved.cloneVaultId || '__new__'); // vault destí del clon ('__new__' = crear-ne un)
    const [newVaultName, setNewVaultName] = useState(saved.newVaultName || 'Notion');   // nom del vault nou a crear
    const [usedVaultId, setUsedVaultId] = useState(null);  // vault on s'ha clonat realment (per verificar-lo allà)
    const [usedVaultName, setUsedVaultName] = useState('');  // nom d'aquell vault (per la pista «canvia-hi»)
    const [destClone, setDestClone] = useState(null);   // {tables} si el vault destí JA té un clon (o null)
    const [confirmDelClone, setConfirmDelClone] = useState(false);  // modal de confirmació d'esborrar el clon
    const [verify, setVerify] = useState(null);
    const [linkedDbs, setLinkedDbs] = useState(null);   // {linked:[{title,page_title,kind}],scanned,capped} o null
    const [mcpConnected, setMcpConnected] = useState(false);
    const [schemaOverrides, setSchemaOverrides] = useState(saved.schemaOverrides || {});   // {dbId: esquema SchemaConfigModal}
    const [cfg, setCfg] = useState(null);                          // {db, schema} de la BD que es configura
    const [loosePages, setLoosePages] = useState(saved.loosePages || false);          // mostra/inclou pàgines soltes
    const [loosePagesList, setLoosePagesList] = useState(sortByTitle(saved.loosePagesList));     // [{id,title}] pàgines fora de BD
    const [loosePageTypes, setLoosePageTypes] = useState(saved.loosePageTypes || {});     // {pageId: "wiki"|"dashboard"}
    const [looseSelected, setLooseSelected] = useState(new Set(saved.looseSelected || [])); // pàgines soltes a clonar/importar

    // Autosave: cada canvi a la config es desa a localStorage (debounce no cal, és poc freqüent).
    useEffect(() => {
        try {
            localStorage.setItem(CFG_KEY, JSON.stringify({
                databases, schemaOverrides, loosePages, loosePagesList, loosePageTypes,
                cloneVaultId, newVaultName,
                selected: Array.from(selected),
                looseSelected: Array.from(looseSelected),
            }));
        } catch { /* quota plena o privat: ignora */ }
    }, [databases, selected, schemaOverrides, loosePages, loosePagesList, loosePageTypes, looseSelected, cloneVaultId, newVaultName]);

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
            const { data } = await axios.get('/api/vaults');
            setVaults(data.vaults || []);
        } catch { /* multi-vault no disponible: es clona al vault actiu */ }
    }, []);

    // Si el vault destí desat (localStorage) ja no existeix (esborrat), torna a "Crear vault nou"
    // perquè el selector no quedi en blanc apuntant a un id fantasma (causa de l'incident del clon).
    useEffect(() => {
        if (cloneVaultId && cloneVaultId !== '__new__' && vaults.length && !vaults.some(v => v.id === cloneVaultId)) {
            setCloneVaultId('__new__');
        }
    }, [vaults, cloneVaultId]);

    // Detecta si el vault destí triat JA té un clon (mira el seu registre). Es re-avalua en canviar
    // de vault i en obrir el panell → l'estat (verificar/esborrar vs clonar) persisteix encara que
    // tanquis i reobris, perquè es deriva del vault, no d'estat volàtil de React.
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

    // Resol el vault destí del clon: si és '__new__', crea un vault germà a l'arrel (…/Gnosi/<nom>)
    // i retorna el seu id; si no, l'id triat. El clon hi escriu via la capçalera X-Vault-Id.
    const resolveCloneVault = async () => {
        // Reusa el vault triat NOMÉS si encara existeix (evita enviar l'id d'un vault esborrat, que
        // el backend resoldria com a Principal). Si no, o si és '__new__', en crea un de nou.
        if (cloneVaultId && cloneVaultId !== '__new__' && vaults.some(v => v.id === cloneVaultId)) {
            return cloneVaultId;
        }
        const name = (newVaultName.trim() || 'Notion');
        const { data } = await axios.post('/api/vaults', { name });
        await loadVaults();
        setCloneVaultId(data.id);
        return data.id;
    };

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

    // Detecta vistes enllaçades (linked databases): es veuen a Notion però l'API no les pot
    // clonar i `/search` no les retorna. Cal compartir-ne la FONT. Escaneig sota demanda.
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
            // Preserva la selecció: conserva les BD que ja tenies marcades i marca les NOVES
            // (les que no eren a la llista anterior, p. ex. una BD acabada de compartir). A la
            // primera càrrega (no n'hi havia cap) → totes marcades.
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

    // Carrega les pàgines fora de BD només quan l'usuari activa el toggle (són moltes; evita
    // la crida si no les vol). Per defecte cap seleccionada: l'usuari tria quines incloure.
    const toggleLoosePages = async () => {
        const next = !loosePages;
        setLoosePages(next);
        if (next && loosePagesList.length === 0) {
            setBusy('loose'); setError('');
            try {
                const lp = await axios.get('/api/notion/loose-pages', { timeout: 120000 });
                const pages = sortByTitle(lp.data.pages);
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

    // Atura el polling de progrés (si n'hi ha) i neteja la barra.
    const stopProgressPoll = () => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
    useEffect(() => stopProgressPoll, []);   // neteja en desmuntar

    // Consulta el progrés del clon cada 1,5s. En mode "resume" (modal reobert amb un clon ja en
    // marxa) la petició /clone original s'ha perdut, així que és el mateix polling qui detecta el
    // final (running=false) i tanca la barra amb els comptadors acumulats.
    const startProgressPoll = (resume) => {
        pollResumeRef.current = resume;
        stopProgressPoll();
        pollRef.current = setInterval(async () => {
            try {
                const { data } = await axios.get('/api/notion/clone/progress', { timeout: 8000 });
                setProgress(data);
                if (pollResumeRef.current && data?.vault_id) setUsedVaultId(data.vault_id);  // per verificar al vault bo
                if (pollResumeRef.current && data && data.running === false) {
                    stopProgressPoll(); setBusy(''); setProgress(null);
                    setReport({ status: 'success', tables: data.tables, pages: data.pages,
                        views: data.views, attachments: data.attachments,
                        errors: [], warnings: [], truncated: false });
                }
            } catch { /* transitori: ignora, el següent tic ho reintenta */ }
        }, 1500);
    };

    // En obrir el panell, si JA hi ha un clon en marxa (p. ex. es va tancar el modal sense esperar),
    // recupera'n l'estat i reprèn la barra en comptes d'oferir disparar el clon de nou.
    useEffect(() => {
        let alive = true;
        axios.get('/api/notion/clone/progress', { timeout: 8000 }).then(({ data }) => {
            if (alive && data?.vault_id) setUsedVaultId(data.vault_id);  // recorda el vault del clon per verificar-hi
            if (alive && data && data.running) {
                setBusy('clone'); setProgress(data); startProgressPoll(true);
            }
        }).catch(() => {});
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const runClone = async () => {
        setBusy('clone'); setError(''); setReport(null);
        // Resol/crea el vault destí ABANS de res; el clon hi escriurà via X-Vault-Id (sense tocar
        // el vault global actiu). Si falla, no engeguem el clon.
        let vid;
        try { vid = await resolveCloneVault(); }
        catch (e) {
            setError('No s\'ha pogut preparar el vault destí: ' + String(e?.response?.data?.detail || e.message));
            setBusy(''); return;
        }
        setUsedVaultId(vid);
        setUsedVaultName(cloneVaultId === '__new__' ? (newVaultName.trim() || 'Notion')
            : (vaults.find(v => v.id === vid)?.name || ''));
        const vaultHeader = { 'X-Vault-Id': vid };
        setProgress({ phase: 'starting', done: 0, total: 0, pages: 0 });
        // El clon és una sola petició bloquejant; mentrestant, consultem el progrés cada 1,5s.
        startProgressPoll(false);
        try {
            const { data } = await axios.post('/api/notion/clone', {
                database_ids: databases.length ? Array.from(selected) : null,
                target_folder: '',   // arrel del vault destí (sense subcarpeta)
                schema_overrides: Object.keys(schemaOverrides).length ? schemaOverrides : null,
                loose_page_types: selectedLooseTypes(),
            }, { timeout: 0, headers: vaultHeader });  // clon = moltes crides MCP: sense timeout; al vault destí
            setReport(data);
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); stopProgressPoll(); setProgress(null); }
    };

    // Avorta el clon en curs (després de confirmar al modal). El backend para al següent punt de
    // control entre pàgines; la petició /clone segueix oberta i retornarà el report parcial.
    const doAbortClone = async () => {
        setConfirmAbort(false);
        try {
            await axios.post('/api/notion/clone/abort');
            setProgress(p => p ? { ...p, phase: 'cancelled' } : p);
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
    };

    const runVerify = async () => {
        setBusy('verify'); setError(''); setVerify(null);
        // Verifica al vault ON S'HA CLONAT: prioritza el vault usat pel clon; si no se sap, el
        // triat al selector (si és un vault real). MAI sense vault → verificaria el vault ACTIU
        // (sovint Principal) i donaria un resultat fals ("BD OK 0/16"), l'incident del 2026-07-01.
        const verifyVault = usedVaultId
            || (cloneVaultId && cloneVaultId !== '__new__' && vaults.some(v => v.id === cloneVaultId) ? cloneVaultId : null);
        if (!verifyVault) {
            setError('No sé a quin vault és el clon. Canvia al vault del clon (selector de vaults) i torna a verificar.');
            setBusy(''); return;
        }
        try {
            const { data } = await axios.post('/api/notion/verify-clone', {
                database_ids: databases.length ? Array.from(selected) : null,
                target_folder: '',   // arrel del vault destí (sense subcarpeta)
            }, { timeout: 0, headers: { 'X-Vault-Id': verifyVault } });
            setVerify(data);
        } catch (e) { setError(String(e?.response?.data?.detail || e.message)); }
        finally { setBusy(''); }
    };

    // Esborra el clon: elimina el vault destí sencer (fila + carpeta al disc) i reseteja el panell
    // a "Crear vault nou" perquè es pugui tornar a clonar net.
    const doDeleteClone = async () => {
        setConfirmDelClone(false);
        const vid = cloneVaultId;
        if (!vid || vid === '__new__') return;
        setBusy('delclone'); setError('');
        try {
            await axios.delete(`/api/vaults/${vid}?delete_files=true`);
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
                        <button onClick={checkLinked} disabled={busy === 'linked'}
                            title="Cerca BD que es veuen a Notion però són vistes enllaçades (no importables): cal compartir-ne la font."
                            style={{ ...inp, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 14px' }}>
                            {busy === 'linked' ? <Loader size={14} className="animate-spin" /> : <Unlink size={14} />}
                            {busy === 'linked' ? 'Cercant…' : 'Detecta vistes enllaçades'}
                        </button>
                    </div>

                    {linkedDbs && (
                        linkedDbs.linked.length === 0 ? (
                            <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'var(--bg-primary)', border: '1px solid var(--settings-border)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                ✓ Cap vista enllaçada no importable detectada{linkedDbs.capped ? ' (escaneig parcial: hi ha més pàgines de les revisades)' : ''}.
                            </div>
                        ) : (
                            <div style={{ marginTop: 12, padding: 14, borderRadius: 12, background: 'var(--bg-primary)', border: '1px solid #e0a52e', fontSize: '0.83rem', color: 'var(--text-primary)' }}>
                                <div style={{ fontWeight: 800, color: '#e0a52e', marginBottom: 6 }}>
                                    ⚠️ {linkedDbs.linked.length} BD enllaçada{linkedDbs.linked.length > 1 ? 'es' : ''} (no importables)
                                </div>
                                <div style={{ marginBottom: 8, color: 'var(--text-secondary)' }}>
                                    Es veuen a Notion però són <b>vistes enllaçades</b>: l'API no les pot clonar. Obre-les a Notion, ves a la <b>BD original</b> i comparteix-la amb la integració; després torna a llistar.
                                </div>
                                {linkedDbs.linked.map((l, i) => {
                                    const named = l.title && l.title !== 'Untitled';
                                    return (
                                        <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
                                            <span>🔗</span>
                                            <span>
                                                {named ? <><b>{l.title}</b> <span style={{ color: 'var(--text-tertiary)' }}>— a «{l.page_title}»</span></>
                                                    : <>Vista enllaçada dins de <b>«{l.page_title}»</b></>}
                                            </span>
                                        </div>
                                    );
                                })}
                                {linkedDbs.capped && (
                                    <div style={{ marginTop: 6, color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                                        Escaneig parcial ({linkedDbs.scanned} pàgines): pot haver-n'hi més.
                                    </div>
                                )}
                            </div>
                        )
                    )}

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
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxHeight: 220, overflowY: 'auto', overflowX: 'hidden' }}>
                                {databases.map(d => (
                                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '6px 10px', borderRadius: 10, border: '1px solid var(--settings-border)' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.83rem', color: 'var(--text-primary)', flex: 1, minWidth: 0, cursor: 'pointer' }}>
                                            <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
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
                                                        // El ressaltat només compta si la pàgina està inclosa,
                                                        // així una pàgina no marcada no sembla tenir tipus triat.
                                                        const active = included && (loosePageTypes[p.id] || 'wiki') === opt;
                                                        return (
                                                            // Clicar Wiki/Dashboard SELECCIONA la pàgina (la marca)
                                                            // i li fixa el tipus, sense haver de clicar el checkbox.
                                                            <button key={opt}
                                                                onClick={() => {
                                                                    setLoosePageTypes(s => ({ ...s, [p.id]: opt }));
                                                                    setLooseSelected(s => { const n = new Set(s); n.add(p.id); return n; });
                                                                }}
                                                                style={{ padding: '4px 11px', fontSize: '0.76rem', border: 'none', cursor: 'pointer',
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

                            {/* Vault destí: el clon va a un vault SEPARAT a l'arrel (germà del principal)
                                perquè el puguis validar aïllat i adoptar-lo o descartar-lo, sense barrejar-lo
                                amb el vault actiu. Per defecte, en crea un de nou. */}
                            <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                    Vault destí:&nbsp;
                                    <select style={{ ...inp, display: 'inline-block', cursor: 'pointer' }}
                                        value={cloneVaultId} onChange={e => setCloneVaultId(e.target.value)}>
                                        <option value="__new__">➕ Crear un vault nou (a l'arrel)</option>
                                        {vaults.map(v => (
                                            <option key={v.id} value={v.id}>{v.name}{v.active ? ' (actiu)' : ''}</option>
                                        ))}
                                    </select>
                                </label>
                                {cloneVaultId === '__new__' && (
                                    <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                        Nom:&nbsp;
                                        <input style={{ ...inp, width: 160, display: 'inline-block' }}
                                            value={newVaultName} onChange={e => setNewVaultName(e.target.value)}
                                            placeholder="Notion" />
                                    </label>
                                )}
                                <span style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
                                    El clon es crea directament a …/Gnosi/{cloneVaultId === '__new__' ? (newVaultName.trim() || 'Notion') : (vaults.find(v => v.id === cloneVaultId)?.name || '?')} (vault separat, sense subcarpeta).
                                </span>
                            </div>

                            <div style={{ marginTop: 12, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
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
                                {/* Si el vault destí JA té un clon: no deixem tornar-hi a clonar (duplicats);
                                    en lloc del botó Clonar mostrem Verifica + Esborra. Persisteix en reobrir. */}
                                {destClone && busy !== 'clone' ? (
                                    <>
                                        <span style={{ fontSize: '0.82rem', color: '#e0a52e', fontWeight: 700 }}>
                                            ⚠️ Aquest vault ja té un clon ({destClone.tables} BD)
                                        </span>
                                        <button className="btn-gnosi-primary" onClick={runVerify} disabled={busy === 'verify'}
                                            title="Compara Notion ↔ clon d'aquest vault."
                                            style={{ padding: '9px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
                                            {busy === 'verify' ? <Loader size={15} className="animate-spin" /> : <Check size={15} />}
                                            {busy === 'verify' ? 'Verificant…' : 'Verifica el clon'}
                                        </button>
                                        <button onClick={() => setConfirmDelClone(true)} disabled={busy === 'delclone'}
                                            title="Esborra aquest vault clonat (fila + carpeta) per poder tornar a clonar net."
                                            style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', color: '#e0524e', borderColor: '#e0524e' }}>
                                            {busy === 'delclone' ? <Loader size={15} className="animate-spin" /> : <X size={15} />}
                                            {busy === 'delclone' ? 'Esborrant…' : 'Esborra el clon'}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button className="btn-gnosi-primary" onClick={runClone}
                                            disabled={busy === 'clone' || selected.size === 0 || !mcpConnected}
                                            title={mcpConnected
                                                ? "Clon EXACTE de Notion a una carpeta NOVA. No toca el vault actual."
                                                : "Connecta primer l'MCP per al clon exacte."}
                                            style={{ padding: '9px 18px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: mcpConnected ? 'pointer' : 'not-allowed', opacity: mcpConnected ? 1 : 0.6 }}>
                                            {busy === 'clone' ? <Loader size={15} className="animate-spin" /> : <Database size={15} />}
                                            {busy === 'clone' ? t('notion_cloning') : t('notion_clone')}
                                        </button>
                                        {busy === 'clone' && (
                                            <button onClick={() => setConfirmAbort(true)}
                                                disabled={progress?.phase === 'cancelled'}
                                                title="Atura el clon. El que ja s'ha clonat queda al disc (parcial)."
                                                style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', color: '#e0524e', borderColor: '#e0524e' }}>
                                                <X size={15} /> {progress?.phase === 'cancelled' ? 'Avortant…' : 'Avortar'}
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>

                            {busy === 'clone' && progress && (() => {
                                const labels = {
                                    starting: 'Preparant…', schema: 'Clonant esquemes de BD',
                                    collect: 'Recollint files', pages: 'Escrivint pàgines',
                                    loose: 'Pàgines soltes', subpages: 'Sub-pàgines', done: 'Finalitzant…',
                                };
                                const total = progress.total || 0;
                                const done = progress.done || 0;
                                const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
                                return (
                                    <div style={{ marginTop: 14 }}>
                                        <style>{'@keyframes gnosi-indeterminate{0%{margin-left:-40%}100%{margin-left:100%}}'}</style>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                                            <span>{labels[progress.phase] || progress.phase}{total > 0 ? ` — ${done}/${total}` : ''}</span>
                                            <span>{progress.pages || 0} pàgines · {progress.tables || 0} BD · {progress.views || 0} vistes</span>
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
                                {report.status === 'cancelled' ? '⏹️ Clon avortat (parcial): ' : '✓ Clonat: '}<b>{report.tables}</b> bases de dades · <b>{report.pages}</b> pàgines · <b>{report.views}</b> vistes
                                {report.attachments > 0 && <span> · <b>{report.attachments}</b> adjunts</span>}
                            </div>
                            {usedVaultName && (
                                <div style={{ marginTop: 6, color: 'var(--text-secondary)' }}>
                                    📁 Al vault <b>«{usedVaultName}»</b> (a l'arrel). Canvia-hi des del selector de vaults per veure'l i validar-lo.
                                </div>
                            )}
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

                    {verify && (() => {
                        // Les BD completes (tables_ok == total) ja és un bon clon: els cossos buits i
                        // relacions òrfenes són detalls menors, no "incidències". Només si FALTEN BD
                        // ho marquem com a incomplet (àmbar).
                        const tablesComplete = verify.summary?.tables_ok === verify.summary?.tables_total;
                        const ok = verify.summary?.healthy || tablesComplete;
                        return (
                        <div style={{ marginTop: 14, padding: 14, borderRadius: 12, fontSize: '0.85rem', color: 'var(--text-primary)',
                            background: 'var(--bg-primary)', border: `1px solid ${ok ? 'var(--gnosi-primary)' : '#e0a52e'}` }}>
                            <div style={{ fontWeight: 800, marginBottom: 8 }}>
                                {verify.summary?.healthy ? '✅ Clon saludable'
                                    : tablesComplete ? '✅ Clon complet (detalls menors)'
                                    : '⚠️ Clon incomplet: falten pàgines'}
                            </div>
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                                <span>BD OK: <b>{verify.summary?.tables_ok}/{verify.summary?.tables_total}</b></span>
                                <span>Pàgines: <b>{verify.summary?.pages}</b></span>
                                <span>Vistes: <b>{verify.summary?.views}</b></span>
                                <span style={{ color: verify.summary?.empty_bodies ? '#e0a52e' : 'inherit' }}>Cossos buits: <b>{verify.summary?.empty_bodies}</b></span>
                                <span style={{ color: verify.summary?.orphan_relations ? '#e0a52e' : 'inherit' }}>Relacions òrfenes: <b>{verify.summary?.orphan_relations}</b></span>
                                <span style={{ color: verify.summary?.missing_assets ? '#e0a52e' : 'inherit' }}>Adjunts que falten: <b>{verify.summary?.missing_assets}</b></span>
                            </div>
                            {tablesComplete && !verify.summary?.healthy && (
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                                    Totes les BD estan completes. Els <b>cossos buits</b> són files sense text a Notion i les <b>relacions òrfenes</b> apunten a pàgines fora del clon (esborrades o filtrades) — detalls menors, no falta contingut de BD.
                                </div>
                            )}
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
                    onSave={(newSchema) => {
                        // SchemaConfigModal és d'AUTOSAVE: crida onSave a cada canvi (i un cop en
                        // obrir). NO tanquem aquí (tancaria sol en obrir); només desem l'override.
                        const dbId = cfg.db.id;
                        setSchemaOverrides(prev => ({ ...prev, [dbId]: newSchema }));
                    }}
                />
            )}

            <ConfirmModal
                isOpen={confirmAbort}
                onClose={() => setConfirmAbort(false)}
                onConfirm={doAbortClone}
                title="Avortar el clon?"
                message="El clon s'aturarà al següent punt de control (entre pàgines). El que ja s'ha clonat quedarà al disc com a clon parcial; pots esborrar la carpeta destí i tornar a començar."
                confirmText="Avortar el clon"
                cancelText="Continuar clonant"
                isDestructive={true}
            />

            <ConfirmModal
                isOpen={confirmDelClone}
                onClose={() => setConfirmDelClone(false)}
                onConfirm={doDeleteClone}
                title="Esborrar el clon?"
                message={`S'eliminarà el vault «${vaults.find(v => v.id === cloneVaultId)?.name || ''}» sencer (fila + carpeta al disc) amb tot el clon. Aquesta acció no es pot desfer. Després podràs tornar a clonar net.`}
                confirmText="Esborra el clon"
                cancelText="Cancel·la"
                isDestructive={true}
            />
        </div>
    );
}
