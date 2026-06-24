/**
 * canvasPageCardShape.jsx
 * Custom Tldraw shape "page-card" — a live card that embeds a Vault page on the
 * canvas (Obsidian-Canvas style): shows the page title + a content preview that
 * stays in sync with the real note, plus an "Obrir" button.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { BaseBoxShapeUtil, HTMLContainer, Rectangle2d, resizeBox, T } from 'tldraw';
import axios from 'axios';
import { FileText, ExternalLink } from 'lucide-react';

// Context to surface app callbacks (open a page) into the shape component, which
// is instantiated by Tldraw. <Tldraw> is a descendant of this provider so the
// context flows through normally.
export const CanvasPageContext = createContext({ onOpenPage: null });

// Small module-level cache so cards don't refetch the same page repeatedly and
// renames propagate (we key by pageId and fetch fresh on first mount).
const _pageCache = new Map(); // pageId -> { title, content }

function usePageData(pageId) {
    const [data, setData] = useState(() => _pageCache.get(pageId) || null);
    useEffect(() => {
        if (!pageId) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await axios.get(`/api/vault/pages/${pageId}`);
                const next = { title: res.data?.title || '', content: res.data?.content || '' };
                _pageCache.set(pageId, next);
                if (!cancelled) setData(next);
            } catch {
                if (!cancelled) setData({ title: '(no disponible)', content: '' });
            }
        })();
        return () => { cancelled = true; };
    }, [pageId]);
    return data;
}

function PageCardComponent({ shape }) {
    const { onOpenPage } = useContext(CanvasPageContext);
    const data = usePageData(shape.props.pageId);
    const title = data?.title || shape.props.pageTitle || 'Pàgina';
    const preview = (data?.content || '').replace(/^---[\s\S]*?---\s*/, '').slice(0, 320);

    return (
        <HTMLContainer
            style={{
                width: shape.props.w,
                height: shape.props.h,
                pointerEvents: 'all',
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--bg-primary, #fff)',
                border: '1px solid var(--border-primary, #e2e8f0)',
                borderRadius: 10,
                overflow: 'hidden',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                fontFamily: 'inherit',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border-primary,#e2e8f0)', background: 'var(--bg-secondary,#f8fafc)' }}>
                <FileText size={13} style={{ color: '#6366f1', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary,#0f172a)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                    {title}
                </span>
                {onOpenPage && (
                    <button
                        onPointerDown={(e) => { e.stopPropagation(); onOpenPage(shape.props.pageId); }}
                        title="Obre la pàgina"
                        style={{ display: 'inline-flex', alignItems: 'center', border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 2 }}
                    >
                        <ExternalLink size={13} />
                    </button>
                )}
            </div>
            <div style={{ flex: 1, overflow: 'hidden', padding: '8px 10px', fontSize: 11, lineHeight: 1.45, color: 'var(--text-secondary,#475569)', whiteSpace: 'pre-wrap' }}>
                {preview || <span style={{ fontStyle: 'italic', color: '#94a3b8' }}>Sense contingut</span>}
            </div>
        </HTMLContainer>
    );
}

export class PageCardShapeUtil extends BaseBoxShapeUtil {
    static type = 'page-card';
    static props = {
        w: T.number,
        h: T.number,
        pageId: T.string,
        pageTitle: T.string,
    };

    getDefaultProps() {
        return { w: 260, h: 170, pageId: '', pageTitle: '' };
    }

    canResize() { return true; }
    canEdit() { return false; }

    getGeometry(shape) {
        return new Rectangle2d({
            width: shape.props.w,
            height: shape.props.h,
            isFilled: true,
        });
    }

    component(shape) {
        return <PageCardComponent shape={shape} />;
    }

    indicator(shape) {
        return <rect width={shape.props.w} height={shape.props.h} rx={10} />;
    }

    onResize(shape, info) {
        return resizeBox(shape, info);
    }
}
