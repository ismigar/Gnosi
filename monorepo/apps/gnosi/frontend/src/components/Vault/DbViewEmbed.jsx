import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Loader2, AlertCircle, Plus, Search, SlidersHorizontal, ChevronDown, X, LayoutTemplate } from 'lucide-react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { VaultEditorContext } from './VaultEditorContext';
import { WikilinkInline } from './WikilinkInline';

// Substitueix `[[target]]`, `[[target|alias]]`, `[[target#section]]` i
// `[[target#section|alias]]` per un link markdown amb un sentinel a l'href.
// El renderer de l'element `a` reconeix el sentinel i renderitza un
// `WikilinkInline` real (mateix component que fa servir l'editor), de
// manera que la cel·la del feed té wikilinks clicables com a la pàgina.
// Sense això el ReactMarkdown deixa els claudàtors com a text pla.
//
// El sentinel NO pot dur `__` (markdown-it ho interpreta com a bold i
// trenca la URL dins `](...)`) i ha de passar el `urlTransform` de
// react-markdown: per defecte sanititza protocols desconeguts a `""`,
// cosa que deixava `<a href="">` → clic obria una pestanya nova a
// l'origin. Per això, a part del sentinel sense `__`, registrem un
// `urlTransform` que el deixa passar intacte (vegeu `wikilinkUrlTransform`).
const WIKILINK_HREF_SENTINEL = 'gnosi-wikilink:';
const WIKILINK_RE = /\[\[([^\][|#]+)(?:#([^\][|]+))?(?:\|([^\][]+))?\]\]/g;
const convertWikilinksToMd = (md) => {
    if (!md || typeof md !== 'string') return md;
    return md.replace(WIKILINK_RE, (_, target, section, alias) => {
        const fullTarget = (target || '').trim() + (section ? `#${section.trim()}` : '');
        const displayTitle = (alias || (section ? `${target}#${section}` : target) || '').trim();
        // Evitem `[`/`]` al text del link i `(` `)` a l'href perquè no
        // trenquin la sintaxi markdown del link.
        const safeTitle = displayTitle.replace(/[\][]/g, '');
        const safeHref = encodeURIComponent(fullTarget);
        return `[${safeTitle}](${WIKILINK_HREF_SENTINEL}${safeHref})`;
    });
};

// react-markdown sanititza per defecte qualsevol href amb un protocol que
// no reconeix (el nostre `gnosi-wikilink:` inclòs) substituint-lo per `""`.
// Aquest transform deixa passar el sentinel intacte i delega la resta al
// comportament per defecte.
const wikilinkUrlTransform = (url) => (
    typeof url === 'string' && url.startsWith(WIKILINK_HREF_SENTINEL)
        ? url
        : defaultUrlTransform(url)
);

/* -------------------------------------------------------------------------- */
/*  Utilitats de filtre / ordenació / format                                  */
/* -------------------------------------------------------------------------- */

function applyFilter(meta, pageId, f) {
    if (!f?.field) return true;
    const op = (f.operator || 'equals').toLowerCase();
    const raw = f.value === 'this' ? pageId : f.value;
    const target = raw == null ? null : String(raw);
    const v = meta?.[f.field];
    const arr = Array.isArray(v) ? v.map(String) : v == null || v === '' ? [] : [String(v)];
    if (op === 'is_empty') return arr.length === 0;
    if (op === 'is_not_empty') return arr.length > 0;
    if (target == null) return true;
    if (op === 'equals') return arr.includes(target);
    if (op === 'not_equals') return !arr.includes(target);
    if (op === 'contains') return arr.some(x => x.includes(target));
    if (op === 'not_contains') return !arr.some(x => x.includes(target));
    if (op === 'greater_than' || op === 'less_than') {
        const t = Number(target);
        if (Number.isNaN(t)) return false;
        return arr.some(x => {
            const n = Number(x);
            if (Number.isNaN(n)) return false;
            return op === 'greater_than' ? n > t : n < t;
        });
    }
    return true;
}

function multiKeySort(rows, sorts) {
    if (!sorts || sorts.length === 0) {
        return [...rows].sort((a, b) =>
            String(a.title || '').toLowerCase().localeCompare(String(b.title || '').toLowerCase())
        );
    }
    const result = [...rows];
    for (let i = sorts.length - 1; i >= 0; i--) {
        const { field, direction = 'asc' } = sorts[i];
        if (!field) continue;
        const factor = direction === 'desc' ? -1 : 1;
        result.sort((a, b) => {
            const av = String(a.metadata?.[field] ?? '').toLowerCase();
            const bv = String(b.metadata?.[field] ?? '').toLowerCase();
            return av.localeCompare(bv) * factor;
        });
    }
    return result;
}

function displayValue(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
}

function pickDateCol(columns, rows) {
    const byName = (columns || []).find(c => /(data|date|fecha|created|day)/i.test(c));
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

function normalizeAssetUrl(url) {
    if (typeof url !== 'string') return '';
    const v = url.trim();
    if (!v) return '';
    if (v.startsWith('http') || v.startsWith('/')) return v;
    if (v.startsWith('Assets/')) return `/api/vault/assets/${v.substring(7)}`;
    return `/api/vault/assets/${v}`;
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
    // GET actual per obtenir title+content+metadata complets, després PATCH
    // amb les claus modificades. El backend espera tot el bloc per a un PATCH
    // robust (no permet partials en algunes versions).
    const cur = await axios.get(`/api/vault/pages/${encodeURIComponent(pageId)}`);
    const merged = {
        title: cur.data?.title || '',
        content: cur.data?.content || '',
        metadata: { ...(cur.data?.metadata || {}), ...partialMetadata },
    };
    await axios.patch(`/api/vault/pages/${encodeURIComponent(pageId)}`, merged);
    return merged.metadata;
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
/*  Imatges del feed (amb retry per OneDrive Errno 35 → 503)                  */
/* -------------------------------------------------------------------------- */

function RetryableImage({ src, title, onClick }) {
    const [attempt, setAttempt] = useState(0);
    const [hidden, setHidden] = useState(false);
    if (hidden) return null;
    return (
        <button onClick={onClick} className="block w-full" title={title}>
            <img
                key={attempt}
                src={src}
                alt=""
                loading="lazy"
                className="w-full h-auto rounded-md border border-[var(--border-primary)]/40 bg-[var(--bg-secondary)]"
                onError={() => {
                    if (attempt < 3) {
                        const delay = 500 * Math.pow(2, attempt);
                        setTimeout(() => setAttempt(a => a + 1), delay);
                    } else {
                        setHidden(true);
                    }
                }}
            />
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
const BY_TABLE_TTL_MS = 30_000;
function _byTableGet(tableId) {
    const e = _byTableCache.get(tableId);
    if (!e) return null;
    if (Date.now() - e.ts > BY_TABLE_TTL_MS) { _byTableCache.delete(tableId); return null; }
    return e.value;
}
function _byTableSet(tableId, value) { _byTableCache.set(tableId, { ts: Date.now(), value }); }

/* -------------------------------------------------------------------------- */
/*  Renderers                                                                 */
/* -------------------------------------------------------------------------- */

function TableRender({ rows, columns, onOpenPage }) {
    if (rows.length === 0) {
        return (
            <div className="my-2 p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30">
                <p className="text-xs text-[var(--text-tertiary)] italic">Cap fila.</p>
            </div>
        );
    }
    return (
        <div className="my-2">
            <div className="overflow-x-auto rounded-lg border border-[var(--border-primary)]">
                <table className="w-full text-sm">
                    <thead className="bg-[var(--bg-secondary)]"><tr>
                        {columns.map(c => (
                            <th key={c} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                                {c === 'title' ? 'Títol' : c}
                            </th>
                        ))}
                    </tr></thead>
                    <tbody>
                        {rows.map((r, idx) => (
                            <tr key={r.id || idx} className="border-t border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]/40">
                                {columns.map((c, ci) => {
                                    const val = c === 'title' ? r.title : r.metadata?.[c];
                                    const text = displayValue(val);
                                    return (
                                        <td key={c} className="px-3 py-2 text-[var(--text-primary)]">
                                            {ci === 0 ? (
                                                <button
                                                    className="text-left text-[var(--gnosi-primary)] hover:underline"
                                                    onClick={() => r.id && onOpenPage?.(r.id)}
                                                >
                                                    {text || '(sense títol)'}
                                                </button>
                                            ) : text}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function ListRender({ rows, onOpenPage }) {
    return (
        <div className="my-2">
            {rows.length === 0
                ? <p className="text-xs text-[var(--text-tertiary)] italic px-2">Cap fila.</p>
                : (
                    <ul className="space-y-1">
                        {rows.map(r => (
                            <li key={r.id} className="text-sm">
                                <button onClick={() => onOpenPage?.(r.id)} className="text-[var(--gnosi-primary)] hover:underline">
                                    {r.title || '(sense títol)'}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
        </div>
    );
}

function GalleryRender({ rows, columns, onOpenPage }) {
    const subtitleCol = (columns || []).find(c => c !== 'title');
    return (
        <div className="my-2">
            {rows.length === 0
                ? <p className="text-xs text-[var(--text-tertiary)] italic px-2">Cap fila.</p>
                : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {rows.map(r => {
                            const subtitle = subtitleCol ? displayValue(r.metadata?.[subtitleCol]) : '';
                            return (
                                <button
                                    key={r.id}
                                    onClick={() => onOpenPage?.(r.id)}
                                    className="text-left p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 hover:border-[var(--gnosi-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                                >
                                    <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                                        {r.title || '(sense títol)'}
                                    </div>
                                    {subtitle && (
                                        <div className="text-xs text-[var(--text-secondary)] mt-1 truncate">{subtitle}</div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
        </div>
    );
}

/* ----------------------------- Feed ---------------------------------------- */

function FeedItem({ row, columns, dateCol, onOpenPage }) {
    const cached = _cacheGet(row.id);
    const [bodyMd, setBodyMd] = useState(cached ? cached.bodyMd : '');
    const [images, setImages] = useState(cached ? cached.images : []);
    const [hydrated, setHydrated] = useState(!!cached);
    const articleRef = useRef(null);

    useEffect(() => {
        if (hydrated) return undefined;
        const el = articleRef.current;
        if (!el) return undefined;
        let cancelled = false;
        const fetchPreview = async () => {
            try {
                const res = await axios.get(`/api/vault/pages/${encodeURIComponent(row.id)}/preview?full=true`);
                if (cancelled) return;
                const d = res?.data || {};
                const md = String(d.body_md || d.excerpt || '');
                const list = Array.isArray(d.images) ? d.images : [];
                const cover = d.cover || row.metadata?.cover || '';
                const norm = list.map(normalizeAssetUrl).filter(Boolean);
                if (cover) {
                    const c = normalizeAssetUrl(cover);
                    if (c && !norm.includes(c)) norm.unshift(c);
                }
                // No cachejar resultats buits: el backend pot haver retornat 200
                // amb body_md i images buits durant una degradació transitòria
                // d'OneDrive (Errno 35). Sense aquest guard, el feed quedaria
                // permanentment sense imatges fins a recarregar la pestanya.
                if (md || norm.length > 0) {
                    _cacheSet(row.id, { bodyMd: md, images: norm });
                }
                setBodyMd(md);
                setImages(norm);
                setHydrated(true);
            } catch { /* no crític */ }
        };
        if (typeof IntersectionObserver === 'undefined') {
            void fetchPreview();
            return () => { cancelled = true; };
        }
        const io = new IntersectionObserver(entries => {
            for (const e of entries) {
                if (e.isIntersecting) {
                    io.disconnect();
                    void fetchPreview();
                    break;
                }
            }
        }, { rootMargin: '200px' });
        io.observe(el);
        return () => { cancelled = true; io.disconnect(); };
    }, [row.id, row.metadata, hydrated]);

    const date = dateCol ? row.metadata?.[dateCol] : '';
    const dateStr = Array.isArray(date) ? date[0] : date;
    const skip = new Set([dateCol, 'title']);
    const pills = (columns || []).filter(c => !skip.has(c)).map(c => {
        const v = row.metadata?.[c];
        if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return null;
        return { col: c, display: Array.isArray(v) ? v.join(', ') : String(v) };
    }).filter(Boolean);

    return (
        <article ref={articleRef} className="py-3 border-b border-[var(--border-primary)]/40 last:border-b-0">
            {dateStr && (
                <div className="text-[10px] font-bold uppercase text-[var(--text-tertiary)] tracking-wider mb-1">
                    {String(dateStr).slice(0, 10)}
                </div>
            )}
            <button
                onClick={() => onOpenPage?.(row.id)}
                className="text-xl font-bold text-[var(--text-primary)] hover:text-[var(--gnosi-primary)] text-left block"
            >
                {row.title || '(sense títol)'}
            </button>
            {pills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {pills.map(p => (
                        <span
                            key={p.col}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)]/40"
                            title={p.col}
                        >
                            <span className="text-[var(--text-tertiary)] mr-1">{p.col}:</span>
                            {p.display}
                        </span>
                    ))}
                </div>
            )}
            {bodyMd && (
                <div className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed feed-md">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        urlTransform={wikilinkUrlTransform}
                        components={{
                            // Imatges inline: normalitzem la URL (Assets/...
                            // → /api/vault/assets/...) i fem servir
                            // RetryableImage perquè OneDrive a vegades
                            // retorna 503 fins que té el fitxer descarregat.
                            img: ({ src = '', alt = '' }) => {
                                const norm = normalizeAssetUrl(String(src || ''));
                                if (!norm) return null;
                                return <RetryableImage src={norm} title={alt || row.title || ''} onClick={() => onOpenPage?.(row.id)} />;
                            },
                            h1: (props) => <h1 className="font-bold text-2xl text-[var(--text-primary)] my-2" {...props} />,
                            h2: (props) => <h2 className="font-bold text-xl text-[var(--text-primary)] my-2" {...props} />,
                            h3: (props) => <h3 className="font-semibold text-lg text-[var(--text-primary)] my-2" {...props} />,
                            ul: (props) => <ul className="list-disc pl-5 my-2" {...props} />,
                            ol: (props) => <ol className="list-decimal pl-5 my-2" {...props} />,
                            blockquote: (props) => <blockquote className="pl-3 italic text-[var(--text-tertiary)] my-2" {...props} />,
                            // Si l'href porta el nostre sentinel de wikilink,
                            // renderitzem el component real (clicable, amb
                            // hover preview, context menu, etc.) en lloc d'un
                            // anchor opac. La preconversió de `[[…]]` a
                            // `[text](sentinel:target)` ja s'ha fet sobre
                            // `bodyMd` abans del parse.
                            a: ({ href = '', children, ...rest }) => {
                                if (typeof href === 'string' && href.startsWith(WIKILINK_HREF_SENTINEL)) {
                                    let target;
                                    try { target = decodeURIComponent(href.slice(WIKILINK_HREF_SENTINEL.length)); }
                                    catch { target = href.slice(WIKILINK_HREF_SENTINEL.length); }
                                    const text = React.Children.toArray(children)
                                        .map(c => (typeof c === 'string' ? c : (c?.props?.children || '')))
                                        .join('') || target;
                                    return <WikilinkInline title={text} target={target} />;
                                }
                                return <a href={href} className="text-[var(--gnosi-primary)] hover:underline" {...rest}>{children}</a>;
                            },
                            code: ({ inline, ...props }) => inline
                                ? <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[12px]" {...props} />
                                : <code className="block p-2 rounded bg-[var(--bg-tertiary)] text-[12px] overflow-x-auto" {...props} />,
                        }}
                    >
                        {convertWikilinksToMd(bodyMd)}
                    </ReactMarkdown>
                </div>
            )}
            {images.length > 0 && (
                // Cover/imatges del preview que NO apareixien al body_md.
                // Si una imatge ja apareix inline, no es duplica perquè
                // _cacheSet només posa imatges del frontmatter/cover.
                <div className="flex flex-wrap gap-2 mt-3">
                    {images.filter(src => !bodyMd || !bodyMd.includes(src.split('/').pop()?.split('?')[0] || ''))
                        .map((src, i) => (
                            <RetryableImage key={`${src}-${i}`} src={src} title={row.title || ''} onClick={() => onOpenPage?.(row.id)} />
                        ))}
                </div>
            )}
        </article>
    );
}

const FEED_PAGE_SIZE = 20;
// Per sota d'aquest llindar renderitzem tot el feed d'una tirada (sense
// scroll infinit). Així el cas comú (dashboards amb desenes o un parell de
// centenars d'items) no pateix mai els bugs de "tornar al principi" que la
// paginació interna porta de regal: re-renders del pare, remounts del bloc
// pel BlockNote, layout shifts dels previews late-loading. Per feeds molt
// grans mantenim la paginació amb sentinel per no muntar centenars de
// IntersectionObservers (un per FeedItem) al primer paint.
const FEED_FULL_RENDER_THRESHOLD = 200;

// `visibleCount` per block.id viu fora del component: BlockNote pot desmuntar
// i remuntar un bloc en certes interaccions de l'editor (focus, canvis de
// document), i sense això l'usuari perdia tots els items carregats per scroll
// infinit cada vegada. Persistim també la signatura del contingut perquè un
// canvi real de dades sí faci reset.
const _feedVisibleStateByBlockId = new Map();

function FeedRender({ rows, columns, onOpenPage, blockId }) {
    const dateCol = useMemo(() => pickDateCol(columns, rows), [columns, rows]);

    const isPaginated = rows.length > FEED_FULL_RENDER_THRESHOLD;

    // Signatura del contingut, no de la referència: si el DbViewEmbed pare
    // es re-renderitza (p.ex. clic en un altre block del dashboard), `rows`
    // arriba com a array nou amb el mateix contingut. Comparant length +
    // primer i últim id, només resetejem quan el contingut realment canvia
    // (filtre nou, registre afegit/eliminat, etc.).
    const rowsSignature = rows.length === 0
        ? '__empty__'
        : `${rows.length}|${rows[0]?.id || ''}|${rows[rows.length - 1]?.id || ''}`;

    const stateKey = blockId || '__default__';
    const [visibleCount, setVisibleCount] = useState(() => {
        const cached = _feedVisibleStateByBlockId.get(stateKey);
        if (cached && cached.signature === rowsSignature) return cached.visibleCount;
        return FEED_PAGE_SIZE;
    });
    const [trackedSignature, setTrackedSignature] = useState(rowsSignature);
    const sentinelRef = useRef(null);

    if (trackedSignature !== rowsSignature) {
        setTrackedSignature(rowsSignature);
        setVisibleCount(FEED_PAGE_SIZE);
    }

    useEffect(() => {
        if (!isPaginated) return;
        _feedVisibleStateByBlockId.set(stateKey, { signature: rowsSignature, visibleCount });
    }, [isPaginated, stateKey, rowsSignature, visibleCount]);

    useEffect(() => {
        if (!isPaginated || visibleCount >= rows.length) return undefined;
        const el = sentinelRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') return undefined;
        const io = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) {
                setVisibleCount(c => Math.min(c + FEED_PAGE_SIZE, rows.length));
            }
        }, { rootMargin: '300px' });
        io.observe(el);
        return () => io.disconnect();
    }, [isPaginated, visibleCount, rows.length]);

    if (rows.length === 0) {
        return (
            <div className="my-2 p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30">
                <p className="text-xs text-[var(--text-tertiary)] italic">Cap entrada.</p>
            </div>
        );
    }

    const slice = isPaginated ? rows.slice(0, visibleCount) : rows;
    const remaining = isPaginated ? rows.length - visibleCount : 0;

    return (
        // `overflow-anchor: none` evita que el navegador faci salts de scroll
        // quan els FeedItems sota demanda canvien d'alçada (les imatges late-
        // loading i el preview del cos del markdown, que es carreguen via
        // IntersectionObserver al FeedItem). Amb anchor automàtic, baixar →
        // pujar → tornar a baixar pot desancorar i tornar el scroll al
        // principi visible.
        <div className="my-2" style={{ overflowAnchor: 'none' }}>
            <div className="flex flex-col gap-2">
                {slice.map(r => (
                    <FeedItem
                        key={r.id}
                        row={r}
                        columns={columns}
                        dateCol={dateCol}
                        onOpenPage={onOpenPage}
                    />
                ))}
                {remaining > 0 && (
                    <div ref={sentinelRef} className="flex justify-center py-3">
                        <button
                            onClick={() => setVisibleCount(c => Math.min(c + FEED_PAGE_SIZE, rows.length))}
                            className="text-xs px-3 py-1.5 rounded-md border border-[var(--border-primary)] hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)] transition-colors"
                        >
                            Carregar més ({remaining} pendents)
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ----------------------------- Board (Kanban) ------------------------------ */

function pickGroupCol(view, columns, rows) {
    const explicit = view?.group_by || view?.groupBy;
    if (explicit) return explicit;
    const guessSelect = (columns || []).find(c => c !== 'title' && /(estat|status|state|fase|stage)/i.test(c));
    if (guessSelect) return guessSelect;
    // Primera columna que tingui valors escalars repetits.
    for (const c of (columns || [])) {
        if (c === 'title') continue;
        const vals = new Set();
        for (const r of rows || []) {
            const v = r.metadata?.[c];
            const k = Array.isArray(v) ? (v[0] || '') : (v == null ? '' : String(v));
            vals.add(k);
        }
        if (vals.size > 1 && vals.size < (rows?.length || 1)) return c;
    }
    return (columns || []).find(c => c !== 'title') || null;
}

function BoardRender({ rows, columns, view, onOpenPage, onCreate, onMove, onChangeGroupBy }) {
    const [localRows, setLocalRows] = useState(rows);
    useEffect(() => { setLocalRows(rows); }, [rows]);
    const groupCol = pickGroupCol(view, columns, localRows);

    const groups = useMemo(() => {
        const g = {};
        (localRows || []).forEach(r => {
            const v = groupCol ? r.metadata?.[groupCol] : null;
            const key = Array.isArray(v) ? (v[0] || '—') : v == null || v === '' ? '—' : String(v);
            if (!g[key]) g[key] = [];
            g[key].push(r);
        });
        return g;
    }, [localRows, groupCol]);

    const keys = Object.keys(groups).sort();
    const groupOptions = (columns || []).filter(c => c !== 'title');

    const handleDragStart = (e, pageId) => {
        e.dataTransfer.setData('text/plain', pageId);
        e.dataTransfer.effectAllowed = 'move';
    };
    const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    const handleDrop = async (e, targetKey) => {
        e.preventDefault();
        const pageId = e.dataTransfer.getData('text/plain');
        if (!pageId || !groupCol) return;
        // Optimistic update
        const value = targetKey === '—' ? '' : targetKey;
        setLocalRows(prev => prev.map(r => {
            if (r.id !== pageId) return r;
            const cur = r.metadata?.[groupCol];
            const newVal = Array.isArray(cur) ? (value ? [value] : []) : value;
            return { ...r, metadata: { ...r.metadata, [groupCol]: newVal } };
        }));
        try { await onMove?.(pageId, groupCol, value); }
        catch { setLocalRows(rows); /* revert */ }
    };

    return (
        <div className="my-2">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Agrupa per</span>
                <select
                    value={groupCol || ''}
                    onChange={(e) => onChangeGroupBy?.(e.target.value || null)}
                    className="text-xs px-2 py-1 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                >
                    {groupOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2">
                {keys.map(k => (
                    <div
                        key={k}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, k)}
                        className="min-w-[220px] flex-1 max-w-[300px] rounded-lg bg-[var(--bg-secondary)]/40 border border-[var(--border-primary)] p-2"
                    >
                        <div className="flex items-center justify-between px-1 pb-2 border-b border-[var(--border-primary)]/50 mb-2">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                                {k} <span className="text-[var(--text-tertiary)] font-normal">({groups[k].length})</span>
                            </div>
                            {onCreate && (
                                <button
                                    onClick={() => onCreate({ [groupCol]: k === '—' ? '' : k })}
                                    className="text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
                                    title="Crear a aquesta columna"
                                >
                                    <Plus size={12} />
                                </button>
                            )}
                        </div>
                        <div className="space-y-1.5 min-h-[20px]">
                            {groups[k].map(r => (
                                <div
                                    key={r.id}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, r.id)}
                                    className="cursor-grab active:cursor-grabbing"
                                >
                                    <button
                                        onClick={() => onOpenPage?.(r.id)}
                                        className="w-full text-left p-2 rounded-md bg-[var(--bg-primary)] border border-[var(--border-primary)] hover:border-[var(--gnosi-primary)] text-xs text-[var(--text-primary)] truncate"
                                    >
                                        {r.title || '(sense títol)'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ----------------------------- Calendar amb modes -------------------------- */

function MonthGrid({ year, month, byDay, onOpenPage, onCreateDay }) {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startWeekday = (firstDay.getDay() + 6) % 7;
    const totalDays = lastDay.getDate();
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= totalDays; d++) cells.push(d);
    const weekdays = ['dl', 'dt', 'dc', 'dj', 'dv', 'ds', 'dg'];
    return (
        <>
            <div className="grid grid-cols-7 gap-1 text-[10px] font-bold uppercase text-[var(--text-tertiary)] mb-1">
                {weekdays.map(w => <div key={w} className="text-center py-1">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
                {cells.map((d, idx) => (
                    <div
                        key={idx}
                        className={`group relative min-h-[60px] rounded border ${d ? 'border-[var(--border-primary)] bg-[var(--bg-secondary)]/30' : 'border-transparent'} p-1`}
                    >
                        {d && (
                            <>
                                <div className="flex items-center justify-between">
                                    <div className="text-[10px] text-[var(--text-tertiary)]">{d}</div>
                                    {onCreateDay && (
                                        <button
                                            onClick={() => onCreateDay(new Date(year, month, d))}
                                            className="opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
                                            title="Crear aquest dia"
                                        >
                                            <Plus size={10} />
                                        </button>
                                    )}
                                </div>
                                <div className="space-y-0.5">
                                    {(byDay[d] || []).slice(0, 3).map(it => (
                                        <button
                                            key={it.id}
                                            onClick={() => onOpenPage?.(it.id)}
                                            className="block w-full text-left text-[10px] text-[var(--gnosi-primary)] hover:underline truncate"
                                            title={it.title}
                                        >
                                            {it.title || '(sense títol)'}
                                        </button>
                                    ))}
                                    {(byDay[d]?.length || 0) > 3 && (
                                        <div className="text-[9px] text-[var(--text-tertiary)] italic">+{byDay[d].length - 3}</div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>
        </>
    );
}

function CalendarRender({ rows, columns, onOpenPage, onCreate }) {
    const dateCol = pickDateCol(columns, rows) || 'date';
    const items = useMemo(() => rows
        .map(r => ({ id: r.id, title: r.title, date: parseDate(r.metadata?.[dateCol]) }))
        .filter(x => x.date), [rows, dateCol]);
    const [mode, setMode] = useState('month'); // month | week | day | year
    const [cursor, setCursor] = useState(() => items[0]?.date || new Date());

    const fmtYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const onCreateDay = (date) => onCreate?.({ [dateCol]: fmtYmd(date) });

    if (items.length === 0 && rows.length > 0) {
        return <p className="text-xs text-[var(--text-tertiary)] italic px-2">Cap fila amb data al camp <code>{dateCol}</code>.</p>;
    }

    const year = cursor.getFullYear();
    const month = cursor.getMonth();

    const headerTitle = (() => {
        if (mode === 'month') return cursor.toLocaleDateString('ca-ES', { month: 'long', year: 'numeric' });
        if (mode === 'year') return String(year);
        if (mode === 'week') {
            const start = new Date(cursor);
            start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
            const end = new Date(start); end.setDate(end.getDate() + 6);
            return `${start.toLocaleDateString('ca-ES', { day: '2-digit', month: 'short' })} – ${end.toLocaleDateString('ca-ES', { day: '2-digit', month: 'short', year: 'numeric' })}`;
        }
        return cursor.toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    })();

    const shift = (delta) => {
        const d = new Date(cursor);
        if (mode === 'month') d.setMonth(d.getMonth() + delta);
        else if (mode === 'year') d.setFullYear(d.getFullYear() + delta);
        else if (mode === 'week') d.setDate(d.getDate() + 7 * delta);
        else d.setDate(d.getDate() + delta);
        setCursor(d);
    };

    const byDayMonth = (() => {
        const map = {};
        items.forEach(it => {
            if (it.date.getFullYear() === year && it.date.getMonth() === month) {
                const k = it.date.getDate();
                (map[k] ||= []).push(it);
            }
        });
        return map;
    })();

    const renderWeek = () => {
        const start = new Date(cursor);
        start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
        const days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(start); d.setDate(start.getDate() + i); return d;
        });
        const weekdays = ['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'];
        return (
            <div className="grid grid-cols-7 gap-1">
                {days.map((d, i) => {
                    const ev = items.filter(it => it.date.toDateString() === d.toDateString());
                    return (
                        <div key={i} className="group relative min-h-[120px] rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 p-1.5">
                            <div className="flex items-center justify-between">
                                <div className="text-[10px] text-[var(--text-tertiary)]">{weekdays[i]} {d.getDate()}</div>
                                {onCreate && (
                                    <button
                                        onClick={() => onCreateDay(d)}
                                        className="opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)]"
                                    ><Plus size={10} /></button>
                                )}
                            </div>
                            <div className="space-y-0.5 mt-1">
                                {ev.map(it => (
                                    <button
                                        key={it.id}
                                        onClick={() => onOpenPage?.(it.id)}
                                        className="block w-full text-left text-[10px] text-[var(--gnosi-primary)] hover:underline truncate"
                                    >{it.title || '(sense títol)'}</button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderDay = () => {
        const ev = items
            .filter(it => it.date.toDateString() === cursor.toDateString())
            .sort((a, b) => a.date - b.date);
        return (
            <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 p-3">
                {ev.length === 0 ? (
                    <p className="text-xs text-[var(--text-tertiary)] italic">Cap entrada en aquest dia.</p>
                ) : (
                    <ul className="space-y-1.5">
                        {ev.map(it => (
                            <li key={it.id} className="text-sm">
                                <button onClick={() => onOpenPage?.(it.id)} className="text-[var(--gnosi-primary)] hover:underline">
                                    {it.title || '(sense títol)'}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                {onCreate && (
                    <button
                        onClick={() => onCreateDay(cursor)}
                        className="btn btn-gnosi-primary !px-3 !py-1.5 !text-xs !gap-1.5 mt-3 inline-flex items-center"
                    >
                        <Plus size={14} /> Afegir entrada
                    </button>
                )}
            </div>
        );
    };

    const renderYear = () => (
        <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
            {Array.from({ length: 12 }, (_, m) => {
                const count = items.filter(it => it.date.getFullYear() === year && it.date.getMonth() === m).length;
                const name = new Date(year, m, 1).toLocaleDateString('ca-ES', { month: 'long' });
                return (
                    <button
                        key={m}
                        onClick={() => { setMode('month'); setCursor(new Date(year, m, 1)); }}
                        className="text-left p-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 hover:border-[var(--gnosi-primary)]"
                    >
                        <div className="text-xs font-semibold text-[var(--text-primary)] capitalize">{name}</div>
                        <div className="text-[10px] text-[var(--text-tertiary)] mt-1">{count} entrades</div>
                    </button>
                );
            })}
        </div>
    );

    return (
        <div className="my-2">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-2">
                    <button onClick={() => shift(-1)} className="text-xs px-2 py-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">‹</button>
                    <div className="text-sm font-semibold text-[var(--text-primary)] capitalize">{headerTitle}</div>
                    <button onClick={() => shift(1)} className="text-xs px-2 py-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">›</button>
                    <button onClick={() => setCursor(new Date())} className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--gnosi-primary)]">Avui</button>
                </div>
                <div className="flex items-center gap-1">
                    {['day', 'week', 'month', 'year'].map(m => (
                        <button
                            key={m}
                            onClick={() => setMode(m)}
                            className={`text-[10px] px-2 py-1 rounded ${mode === m ? 'bg-[var(--gnosi-primary)]/15 text-[var(--gnosi-primary)] font-semibold' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}
                        >
                            {({ day: 'Dia', week: 'Setmana', month: 'Mes', year: 'Any' })[m]}
                        </button>
                    ))}
                </div>
            </div>
            {mode === 'month' && <MonthGrid year={year} month={month} byDay={byDayMonth} onOpenPage={onOpenPage} onCreateDay={onCreateDay} />}
            {mode === 'week' && renderWeek()}
            {mode === 'day' && renderDay()}
            {mode === 'year' && renderYear()}
        </div>
    );
}

/* ----------------------------- Timeline ------------------------------------ */

function TimelineRender({ rows, columns, onOpenPage }) {
    const dateCol = pickDateCol(columns, rows) || 'date';
    const items = useMemo(() => rows
        .map(r => ({ id: r.id, title: r.title, date: parseDate(r.metadata?.[dateCol]) }))
        .filter(x => x.date)
        .sort((a, b) => b.date.getTime() - a.date.getTime()), [rows, dateCol]);

    if (items.length === 0 && rows.length > 0) {
        return <p className="text-xs text-[var(--text-tertiary)] italic px-2">Cap fila amb data al camp <code>{dateCol}</code>.</p>;
    }

    const groups = [];
    let currentYear = null;
    items.forEach(it => {
        const y = it.date.getFullYear();
        if (y !== currentYear) {
            groups.push({ year: y, items: [] });
            currentYear = y;
        }
        groups[groups.length - 1].items.push(it);
    });

    return (
        <div className="my-2">
            {groups.map(g => (
                <div key={g.year} className="mb-4">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--gnosi-primary)] mb-2">{g.year}</div>
                    <div className="border-l-2 border-[var(--border-primary)] pl-4 space-y-2">
                        {g.items.map(it => {
                            const label = it.date.toLocaleDateString('ca-ES', { day: '2-digit', month: 'short' });
                            return (
                                <div key={it.id} className="relative">
                                    <span className="absolute -left-[1.4rem] top-1.5 w-2.5 h-2.5 rounded-full bg-[var(--gnosi-primary)] border-2 border-[var(--bg-primary)]" />
                                    <div className="text-[10px] font-mono text-[var(--text-tertiary)]">{label}</div>
                                    <button
                                        onClick={() => onOpenPage?.(it.id)}
                                        className="text-sm text-[var(--text-primary)] hover:text-[var(--gnosi-primary)] hover:underline text-left"
                                    >{it.title || '(sense títol)'}</button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ----------------------------- Graph (força) ------------------------------- */

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

    const viewId = String(block?.props?.view_id || '').trim();
    const headingProp = block?.props?.heading || '';
    const headingLevelProp = Number(block?.props?.heading_level) || 0;

    const [view, setView] = useState(null);
    const [allRows, setAllRows] = useState([]);   // tots els registres no-template
    const [templates, setTemplates] = useState([]); // plantilles separades
    const [loading, setLoading] = useState(() => Boolean(pageId && viewId));
    const [error, setError] = useState(() => {
        if (!pageId) return 'Sense pàgina activa per resoldre la vista.';
        if (!viewId) return 'Vista sense view_id.';
        return '';
    });
    const [reloadKey, setReloadKey] = useState(0);
    const [searchTerm, setSearchTerm] = useState('');
    const [showSearch, setShowSearch] = useState(false);

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
                const section = sections.find(s => s.view_id === viewId)
                    || (headingProp ? sections.find(s => s.heading === headingProp) : null);
                if (!section) {
                    if (!cancelled) {
                        setView(null);
                        setAllRows([]);
                        setTemplates([]);
                        setError(`Vista "${viewId.slice(0, 8)}..." no trobada al registry.`);
                        setLoading(false);
                    }
                    return;
                }
                if (!cancelled) setView(section);

                const tableId = section.source_table_id || section.table_id;
                if (!tableId) {
                    if (!cancelled) { setAllRows([]); setTemplates([]); setLoading(false); }
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

                const filters = (section.filters && section.filters.length > 0)
                    ? section.filters
                    : (section.filter ? [section.filter] : []);
                const filtered = records.filter(r => filters.every(f => applyFilter(r.metadata || {}, pageId, f)));
                const sorts = (section.sorts && section.sorts.length > 0)
                    ? section.sorts
                    : (section.sort ? [section.sort] : []);
                const sorted = multiKeySort(filtered, sorts);

                if (!cancelled) {
                    setAllRows(sorted);
                    setTemplates(tpls);
                    setLoading(false);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e?.response?.data?.detail || e?.message || 'Error carregant la vista');
                    setAllRows([]);
                    setTemplates([]);
                    setLoading(false);
                }
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [viewId, pageId, headingProp, reloadKey]);

    const columns = useMemo(
        () => view?.visible_properties || view?.columns || ['title'],
        [view],
    );
    const rawType = String(view?.view_type || view?.type || 'table').toLowerCase();
    const viewType = rawType === 'db_view' ? 'table' : rawType;
    const displayHeading = headingProp || view?.heading;
    const displayLevel = headingLevelProp || view?.heading_level || 1;

    const tableId = view?.source_table_id || view?.table_id;

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
        if (onOpenPageViewModal && tableId) onOpenPageViewModal(tableId, block);
    }, [onOpenPageViewModal, tableId, block]);

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

    const renderBody = () => {
        switch (viewType) {
            case 'list': return <ListRender {...commonProps} />;
            case 'feed': return <FeedRender {...commonProps} />;
            case 'gallery': return <GalleryRender {...commonProps} />;
            case 'board': return <BoardRender {...commonProps} onMove={handleMove} onChangeGroupBy={handleChangeGroupBy} />;
            case 'calendar': return <CalendarRender {...commonProps} />;
            case 'timeline': return <TimelineRender {...commonProps} />;
            case 'graph': return <GraphRender {...commonProps} />;
            default: return <TableRender {...commonProps} />;
        }
    };

    return (
        <div className="my-4">
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
            {renderBody()}
        </div>
    );
}
