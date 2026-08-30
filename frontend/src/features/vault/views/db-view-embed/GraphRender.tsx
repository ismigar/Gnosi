import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { legacyText } from './decode';
import type { EmbedRow } from './types';
export function GraphRender({ rows, columns, onOpenPage }: { rows: readonly EmbedRow[]; columns: readonly string[]; onOpenPage?: ((id: string) => unknown) | null; }) {
    const { t } = useTranslation();
    const idToRow = useMemo(() => Object.fromEntries(rows.map(r => [r.id, r])), [rows]);
    const titleToId = useMemo(() => {
        const m: Record<string, string> = {};
        rows.forEach(r => { if (r.title) m[r.title] = r.id; });
        return m;
    }, [rows]);

    const relationCol = columns.find(c => rows.some(r => Array.isArray(r.metadata[c]) && r.metadata[c].length > 0));

    const { nodes, links } = useMemo(() => {
        const nodeMap = new Map<string, { id: string; title: string; }>();
        rows.forEach(r => nodeMap.set(r.id, { id: r.id, title: r.title || t('view.untitled', "(untitled)") }));
        const edges: { source: string; target: string; }[] = [];
        if (relationCol) {
            rows.forEach(r => {
                const targets = r.metadata[relationCol];
                if (!Array.isArray(targets)) return;
                targets.forEach(t => {
                    const key = legacyText(t);
                    const tid = idToRow[key] ? key : titleToId[key];
                    if (!tid) return;
                    if (!nodeMap.has(tid)) nodeMap.set(tid, { id: tid, title: tid });
                    edges.push({ source: r.id, target: tid });
                });
            });
        }
        return { nodes: Array.from(nodeMap.values()), links: edges };
    }, [rows, relationCol, idToRow, titleToId, t]);

    const svgRef = useRef<SVGSVGElement>(null);
    const [hover, setHover] = useState<string | null>(null);
    const W = 600, H = 360;

    // Force simulation run as a derived computation (useMemo) to avoid
    // setState inside useEffect — the cost is amortizable: ~250 iterations × N²
    // is fast for views with fewer than 200 nodes (the common case).
    const positions = useMemo<Record<string, { x: number; y: number; }>>(() => {
        if (nodes.length === 0) return {};
        const sim = nodes.map((n, i) => ({
            id: n.id,
            x: W / 2 + Math.cos((i * 2 * Math.PI) / nodes.length) * 80,
            y: H / 2 + Math.sin((i * 2 * Math.PI) / nodes.length) * 80,
            vx: 0, vy: 0,
        }));
        const byId = Object.fromEntries(sim.map(s => [s.id, s]));
        const REPEL = 4000, SPRING = 0.02, SPRING_LEN = 80, CENTER = 0.005, DAMP = 0.85, STEPS = 250;

        for (let step = 0;step < STEPS;step++) {
            for (let i = 0;i < sim.length;i++) {
                for (let j = i + 1;j < sim.length;j++) {
                    const a = sim[i], b = sim[j];
                    if (!a || !b) continue;
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
        <div className="my-2 bg-[var(--bg-secondary)]/30">
            <div className="p-2 border-b border-[var(--border-primary)]/40 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                {t('view.graph_title', "Graph")} {relationCol ? <>{t('view.graph_via', 'via')} <code>{relationCol}</code></> : t('view.graph_no_relations', "(no relations)")} · {t('view.graph_stats', "{{nodes}} nodes · {{edges}} edges", { nodes: nodes.length, edges: links.length })}
            </div>
            <svg ref={svgRef} viewBox={`0 0 ${String(W)} ${String(H)}`} className="w-full" style={{ maxHeight: 400 }}>
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
                            transform={`translate(${String(p.x)}, ${String(p.y)})`}
                            style={{ cursor: 'pointer' }}
                            onClick={() => onOpenPage?.(n.id)}
                            onMouseEnter={() => { setHover(n.id); }}
                            onMouseLeave={() => { setHover(null); }}
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
