import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Loader2, AlertCircle, Plus, Search, SlidersHorizontal, ChevronDown, ChevronUp, X, LayoutTemplate, MoreHorizontal, Settings, Edit2, Copy, Trash2 } from 'lucide-react';
import { compareFieldValues, NUM_RE, ISO_DATE_RE, parseNumericValue } from '../../utils/vaultFilters';
import { VaultEditorContext } from './VaultEditorContext';
import { VaultMarkdown, RetryableImage } from './VaultMarkdown';
import { normalizeAssetUrl } from './vaultMarkdownUtils';
import { VaultViewBody } from './VaultViewBody';
import { buildSchemaFromTableProperties } from './schemaUtils';
import { VIEW_TYPES } from './viewConstants';
import ConfirmModal from '../ConfirmModal';
import PromptModal from '../PromptModal';
import { toast } from '../../lib/toast';

// Contenidor amb scroll per encabir els components de vista complets (que
// assumeixen alçada) dins del flux del document de l'embed. A nivell de mòdul
// per no recrear el tipus de component a cada render (evitaria remounts).
const ScrollBox = ({ children }) => (
    // `w-full max-w-full min-w-0` clava l'amplada a la del contenidor de
    // l'editor (no a la del contingut); `overflow-x-auto` fa que la taula
    // ampla faci scroll DINS de la caixa i no desbordi la pàgina/editor.
    <div className="my-2 w-full max-w-full min-w-0 max-h-[70vh] min-h-[8rem] overflow-x-auto overflow-y-auto rounded-lg border border-[var(--border-primary)] focus-within:border-[var(--gnosi-primary)]/50 focus-within:ring-1 focus-within:ring-[var(--gnosi-primary)]/30 transition-all">
        {children}
    </div>
);

// Contenidor per a la TAULA/llista: NO fa scroll propi (overflow-hidden) i és
// flex-col amb alçada acotada perquè la pròpia VaultTable (que té el seu
// scroller intern + columna `title` sticky) gestioni l'scroll horitzontal i
// vertical. Si embolcalléssim la taula en una caixa amb `overflow-x-auto`,
// l'scroll horitzontal el faria la caixa i la columna sticky no quedaria fixa.
//
// `isolate` (isolation: isolate) crea un context d'apilament que CONFINA els
// z-index interns de la VaultTable (les cel·les sticky usen z-20/z-30/z-40).
// Sense això, com que ni la caixa ni el scroller creen context d'apilament,
// aquests z-index pugen fins a l'arrel de l'embed i tapen els desplegables de
// la barra de pestanyes (la columna sticky del títol, z-40, pintava per sobre
// del menú "+"/"…"). Amb `isolate`, la taula participa com un sol bloc i els
// menús (a la barra, positioned) queden sempre per sobre.
//
// Alçada ADAPTATIVA: ja no forcem `h-[60vh]` (deixava un gran buit amb poques
// files). La VaultTable rep `maxHeight` i el seu scroller pren l'alçada del
// contingut, fent scroll intern només si el supera. Per això la caixa no porta
// alçada fixa ni `overflow-hidden` (que retallaria els menús que s'obrin avall):
// la vora/arrodonit els posa el propi scroller de la taula (mode `isEmbedded`).
const TableBox = ({ children }) => (
    <div className="my-2 w-full max-w-full min-w-0 isolate">
        {children}
    </div>
);

// Contenidor del FEED incrustat: CREIX amb el contingut (com a Notion) i és la
// PÀGINA qui fa l'scroll — res de caixa de 70vh amb scroll intern. L'scroll
// infinit del feed hi juga a favor: comença amb un lot petit i el sentinella
// (que resol el scroller real via getScrollParent) va carregant la resta a
// mesura que baixes per la pàgina; "Veure més" també expandeix la pàgina.
const FeedFlowBox = ({ children }) => (
    <div className="my-2 w-full max-w-full min-w-0 rounded-xl border border-transparent focus-within:border-[var(--gnosi-primary)]/50 focus-within:ring-1 focus-within:ring-[var(--gnosi-primary)]/30 overflow-hidden transition-all">
        {children}
    </div>
);

/* -------------------------------------------------------------------------- */
/*  Utilitats de filtre / ordenació / format                                  */
/* -------------------------------------------------------------------------- */

// Nom de camp sense prefix decoratiu (símbols/espais), en minúscules: permet que
// un filtre guardat amb una variant antiga del nom d'una columna casi amb la
// metadata canonicalitzada al nom NOU (`Àrees`) després de renomenar-la. Mirall
// de `_normalize_field_key` (backend view_snapshot.py).
function normFieldKey(name) {
    return String(name ?? '').replace(/^[^\p{L}\p{N}_]+/u, '').trim().toLowerCase();
}
function metaValueForField(meta, field) {
    if (!meta) return undefined;
    if (field in meta) return meta[field];
    const nf = normFieldKey(field);
    if (!nf) return undefined;
    for (const k of Object.keys(meta)) {
        if (normFieldKey(k) === nf) return meta[k];
    }
    return undefined;
}

// Valors que un checkbox considera "marcat". Paritat amb `asBool`
// (vaultFilters.js) i `_as_bool` (view_snapshot.py): camp absent/""/0/"false"
// = no marcat. Es replica aquí (en lloc d'importar-lo de vaultFilters) per
// mantenir el canvi acotat als fitxers d'aquesta vista.
const FILTER_TRUTHY = new Set(['true', '1', 'yes', 'si', 'sí', 'done', 'checked', 'completat']);
function asBool(x) {
    if (x === true) return true;
    if (x === false || x == null || x === '') return false;
    if (typeof x === 'number') return x !== 0;
    return FILTER_TRUTHY.has(String(x).trim().toLowerCase());
}

function applyFilter(meta, pageId, f) {
    if (!f?.field) return true;
    const op = (f.operator || 'equals').toLowerCase();
    const raw = f.value === 'this' ? pageId : f.value;
    const target = raw == null ? null : String(raw);
    const v = metaValueForField(meta, f.field);
    const arr = Array.isArray(v) ? v.map(String) : v == null || v === '' ? [] : [String(v)];
    if (op === 'is_empty') return arr.length === 0;
    if (op === 'is_not_empty') return arr.length > 0;
    if (target == null) return true;
    const targetLower = target.toLowerCase();
    // Valor booleà (checkbox: "true"/"false"): comparem per veritat —no per
    // cadena— perquè un camp absent compti com a "no marcat" i casi amb "false".
    // Paritat amb matchesFilters (vaultFilters.js) i apply_filter (backend).
    if ((op === 'equals' || op === 'not_equals') && (targetLower === 'true' || targetLower === 'false')) {
        const want = targetLower === 'true';
        const cur = asBool(v);
        return op === 'equals' ? cur === want : cur !== want;
    }
    // Text/select case-INsensitiu (com Notion i com la vista principal): un
    // valor "Català" emmagatzemat casa amb el filtre "català". Els numèrics
    // (greater/less) es comparen a part, sense minúscules.
    const arrLower = arr.map(x => x.toLowerCase());
    if (op === 'equals') return arrLower.includes(targetLower);
    if (op === 'not_equals') return !arrLower.includes(targetLower);
    if (op === 'contains') return arrLower.some(x => x.includes(targetLower));
    if (op === 'not_contains') return !arrLower.some(x => x.includes(targetLower));
    // major/menor que: si TOTS DOS (valor i filtre) són números purs, comparació
    // numèrica (parseNumericValue, paritat amb matchesFilters: '12,5' → 12.5,
    // decimal de coma; abans parseFloat pelat hi divergia i fins i tot del
    // multiKeySort d'aquí mateix); si no, comparació de CADENA en minúscules.
    // Per a dates ISO l'ordre lexicogràfic és cronològic i coincideix entre JS
    // i Python (ASCII), així que el filtre per rang de dates funciona i és
    // consistent amb la vista principal i el backend.
    if (op === 'greater_than' || op === 'less_than') {
        const gt = op === 'greater_than';
        const targetNum = NUM_RE.test(target.trim());
        return arr.some((x, i) => {
            const xt = x.trim();
            if (targetNum && NUM_RE.test(xt)) {
                const n = parseNumericValue(x), t = parseNumericValue(target);
                return gt ? n > t : n < t;
            }
            // Target numèric (any nu) amb valor no numèric: només casa si el valor
            // és una data ISO (lexicogràfic = cronològic); text arbitrari ("foo")
            // NO casa. Paritat amb vaultFilters (matchesFilters) i backend.
            if (targetNum && !ISO_DATE_RE.test(xt)) return false;
            const xl = arrLower[i];
            return gt ? xl > targetLower : xl < targetLower;
        });
    }
    return true;
}

function multiKeySort(rows, sorts) {
    // Comparador compartit amb la vista principal (vaultFilters.compareFieldValues):
    // buits al final, ordre numèric per a números i localeCompare normalitzat per
    // la resta. Abans ordenava per string pur (`localeCompare`), de manera que els
    // números sortien lexicogràfics ("10" abans de "2") i els buits suraven al
    // capdamunt → la vista incrustada divergia de la taula principal.
    if (!sorts || sorts.length === 0) {
        return [...rows].sort((a, b) => compareFieldValues(a.title, b.title, 'asc'));
    }
    const result = [...rows];
    for (let i = sorts.length - 1; i >= 0; i--) {
        const { field, direction = 'asc' } = sorts[i];
        if (!field) continue;
        result.sort((a, b) => compareFieldValues(a.metadata?.[field], b.metadata?.[field], direction));
    }
    return result;
}

function displayValue(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
}

function pickDateCol(columns, rows) {
    // Coincidència per paraula sencera (separadors: espai, guió, subratllat o
    // inici/final) per evitar falsos positius com "metadata" (conté "data"),
    // "Today"/"Sunday"/"Holiday" (contenen "day"), etc.
    const byName = (columns || []).find(c => /(^|[\s_-])(data|date|fecha|created|day)([\s_-]|$)/i.test(String(c || '')));
    if (byName) return byName;
    // Heurística: primera columna que tingui valors parsejables com a data en
    // almenys el 50% de les files.
    for (const c of columns || []) {
        let hits = 0;
        for (const r of rows || []) {
            if (parseDate(r.metadata?.[c])) hits++;
        }
        if (hits >= Math.max(1, (rows?.length || 0) * 0.5)) return c;
    }
    return null;
}

function parseDate(v) {
    const raw = Array.isArray(v) ? v[0] : v;
    if (!raw) return null;
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

function Heading({ level, children }) {
    const safeLevel = Math.min(Math.max(Number(level) || 1, 1), 6);
    const Tag = `h${safeLevel}`;
    const cls = safeLevel === 1 ? 'text-2xl font-bold mb-3'
        : safeLevel === 2 ? 'text-xl font-bold mb-2'
        : 'text-lg font-semibold mb-2';
    return <Tag className={`${cls} text-[var(--text-primary)]`}>{children}</Tag>;
}

/* -------------------------------------------------------------------------- */
/*  Helpers d'acció (create / update propietat)                               */
/* -------------------------------------------------------------------------- */

async function createPageInTable({ tableId, title = 'Nou registre', extraMetadata = {} } = {}) {
    const body = {
        title,
        content: '',
        metadata: { table_id: tableId, ...extraMetadata },
    };
    const res = await axios.post('/api/vault/pages', body);
    return res.data;
}

async function patchPageMetadata(pageId, partialMetadata) {
    // PATCH partial directe: el backend fa `metadata.update(request.metadata)`
    // i conserva title/content/altres camps intactes. Abans fèiem GET +
    // PATCH (2 round-trips serialitzats, 400-700 ms) per construir un
    // payload complet "per seguretat"; el backend actual accepta partials
    // així que estalviem el GET i la latència corresponent.
    await axios.patch(
        `/api/vault/pages/${encodeURIComponent(pageId)}`,
        { metadata: partialMetadata }
    );
    return partialMetadata;
}

async function patchSectionConfig(pageId, section, patch) {
    // El POST /api/pages/{page_id}/views fa upsert per heading. Enviem la
    // section completa (preservant tots els camps llegacy) amb el patch
    // aplicat. Requereix ConfigDict(extra='allow') al model ViewSection.
    const next = { ...section, ...patch };
    await axios.post(`/api/pages/${encodeURIComponent(pageId)}/views`, next);
    return next;
}

function ViewActionsBar({
    onCreate,
    templates = [],
    onOpenConfig,
    searchTerm,
    setSearchTerm,
    showSearch,
    setShowSearch,
}) {
    const [showNewMenu, setShowNewMenu] = useState(false);
    const menuRef = useRef(null);
    useEffect(() => {
        if (!showNewMenu) return undefined;
        const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setShowNewMenu(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showNewMenu]);

    return (
        <div className="flex items-center gap-1">
            {showSearch ? (
                <div className="flex items-center gap-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md px-2 py-1">
                    <Search size={12} className="text-[var(--text-tertiary)]" />
                    <input
                        autoFocus
                        type="text"
                        value={searchTerm}
                        onChange={e => setSearchTerm?.(e.target.value)}
                        placeholder="Cerca..."
                        className="text-xs outline-none w-28 text-[var(--text-primary)] bg-transparent"
                    />
                    <button
                        onClick={() => { setSearchTerm?.(''); setShowSearch?.(false); }}
                        className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                    >
                        <X size={12} />
                    </button>
                </div>
            ) : (
                <button
                    onClick={() => setShowSearch?.(true)}
                    className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    title="Cerca"
                >
                    <Search size={14} />
                </button>
            )}

            {onOpenConfig && (
                <button
                    onClick={onOpenConfig}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-md transition-colors"
                    title="Configuració de la vista"
                >
                    <SlidersHorizontal size={13} />
                </button>
            )}

            {onCreate && (
                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => onCreate()}
                        className="btn-gnosi btn-gnosi-primary !px-3 !py-1.5 !text-xs !gap-1.5 !shadow-none active:scale-95"
                        style={{ boxShadow: 'none' }}
                    >
                        <Plus size={14} />
                        <span>Nou</span>
                        <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); setShowNewMenu(o => !o); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowNewMenu(o => !o); } }}
                            className="pl-1 border-l border-white/20 hover:text-white/80 cursor-pointer inline-flex"
                        >
                            <ChevronDown size={14} />
                        </span>
                    </button>
                    {showNewMenu && (
                        <div className="absolute top-full right-0 mt-1 w-56 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[1001] py-1">
                            <button
                                onClick={() => { setShowNewMenu(false); onCreate(); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] text-left"
                            >
                                <Plus size={14} className="text-[var(--text-tertiary)]" />
                                <span>Nou registre</span>
                            </button>
                            {templates.length > 0 && (
                                <>
                                    <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                                    <div className="px-3 py-1 text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter">Plantilles</div>
                                    {templates.map(tpl => (
                                        <button
                                            key={tpl.id}
                                            onClick={() => { setShowNewMenu(false); onCreate({}, tpl); }}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] text-left group"
                                        >
                                            <LayoutTemplate size={14} className="text-[var(--text-tertiary)] group-hover:text-[var(--gnosi-primary)]" />
                                            <span className="truncate">{tpl.title || '(sense títol)'}</span>
                                        </button>
                                    ))}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ColumnPlusButton({ onClick }) {
    return (
        <button
            onClick={onClick}
            className="text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
            title="Crear a aquesta columna"
        >
            <Plus size={12} />
        </button>
    );
}

/* -------------------------------------------------------------------------- */
/*  Cache de previews i de pàgines per taula                                  */
/* -------------------------------------------------------------------------- */

const _previewCache = new Map();
function _cacheGet(id) { return _previewCache.get(id); }
function _cacheSet(id, value) {
    if (_previewCache.size >= 500) {
        const oldest = _previewCache.keys().next().value;
        _previewCache.delete(oldest);
    }
    _previewCache.set(id, value);
}

const _byTableCache = new Map();
// 5 min: el cache evita ràfegues de /pages/by-table durant navegacions
// curtes (canviar de pestanya i tornar, scroll, obrir/tancar el modal de
// config). El backend serveix la mateixa llista uns 10-15s a OneDrive fred,
// així que reutilitzar el cache una mica més estona evita una espera
// equivalent. La cache es buida si l'usuari prem el botó de reload.
const BY_TABLE_TTL_MS = 300_000;
// Cada entrada pot contenir milers de PageInfo (una taula gran), així que a
// diferència del TTL per-entrada cal un límit dur d'entrades per evitar que
// una sessió llarga visitant moltes taules acumuli memòria sense fre. 32
// taules cobreix de sobres qualsevol vista activa; en superar-lo, evicció
// FIFO de la més antiga (Map preserva l'ordre d'inserció).
const BY_TABLE_MAX_ENTRIES = 32;
function _byTableGet(tableId) {
    const e = _byTableCache.get(tableId);
    if (!e) return null;
    if (Date.now() - e.ts > BY_TABLE_TTL_MS) { _byTableCache.delete(tableId); return null; }
    return e.value;
}
function _byTableSet(tableId, value) {
    // Refresca la posició d'inserció perquè el cap FIFO no expulsi una taula
    // que s'acaba de rellegir.
    if (_byTableCache.has(tableId)) _byTableCache.delete(tableId);
    else if (_byTableCache.size >= BY_TABLE_MAX_ENTRIES) {
        const oldest = _byTableCache.keys().next().value;
        _byTableCache.delete(oldest);
    }
    _byTableCache.set(tableId, { ts: Date.now(), value });
}

/* -------------------------------------------------------------------------- */
/*  Graph (força)                                                             */
/* -------------------------------------------------------------------------- */

function GraphRender({ rows, columns, onOpenPage }) {
    const idToRow = useMemo(() => Object.fromEntries((rows || []).map(r => [r.id, r])), [rows]);
    const titleToId = useMemo(() => {
        const m = {};
        (rows || []).forEach(r => { if (r.title) m[r.title] = r.id; });
        return m;
    }, [rows]);

    const relationCol = (columns || []).find(c => (rows || []).some(r => Array.isArray(r.metadata?.[c]) && r.metadata[c].length > 0));

    const { nodes, links } = useMemo(() => {
        const nodeMap = new Map();
        (rows || []).forEach(r => nodeMap.set(r.id, { id: r.id, title: r.title || '(sense títol)' }));
        const edges = [];
        if (relationCol) {
            (rows || []).forEach(r => {
                const targets = r.metadata?.[relationCol];
                if (!Array.isArray(targets)) return;
                targets.forEach(t => {
                    const tid = idToRow[t] ? t : titleToId[t];
                    if (!tid) return;
                    if (!nodeMap.has(tid)) nodeMap.set(tid, { id: tid, title: tid });
                    edges.push({ source: r.id, target: tid });
                });
            });
        }
        return { nodes: Array.from(nodeMap.values()), links: edges };
    }, [rows, relationCol, idToRow, titleToId]);

    const svgRef = useRef(null);
    const [hover, setHover] = useState(null);
    const W = 600, H = 360;

    // Simulació de força executada com a càlcul derivat (useMemo) per evitar
    // setState dins useEffect — el cost és amortitzable: ~250 iteracions × N²
    // és ràpid per a vistes amb menys de 200 nodes (el cas habitual).
    const positions = useMemo(() => {
        if (nodes.length === 0) return {};
        const sim = nodes.map((n, i) => ({
            id: n.id,
            x: W / 2 + Math.cos((i * 2 * Math.PI) / nodes.length) * 80,
            y: H / 2 + Math.sin((i * 2 * Math.PI) / nodes.length) * 80,
            vx: 0, vy: 0,
        }));
        const byId = Object.fromEntries(sim.map(s => [s.id, s]));
        const REPEL = 4000, SPRING = 0.02, SPRING_LEN = 80, CENTER = 0.005, DAMP = 0.85, STEPS = 250;

        for (let step = 0; step < STEPS; step++) {
            for (let i = 0; i < sim.length; i++) {
                for (let j = i + 1; j < sim.length; j++) {
                    const a = sim[i], b = sim[j];
                    let dx = a.x - b.x, dy = a.y - b.y;
                    const dist2 = dx * dx + dy * dy + 0.01;
                    const f = REPEL / dist2;
                    const dist = Math.sqrt(dist2);
                    dx /= dist; dy /= dist;
                    a.vx += dx * f * 0.001; a.vy += dy * f * 0.001;
                    b.vx -= dx * f * 0.001; b.vy -= dy * f * 0.001;
                }
            }
            links.forEach(l => {
                const s = byId[l.source], t = byId[l.target];
                if (!s || !t) return;
                const dx = t.x - s.x, dy = t.y - s.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const f = SPRING * (dist - SPRING_LEN);
                const fx = (dx / dist) * f, fy = (dy / dist) * f;
                s.vx += fx; s.vy += fy; t.vx -= fx; t.vy -= fy;
            });
            sim.forEach(n => {
                n.vx += (W / 2 - n.x) * CENTER;
                n.vy += (H / 2 - n.y) * CENTER;
                n.vx *= DAMP; n.vy *= DAMP;
                n.x += n.vx; n.y += n.vy;
                n.x = Math.max(20, Math.min(W - 20, n.x));
                n.y = Math.max(20, Math.min(H - 20, n.y));
            });
        }
        return Object.fromEntries(sim.map(s => [s.id, { x: s.x, y: s.y }]));
    }, [nodes, links]);

    return (
        <div className="my-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30">
            <div className="p-2 border-b border-[var(--border-primary)]/40 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Graf {relationCol ? <>via <code>{relationCol}</code></> : '(sense relacions)'} · {nodes.length} nodes · {links.length} arestes
            </div>
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 400 }}>
                {links.map((l, i) => {
                    const a = positions[l.source], b = positions[l.target];
                    if (!a || !b) return null;
                    return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--border-primary)" strokeOpacity="0.6" strokeWidth="1" />;
                })}
                {nodes.map(n => {
                    const p = positions[n.id]; if (!p) return null;
                    const isHover = hover === n.id;
                    return (
                        <g
                            key={n.id}
                            transform={`translate(${p.x}, ${p.y})`}
                            style={{ cursor: 'pointer' }}
                            onClick={() => onOpenPage?.(n.id)}
                            onMouseEnter={() => setHover(n.id)}
                            onMouseLeave={() => setHover(null)}
                        >
                            <circle r={isHover ? 8 : 5} fill="var(--gnosi-primary)" />
                            <text
                                x={10}
                                y={4}
                                fontSize={isHover ? 12 : 10}
                                fill="var(--text-primary)"
                                style={{ pointerEvents: 'none' }}
                            >
                                {n.title.length > 24 ? n.title.slice(0, 22) + '…' : n.title}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Wrapper principal                                                         */
/* -------------------------------------------------------------------------- */

export function DbViewEmbed({ block }) {
    const ctx = useContext(VaultEditorContext) || {};
    const pageId = ctx.pageId;
    const onOpenPage = ctx.onOpenPage;
    const onOpenPageViewModal = ctx.onOpenPageViewModal;
    const onOpenViewConfig = ctx.onOpenViewConfig;
    // API de navegació de teclat que la VaultTable embeguda hi registra, perquè
    // l'editor pugui "entrar" a la taula (focusFirstCell/focusLastCell) en
    // arribar-hi amb les fletxes. Vegeu el pont a VaultEditorContext.
    const tableNavApiRef = useRef(null);
    // Contenidor exterior de l'embed. Quan la vista NO és taula/llista (feed,
    // galeria, kanban, timeline…) no hi ha cel·les navegables: fem que la
    // closca sencera sigui enfocable (tabIndex=-1) i actuï com un widget —
    // «entrar-hi» amb ↓ li dona un focus visible i se'n surt amb ↑/↓/Esc.
    const embedContainerRef = useRef(null);
    const isInEditor = typeof ctx.exitEmbedToEditor === 'function';

    // Teclat quan la CLOSCA té el focus (no un fill: targeta, cerca, cel·la…).
    // ↑/↓ tornen el cursor a l'editor (bloc adjacent o zona superior); Esc surt.
    const handleShellKeyDown = useCallback((e) => {
        if (e.target !== embedContainerRef.current) return;
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            const dir = e.key === 'ArrowUp' ? 'up' : (e.key === 'ArrowDown' ? 'down' : 'escape');
            ctx.exitEmbedToEditor?.(block?.id, dir);
        }
    }, [ctx, block?.id]);

    const viewId = String(block?.props?.view_id || '').trim();
    const headingProp = block?.props?.heading || '';
    const headingLevelProp = Number(block?.props?.heading_level) || 0;

    const [view, setView] = useState(null);          // la SECCIÓ embeguda (àncora: taula + `this`)
    const [rawRecords, setRawRecords] = useState([]); // registres no-template SENSE filtrar
    const [templates, setTemplates] = useState([]);  // plantilles separades
    // FASE 3: pestanyes de vistes. Llista de vistes de la taula (registry.views)
    // i quina és l'activa. Per defecte, la vista de la secció del bloc.
    const [tableViews, setTableViews] = useState([]);
    const [activeViewId, setActiveViewId] = useState('');
    const [loading, setLoading] = useState(() => Boolean(pageId && viewId));
    const [error, setError] = useState(() => {
        if (!pageId) return 'Sense pàgina activa per resoldre la vista.';
        if (!viewId) return 'Vista sense view_id.';
        return '';
    });
    const [reloadKey, setReloadKey] = useState(0);
    // Últim `viewSectionNonce` (del context) que ja hem aplicat. Quan canvia vol
    // dir que s'acaba de desar la config d'una vista: ctx.registry del client
    // queda ranci i cal rellegir les vistes del backend (veure el `load`).
    const lastSavedNonceRef = useRef(0);
    const [searchTerm, setSearchTerm] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [addMenuOpen, setAddMenuOpen] = useState(false); // menú d'afegir vista (tipus / existents)
    const [tabMenuFor, setTabMenuFor] = useState(null);     // id de la vista amb el menú (treure/eliminar) obert
    const [menuUp, setMenuUp] = useState(false);            // obrir el desplegable cap amunt si no cap a sota
    const [confirmDeleteView, setConfirmDeleteView] = useState(null); // vista pendent d'eliminar a tot arreu (ConfirmModal)
    const [renameView, setRenameView] = useState(null);     // vista pendent de reanomenar (PromptModal)
    // Decideix la direcció del desplegable segons l'espai sota el disparador.
    const decideMenuDir = (e) => {
        try { const r = e.currentTarget.getBoundingClientRect(); setMenuUp(window.innerHeight - r.bottom < 300); } catch { setMenuUp(false); }
    };
    // Vistes FIXADES com a pestanyes EN AQUEST bloc, a part de la vista de la
    // secció (àncora, sempre present). Per defecte cap: el bloc mostra només la
    // vista que s'ha inserit/triat, no totes les de la taula. Clau estable per
    // bloc: pageId + view_id de la secció.
    const [pinnedViewIds, setPinnedViewIds] = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem(`gnosi_embed_pinned_${pageId}_${viewId}`) || '[]')); } catch { return new Set(); }
    });
    const persistPinned = (set) => {
        try { localStorage.setItem(`gnosi_embed_pinned_${pageId}_${viewId}`, JSON.stringify([...set])); } catch { /* noop */ }
    };

    const reload = useCallback(() => {
        _byTableCache.delete(view?.source_table_id || view?.table_id);
        setReloadKey(k => k + 1);
    }, [view]);

    useEffect(() => {
        if (!pageId || !viewId) return undefined;
        let cancelled = false;
        const load = async () => {
            setError('');
            setLoading(true);
            try {
                const viewsRes = await axios.get(`/api/pages/${encodeURIComponent(pageId)}/views`);
                const sections = viewsRes.data?.sections || [];
                let section = sections.find(s => s.view_id === viewId)
                    || (headingProp ? sections.find(s => s.heading === headingProp) : null);
                // Fallback: si aquest bloc no té secció registrada (p. ex. perquè
                // l'upsert de seccions PER HEADING ha col·lisionat amb un altre
                // embed sense heading a la mateixa pàgina), però la vista SÍ que
                // existeix al registry, construïm la secció a partir de la vista.
                // El `view_id` del fence és la font de veritat: així el bloc es
                // renderitza encara que la secció de pàgina s'hagi perdut.
                if (!section) {
                    let regView = (ctx.registry?.views || []).find(v => String(v.id) === String(viewId));
                    if (!regView) {
                        try {
                            const vr = await axios.get('/api/vault/views');
                            const allViews = Array.isArray(vr.data) ? vr.data : (vr.data?.views || []);
                            regView = allViews.find(v => String(v.id) === String(viewId));
                        } catch { /* registry inaccessible: caurà a l'error de sota */ }
                    }
                    if (regView) {
                        section = {
                            view_id: regView.id,
                            heading: headingProp || '',
                            source_table_id: regView.table_id,
                            view_type: regView.type || 'table',
                            filters: regView.filters || [],
                            sorts: regView.sorts || (regView.sort ? [regView.sort] : []),
                            visible_properties: regView.visibleProperties || regView.visible_properties || ['title'],
                        };
                    }
                }
                if (cancelled) return;
                if (!section) {
                    if (!cancelled) {
                        setView(null);
                        setRawRecords([]);
                        setTemplates([]);
                        setError(`Vista "${viewId.slice(0, 8)}..." no trobada al registry.`);
                        setLoading(false);
                    }
                    return;
                }
                if (!cancelled) setView(section);

                const tableId = section.source_table_id || section.table_id;
                if (!tableId) {
                    if (!cancelled) { setRawRecords([]); setTemplates([]); setLoading(false); }
                    return;
                }

                const cached = _byTableGet(tableId);
                let all = cached;
                if (!all) {
                    const pagesRes = await axios.get(`/api/vault/pages/by-table/${encodeURIComponent(tableId)}`);
                    all = Array.isArray(pagesRes.data) ? pagesRes.data : [];
                    _byTableSet(tableId, all);
                }

                // Separar plantilles (per al dropdown del botó "Nou") dels
                // registres a mostrar. Els templates mai no apareixen al cos
                // de la vista, fins i tot si passen els filtres.
                const tpls = all.filter(p => p.metadata?.is_template === true);
                const records = all.filter(p => !p.metadata?.is_template);

                // Vistes de la taula (per a les pestanyes i per al cardSize/
                // galleryPreview que en deriva embeddedView). Solen sortir de
                // ctx.registry, però just després de desar la config d'una vista
                // (viewSectionNonce ha canviat) aquest queda ranci —el desat toca
                // el backend, no ctx.registry—, així que rellegim les vistes
                // fresques perquè el canvi (mida/preview…) es vegi en viu.
                let registryViews = ctx.registry?.views || [];
                if (ctx.viewSectionNonce !== lastSavedNonceRef.current) {
                    lastSavedNonceRef.current = ctx.viewSectionNonce;
                    try {
                        const vr = await axios.get('/api/vault/views');
                        const fresh = Array.isArray(vr.data) ? vr.data : vr.data?.views;
                        if (Array.isArray(fresh)) registryViews = fresh;
                    } catch { /* fallback: ctx.registry */ }
                }

                if (!cancelled) {
                    setRawRecords(records);
                    setTemplates(tpls);
                    try {
                        const saved = JSON.parse(localStorage.getItem(`gnosi_embed_pinned_${pageId}_${viewId}`) || '[]');
                        setPinnedViewIds(new Set(saved));
                    } catch { /* noop */ }
                    // Garantim que la vista de la secció hi sigui sempre.
                    const tv = registryViews.filter(v => String(v.table_id) === String(tableId));
                    const sectionAsView = {
                        id: section.view_id,
                        name: section.heading || 'Vista',
                        type: section.view_type || 'table',
                        table_id: tableId,
                        filters: section.filters || [],
                        sorts: section.sorts || (section.sort ? [section.sort] : []),
                        visibleProperties: section.visible_properties || section.columns || ['title'],
                        // Opcions per tipus desades a la secció (ViewSection accepta
                        // camps extra); les preservem perquè embeddedView les llegeixi.
                        cardSize: section.cardSize,
                        galleryPreview: section.galleryPreview,
                        groupBy: section.groupBy || section.group_by,
                        dateField: section.dateField || section.date_field,
                        endDateField: section.endDateField || section.end_date_field,
                        // Opcions del gràfic (vista 'chart').
                        chartType: section.chartType || section.chart_type,
                        xField: section.xField || section.x_field,
                        yField: section.yField || section.y_field,
                        aggregation: section.aggregation,
                    };
                    const merged = tv.some(v => v.id === section.view_id) ? tv : [sectionAsView, ...tv];
                    setTableViews(merged);
                    // Recorda l'última pestanya seleccionada si encara existeix;
                    // si no, cau a la vista de la secció del bloc. La clau ha de
                    // ser ESTABLE entre recàrregues: `block.id` el regenera
                    // BlockNote a cada càrrega, però `pageId`+`view_id` de la
                    // secció es persisteixen al fence markdown.
                    let saved = '';
                    try { saved = localStorage.getItem(`gnosi_embed_view_${pageId}_${viewId}`) || ''; } catch { /* noop */ }
                    const def = (saved && merged.some(v => v.id === saved)) ? saved : section.view_id;
                    setActiveViewId(prev => prev || def);
                    setLoading(false);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e?.response?.data?.detail || e?.message || 'Error carregant la vista');
                    setRawRecords([]);
                    setTemplates([]);
                    setLoading(false);
                }
            }
        };
        void load();
        return () => { cancelled = true; };
        // `ctx.viewSectionNonce` s'incrementa quan es desa la config d'una vista
        // (BlockEditor): re-disparem la càrrega per llegir la secció actualitzada
        // (cardSize/galleryPreview/…), perquè editar només la mida no canvia
        // viewId/headingProp i el useEffect no es redispararia altrament.
    }, [viewId, pageId, headingProp, reloadKey, ctx.viewSectionNonce]);

    const tableId = view?.source_table_id || view?.table_id;

    // La vista EFECTIVA = la pestanya activa (de la taula) o, en defecte, la
    // secció del bloc. D'ella surten columnes, tipus, filtres i ordenació.
    const effectiveView = useMemo(() => {
        const fromTab = tableViews.find(v => v.id === activeViewId);
        return fromTab || view || null;
    }, [tableViews, activeViewId, view]);

    const columns = useMemo(
        () => effectiveView?.visibleProperties || effectiveView?.visible_properties || effectiveView?.columns || ['title'],
        [effectiveView],
    );
    const rawType = String(effectiveView?.view_type || effectiveView?.type || 'table').toLowerCase();
    const viewType = rawType === 'db_view' ? 'table' : rawType;
    // El títol/heading el porta la secció del bloc (no canvia amb la pestanya).
    const displayHeading = headingProp || view?.heading;
    const displayLevel = headingLevelProp || view?.heading_level || 1;

    // Files derivades: registres en cru filtrats per la vista efectiva (amb el
    // valor `this` → pageId) i ordenats. Reacciona en canviar de pestanya
    // sense refetch (mateixa taula).
    const allRows = useMemo(() => {
        const filters = (effectiveView?.filters && effectiveView.filters.length > 0)
            ? effectiveView.filters
            : (effectiveView?.filter ? [effectiveView.filter] : []);
        const filtered = rawRecords.filter(r => filters.every(f => applyFilter(r.metadata || {}, pageId, f)));
        const sorts = (effectiveView?.sorts && effectiveView.sorts.length > 0)
            ? effectiveView.sorts
            : (effectiveView?.sort ? [effectiveView.sort] : []);
        return multiKeySort(filtered, sorts);
    }, [rawRecords, effectiveView, pageId]);

    // Cerca local sobre el conjunt de registres. Cerca al títol i a la
    // representació textual de cada columna visible.
    const rows = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        if (!q) return allRows;
        return allRows.filter(r => {
            if ((r.title || '').toLowerCase().includes(q)) return true;
            return (columns || []).some(c => {
                const v = r.metadata?.[c];
                if (v == null) return false;
                const s = Array.isArray(v) ? v.join(' ') : String(v);
                return s.toLowerCase().includes(q);
            });
        });
    }, [allRows, searchTerm, columns]);

    const handleCreate = useCallback(async (extra = {}, template = null) => {
        if (!tableId) return;
        try {
            const baseMeta = template?.metadata || {};
            const title = template ? `Nou (${template.title || 'plantilla'})` : 'Nou registre';
            const created = await createPageInTable({
                tableId,
                title,
                extraMetadata: {
                    ...baseMeta,
                    is_template: false,
                    ...extra,
                },
            });
            const newId = created?.id;
            reload();
            if (newId) onOpenPage?.(newId);
        } catch (e) {
            console.warn('createPageInTable failed', e);
        }
    }, [tableId, onOpenPage, reload]);

    const handleMove = useCallback(async (pageId_, field, value) => {
        await patchPageMetadata(pageId_, { [field]: value });
        _byTableCache.delete(tableId);
    }, [tableId]);

    const handleChangeGroupBy = useCallback(async (newGroupBy) => {
        if (!view || !pageId) return;
        const next = await patchSectionConfig(pageId, view, { group_by: newGroupBy });
        setView(next);
    }, [view, pageId]);

    const handleOpenConfig = useCallback(() => {
        if (!onOpenPageViewModal || !tableId) return;
        const sectionVid = block?.props?.view_id || '';
        if (!activeViewId || activeViewId === sectionVid) {
            // La pestanya activa és la vista de la secció → config del bloc tal qual.
            onOpenPageViewModal(tableId, block);
        } else {
            // Config de la vista de la pestanya ACTIVA: passem un editingBlock
            // sintètic amb el seu view_id. En desar, PageViewModal actualitza
            // aquesta vista i re-ancora la secció del bloc a ella (el bloc passa
            // a mostrar la vista que has configurat).
            onOpenPageViewModal(tableId, {
                id: block?.id,
                props: { view_id: activeViewId, heading: headingProp || '', heading_level: headingLevelProp || 1 },
            });
        }
    }, [onOpenPageViewModal, tableId, block, activeViewId, headingProp, headingLevelProp]);

    // --- FASE 3: CRUD de les pestanyes de vistes (registry.views) ---
    const refetchTableViews = useCallback(async () => {
        try {
            const res = await axios.get('/api/vault/views');
            const all = Array.isArray(res.data) ? res.data : (res.data?.views || []);
            setTableViews(all.filter(v => String(v.table_id) === String(tableId)));
        } catch { /* conserva l'estat actual */ }
    }, [tableId]);

    const pinView = useCallback((id) => {
        if (!id || id === viewId) return;
        setPinnedViewIds(prev => { const next = new Set(prev); next.add(id); persistPinned(next); return next; });
    }, [viewId, pageId]);

    const handleAddView = useCallback((type = 'table') => {
        if (!tableId || !onOpenViewConfig) return;
        onOpenViewConfig({ type: type, name: '' }, (savedView) => {
            if (savedView?.id) {
                pinView(savedView.id);
                setActiveViewId(savedView.id);
            }
        });
    }, [tableId, onOpenViewConfig, pinView]);

    // Afegeix a aquest bloc una vista que JA existeix a la taula (la fixa com a
    // pestanya). No crea res nou.
    const handleAddExistingView = useCallback((v) => {
        if (!v?.id) return;
        pinView(v.id);
        setActiveViewId(v.id);
    }, [pinView]);

    const handleDeleteView = useCallback((v) => {
        if (!v?.id) return;
        if (tableViews.length <= 1) { toast.error('No es pot eliminar l\'única vista.'); return; }
        setConfirmDeleteView(v);
    }, [tableViews]);

    const doDeleteView = useCallback(async () => {
        const v = confirmDeleteView;
        setConfirmDeleteView(null);
        if (!v?.id) return;
        try {
            await axios.delete(`/api/vault/views/${encodeURIComponent(v.id)}`);
            await refetchTableViews();
            if (activeViewId === v.id) setActiveViewId(view?.view_id || '');
        } catch (e) { console.warn('delete view failed', e); }
    }, [confirmDeleteView, activeViewId, view, refetchTableViews]);

    // Treu la vista d'aquest bloc (la "desfixa"); NO l'elimina del registry.
    // La vista de la secció (àncora) no es pot treure.
    const handleUnpinView = useCallback((v) => {
        if (!v?.id || v.id === viewId) return;
        setPinnedViewIds(prev => { const next = new Set(prev); next.delete(v.id); persistPinned(next); return next; });
        if (activeViewId === v.id) setActiveViewId(viewId);
    }, [viewId, pageId, activeViewId]);

    const handleRenameView = useCallback((v) => {
        if (!v?.id) return;
        setRenameView(v);
    }, []);

    const doRename = useCallback(async (name) => {
        const v = renameView;
        setRenameView(null);
        if (!v?.id) return;
        if (!name || name === (v.name || v.heading)) return;
        try {
            await axios.put(`/api/vault/views/${encodeURIComponent(v.id)}`, { ...v, name });
            await refetchTableViews();
        } catch (e) { console.warn('rename view failed', e); }
    }, [renameView, refetchTableViews]);

    // Configura una vista CONCRETA (la del menú "...", no necessàriament l'activa).
    // Mateixa lògica que handleOpenConfig però parametritzada per `v`: si és la
    // vista de la secció, obre el bloc tal qual; si no, passa un editingBlock
    // sintètic amb el seu view_id (en desar, re-ancora la secció a aquesta vista).
    const handleConfigureView = useCallback((v) => {
        if (!onOpenPageViewModal || !tableId) return;
        const sectionVid = block?.props?.view_id || '';
        if (!v?.id || v.id === sectionVid) {
            onOpenPageViewModal(tableId, block);
        } else {
            onOpenPageViewModal(tableId, {
                id: block?.id,
                props: { view_id: v.id, heading: headingProp || '', heading_level: headingLevelProp || 1 },
            });
        }
    }, [onOpenPageViewModal, tableId, block, headingProp, headingLevelProp]);

    // Duplica una vista al registry (nova vista amb els mateixos filtres/ordre/
    // columnes) i la fixa com a pestanya d'aquest bloc.
    const handleDuplicateView = useCallback(async (v) => {
        if (!v?.id || !tableId) return;
        try {
            const res = await axios.post('/api/vault/views', {
                table_id: tableId,
                name: `${v.name || v.heading || 'Vista'} (còpia)`,
                type: v.type || 'table',
                filters: v.filters || [],
                sorts: v.sorts || (v.sort ? [v.sort] : []),
                visibleProperties: v.visibleProperties || columns || ['title'],
                // Neix per ser pestanya d'aquest bloc, no del tauler
                // (isPageEmbedView la filtra de les pestanyes de taula).
                embedded: true,
            });
            await refetchTableViews();
            if (res.data?.id) { pinView(res.data.id); setActiveViewId(res.data.id); }
        } catch (e) { console.warn('duplicate view failed', e); }
    }, [tableId, columns, refetchTableViews, pinView]);

    // Pont editor↔vista: registra aquesta vista al context per `block.id` perquè
    // l'editor hi pugui entrar amb el teclat. L'API real (focusFirstCell/Last)
    // la proporciona la VaultTable via `registerNavApi` → tableNavApiRef.
    useEffect(() => {
        if (!ctx.registerEmbedNav || !block?.id) return undefined;
        // Fallback quan la vista no és una taula/llista navegable (feed,
        // galeria, kanban, timeline…): enfoquem la closca de l'embed perquè
        // l'usuari vegi que hi és i pugui sortir-ne amb ↑/↓/Esc. Abans
        // retornàvem `false` i el cursor queia en un bloc void sense caret
        // visible ni sortida → semblava que la navegació no hi arribés.
        const focusShell = () => {
            const el = embedContainerRef.current;
            if (!el) return false;
            try { el.focus({ preventScroll: false }); el.scrollIntoView({ block: 'nearest' }); } catch { /* noop */ }
            return true;
        };
        ctx.registerEmbedNav(block.id, {
            // Taula/llista → primera/última cel·la. La resta de vistes →
            // closca (focusShell). Tornen sempre `true` (l'editor considera
            // la vista "entrada" i no deixa passar la fletxa a ProseMirror).
            focusFirstCell: () => {
                const r = tableNavApiRef.current?.focusFirstCell?.();
                return (r !== undefined && r !== false) ? true : focusShell();
            },
            focusLastCell: () => {
                const r = tableNavApiRef.current?.focusLastCell?.();
                return (r !== undefined && r !== false) ? true : focusShell();
            },
        });
        return () => ctx.registerEmbedNav(block.id, null);
    }, [ctx, block?.id]);

    // --- FASE 1: taula completa EDITABLE dins l'embed reutilitzant VaultTable ---
    // DEFINITS ABANS dels returns primerencs (loading/error) per no violar les
    // Rules of Hooks. La taula i l'esquema surten del registry del context.
    const table = (ctx.registry?.tables || ctx.allTables || []).find(t => String(t.id) === String(tableId)) || null;
    const embeddedSchema = useMemo(
        () => buildSchemaFromTableProperties(table?.properties || []),
        [table],
    );
    // La secció embeguda → model de "vista" que espera VaultTable. Els filtres
    // (incloent `this` → pageId) i l'ordenació JA s'apliquen a `rows`, així que
    // no els tornem a passar com a filtres (VaultTable no sap resoldre `this`);
    // l'edició de filtres/ordenació es delega al modal de configuració de
    // l'embed (onEditSchema('filters'|'sorts') → handleOpenConfig).
    const embeddedView = useMemo(() => ({
        id: effectiveView?.id || effectiveView?.view_id || 'embedded',
        name: effectiveView?.name || effectiveView?.heading || 'Vista',
        type: viewType === 'list' ? 'list' : 'table',
        filters: [],
        sort: (effectiveView?.sorts && effectiveView.sorts.length) ? effectiveView.sorts : (effectiveView?.sort ? [effectiveView.sort] : []),
        visibleProperties: columns,
        // Reflecteix el senyal real: si la pestanya activa és la vista PRINCIPAL,
        // la taula mostra tot l'esquema viu; si no, respecta visibleProperties.
        is_main: !!(effectiveView?.is_main || effectiveView?.is_default),
        // Opcions específiques per tipus (galeria/kanban/calendari/timeline). En
        // incrustar es perdien; les propaguem des de la vista efectiva (registry
        // o secció) perquè el render les honori igual que a la pàgina de taula.
        cardSize: effectiveView?.cardSize,
        galleryPreview: effectiveView?.galleryPreview,
        groupBy: effectiveView?.groupBy || effectiveView?.group_by,
        dateField: effectiveView?.dateField || effectiveView?.date_field,
        endDateField: effectiveView?.endDateField || effectiveView?.end_date_field,
        // Opcions del gràfic (vista 'chart' incrustada).
        chartType: effectiveView?.chartType || effectiveView?.chart_type,
        xField: effectiveView?.xField || effectiveView?.x_field,
        yField: effectiveView?.yField || effectiveView?.y_field,
        aggregation: effectiveView?.aggregation,
    }), [effectiveView, viewType, columns]);

    if (loading) {
        return (
            <div className="my-4 p-4 flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                <Loader2 size={14} className="animate-spin" />
                Carregant vista...
            </div>
        );
    }

    if (error) {
        return (
            <div className="my-4 p-3 bg-[var(--status-error)]/5 border border-[var(--status-error)]/20 rounded-lg flex items-start gap-2.5">
                <AlertCircle size={16} className="text-[var(--status-error)] mt-0.5 shrink-0" />
                <div className="text-xs text-[var(--status-error)]">{error}</div>
            </div>
        );
    }

    const commonProps = { rows, columns, view, onOpenPage, onCreate: tableId ? handleCreate : null, blockId: block?.id };

    // Adaptadors de callbacks compartits per TOTS els components de vista reals
    // (taula/llista/kanban/galeria/timeline/feed/calendari).
    const onEditSchemaAdapter = (type) => {
        if (type === 'filters' || type === 'sorts') handleOpenConfig();
        else if (ctx.onEditSchema && table) ctx.onEditSchema(table);
    };
    const onCreateRecordAdapter = (templateId) => {
        const tpl = templates.find(t => t.id === templateId) || null;
        handleCreate({}, tpl);
    };
    // Notifiquem VaultDashboard dels ids esborrats perquè els registri a la
    // seva pila d'undo (el Cmd+Z global hi viu). El soft-delete de la vista
    // incrustada va per axios directe i, sense aquest senyal, no era desfàble.
    const announceDeleted = (ids) => {
        const clean = [...(ids || [])].filter(Boolean);
        if (!clean.length) return;
        window.dispatchEvent(new CustomEvent('gnosi:records-deleted', { detail: { ids: clean } }));
    };
    const onDeletePageAdapter = (id, title) => { ctx.onDeletePage?.(id, title); if (id) announceDeleted([id]); setTimeout(reload, 400); };
    const onDeleteSelectedAdapter = (ids) => {
        Promise.allSettled([...ids].map(id => axios.delete(`/api/vault/pages/${encodeURIComponent(id)}`)))
            .then((results) => {
                const ok = [...ids].filter((_, i) => results[i]?.status === 'fulfilled'
                    || results[i]?.reason?.response?.status === 404);
                announceDeleted(ok);
                reload();
            });
    };
    const onUpdateViewAdapter = async (nextView) => {
        if (!pageId) return;
        const sorts = Array.isArray(nextView?.sort) ? nextView.sort : (nextView?.sort ? [nextView.sort] : []);
        const isSection = !view ? false : (activeViewId === view.view_id);
        if (isSection || !activeViewId) {
            // La pestanya activa és la secció del bloc → patch a la secció.
            const next = await patchSectionConfig(pageId, view, {
                visible_properties: nextView?.visibleProperties || columns,
                sorts,
                sort: sorts[0] || null,
                group_by: nextView?.group_by ?? view?.group_by,
            });
            setView(next);
        } else {
            // Pestanya d'una vista del registry → PUT directe a /api/vault/views.
            const current = tableViews.find(v => v.id === activeViewId) || {};
            try {
                await axios.put(`/api/vault/views/${encodeURIComponent(activeViewId)}`, {
                    ...current,
                    visibleProperties: nextView?.visibleProperties || columns,
                    sorts,
                    sort: sorts[0] || null,
                });
                await refetchTableViews();
            } catch (e) { console.warn('update view failed', e); }
        }
    };
    const onUpdateNoteAdapter = async (id, patch) => {
        await patchPageMetadata(id, patch?.metadata || patch || {});
        reload();
    };
    // Props comunes als components rics que comparteixen la mateixa signatura.
    const sharedViewProps = {
        notes: rows,
        schema: embeddedSchema,
        idToTitle: ctx.idToTitle || {},
        allNotes: allRows,
        activeView: embeddedView,
        // Cap màxim de l'alçada de la taula/llista incrustada: per sota creix amb
        // el contingut (sense buit); per sobre fa scroll intern.
        maxHeight: '70vh',
        searchTerm,
        onSearchChange: setSearchTerm,
        onNoteSelect: (id) => onOpenPage?.(id),
        onCreateRecord: onCreateRecordAdapter,
        onDeletePage: onDeletePageAdapter,
        onDeleteSelected: onDeleteSelectedAdapter,
        onEditSchema: onEditSchemaAdapter,
        onUpdateView: onUpdateViewAdapter,
        // Pont de navegació de teclat editor↔taula (només taula/llista el fan
        // servir; la resta de tipus l'ignoren).
        registerNavApi: (api) => { tableNavApiRef.current = api; },
        onExitTop: () => ctx.exitEmbedToEditor?.(block?.id, 'up'),
        onExitBottom: () => ctx.exitEmbedToEditor?.(block?.id, 'down'),
        onEscape: () => ctx.exitEmbedToEditor?.(block?.id, 'escape'),
    };
    const renderBody = () => {
        // El `graph` no té component editable equivalent → render bespoke.
        if (viewType === 'graph') return <GraphRender {...commonProps} />;
        // La resta de tipus es deleguen al cos compartit (VaultViewBody), el
        // mateix que fa servir la taula completa. La taula/llista usen un
        // contenidor que la deixa fer l'scroll intern (columna sticky); la
        // resta, una caixa amb scroll propi.
        const Box = (viewType === 'table' || viewType === 'list') ? TableBox
            : (viewType === 'feed') ? FeedFlowBox
            : ScrollBox;
        return (
            <Box>
                <VaultViewBody
                    type={viewType}
                    {...sharedViewProps}
                    templates={templates}
                    isEmbedded={true}
                    onOpenParallel={ctx.onOpenParallel}
                    onCellSaved={() => reload()}
                    onTranslated={() => reload()}
                    onUpdateFieldOptions={ctx.onAddSchemaOption}
                    onUpdateNote={onUpdateNoteAdapter}
                    actionRules={table?.action_rules}
                />
            </Box>
        );
    };

    return (
        // `min-w-0 w-full`: el contenidor del bloc (.bn-block-content) és flex;
        // sense `min-w-0` aquest div no encongeix sota l'amplada del contingut
        // (taula ampla) i desborda l'editor amb scroll horitzontal a la pàgina.
        <div
            ref={embedContainerRef}
            tabIndex={isInEditor ? -1 : undefined}
            onKeyDown={isInEditor ? handleShellKeyDown : undefined}
            className="mt-0 mb-4 min-w-0 w-full gnosi-view-embed-container rounded-lg outline-none focus:outline-none focus:ring-2 focus:ring-[var(--gnosi-primary)]/40"
        >
            <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-baseline gap-2 min-w-0">
                    {displayHeading && <Heading level={displayLevel}>{displayHeading}</Heading>}
                    <span className="text-[11px] text-[var(--text-tertiary)] font-medium whitespace-nowrap">
                        {rows.length} {rows.length === 1 ? 'registre' : 'registres'}
                    </span>
                </div>
                <ViewActionsBar
                    onCreate={tableId ? handleCreate : null}
                    templates={templates}
                    onOpenConfig={onOpenPageViewModal && tableId ? handleOpenConfig : null}
                    searchTerm={searchTerm}
                    setSearchTerm={setSearchTerm}
                    showSearch={showSearch}
                    setShowSearch={setShowSearch}
                />
            </div>
            {/* Pestanyes de vistes D'AQUEST bloc: la vista de la secció (àncora)
                + les que s'hi han fixat explícitament. No es mostren totes les
                vistes de la taula. La barra fa `flex-wrap` (no `overflow`) per
                no retallar els desplegables de la × i del +. */}
            {(() => {
                const visibleTabs = tableViews.filter(v => v.id === viewId || pinnedViewIds.has(v.id));
                const unpinnedExisting = tableViews.filter(v => v.id !== viewId && !pinnedViewIds.has(v.id));
                if (visibleTabs.length === 0) return null;
                return (
                <div className="relative z-30 flex flex-wrap items-center gap-0.5 border-b border-[var(--border-primary)] mb-2">
                    {visibleTabs.map(v => {
                        const isActive = v.id === activeViewId;
                        const isAnchor = v.id === viewId; // vista de la secció (no es pot treure)
                        return (
                            <div
                                key={v.id}
                                className={`group relative flex items-center gap-1 px-2.5 py-1 text-xs whitespace-nowrap border-b-2 cursor-pointer ${isActive ? 'border-[var(--gnosi-primary)] text-[var(--gnosi-primary)] font-semibold' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                                onClick={() => {
                                    setActiveViewId(v.id);
                                    try { localStorage.setItem(`gnosi_embed_view_${pageId}_${viewId}`, v.id); } catch { /* noop */ }
                                }}
                                onDoubleClick={() => handleRenameView(v)}
                                title="Clic per canviar · doble clic per renombrar"
                            >
                                <span>{v.name || v.heading || 'Vista'}</span>
                                <button
                                    onClick={(e) => { e.stopPropagation(); decideMenuDir(e); setTabMenuFor(m => m === v.id ? null : v.id); }}
                                    className={`${tabMenuFor === v.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} text-[var(--text-tertiary)] hover:text-[var(--text-primary)]`}
                                    title="Opcions de la vista"
                                >
                                    <MoreHorizontal size={13} />
                                </button>
                                {tabMenuFor === v.id && (
                                    <>
                                        <div className="fixed inset-0 z-[55]" onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); }} />
                                        <div className={`absolute z-[60] left-0 ${menuUp ? "bottom-full mb-1" : "top-full mt-1"} w-56 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg py-1 text-[var(--text-primary)] font-normal`}>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleConfigureView(v); }}
                                                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                            >
                                                <Settings size={13} className="text-[var(--text-tertiary)]" />
                                                Configurar
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleRenameView(v); }}
                                                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                            >
                                                <Edit2 size={13} className="text-[var(--text-tertiary)]" />
                                                Reanomenar
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleDuplicateView(v); }}
                                                className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                            >
                                                <Copy size={13} className="text-[var(--text-tertiary)]" />
                                                Duplicar
                                            </button>
                                            {!isAnchor && (
                                                <>
                                                    <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleUnpinView(v); }}
                                                        className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]"
                                                    >
                                                        <X size={13} className="text-[var(--text-tertiary)]" />
                                                        Treure d'aquesta pàgina
                                                    </button>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setTabMenuFor(null); handleDeleteView(v); }}
                                                        className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-red-500 hover:bg-[var(--bg-tertiary)]"
                                                    >
                                                        <Trash2 size={13} />
                                                        Eliminar a tot arreu…
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })}
                    <button
                        onClick={() => handleAddView('table')}
                        className="px-1.5 py-1 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
                        title="Afegir vista"
                    >
                        <Plus size={13} />
                    </button>
                </div>
                );
            })()}
            {renderBody()}
            <ConfirmModal
                isOpen={confirmDeleteView != null}
                onClose={() => setConfirmDeleteView(null)}
                onConfirm={doDeleteView}
                title="Eliminar vista"
                message={confirmDeleteView ? `Eliminar la vista "${confirmDeleteView.name || confirmDeleteView.heading || ''}" a TOT arreu? Desapareixerà de totes les pàgines.` : ''}
                confirmText="Eliminar"
                cancelText="Cancel·la"
                isDestructive
            />
            <PromptModal
                isOpen={renameView != null}
                onClose={() => setRenameView(null)}
                onSubmit={doRename}
                title="Reanomenar vista"
                label="Nou nom de la vista"
                defaultValue={renameView ? (renameView.name || renameView.heading || '') : ''}
                confirmText="Reanomena"
                cancelText="Cancel·la"
            />
        </div>
    );
}
