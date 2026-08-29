import { useContext, useEffect, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HTMLContainer } from 'tldraw';

import { fetchVaultPage } from '../../../shared/api/vaults';
import { CanvasPageContext } from './context';
import { pageCardPreview } from './model';
import type { PageCardData, PageCardShape } from './types';


interface PageCardComponentProps {
    readonly shape: Pick<PageCardShape, 'props'>;
}


const pageCache = new Map<string, PageCardData>();


function usePageData(pageId: string, unavailableTitle: string): PageCardData | null {
    const [data, setData] = useState<PageCardData | null>(
        () => pageCache.get(pageId) ?? null,
    );
    useEffect(() => {
        if (!pageId) return undefined;
        const controller = new AbortController();
        void fetchVaultPage(pageId, controller.signal)
            .then((page) => {
                if (controller.signal.aborted) return;
                const next = {
                    title: typeof page.title === 'string' ? page.title : '',
                    content: typeof page.content === 'string' ? page.content : '',
                };
                pageCache.set(pageId, next);
                setData(next);
            })
            .catch(() => {
                if (!controller.signal.aborted) {
                    setData({
                        title: unavailableTitle,
                        content: '',
                    });
                }
            });
        return () => {
            controller.abort();
        };
    }, [pageId, unavailableTitle]);
    return data;
}


export function PageCardComponent({ shape }: PageCardComponentProps) {
    const { t } = useTranslation();
    const { onOpenPage } = useContext(CanvasPageContext);
    const data = usePageData(
        shape.props.pageId,
        t('page_card.unavailable_title', '(not available)'),
    );
    const title = data?.title || shape.props.pageTitle || t('tldraw.page', 'Page');
    const preview = pageCardPreview(data?.content ?? '');
    return (
        <HTMLContainer style={{
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
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border-primary,#e2e8f0)', background: 'var(--bg-secondary,#f8fafc)' }}>
                <FileText size={13} style={{ color: '#6366f1', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary,#0f172a)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                    {title}
                </span>
                {onOpenPage ? (
                    <button
                        onPointerDown={(event) => {
                            event.stopPropagation();
                            onOpenPage(shape.props.pageId);
                        }}
                        style={{ display: 'inline-flex', alignItems: 'center', border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 2 }}
                        title={t('feed.open_page', 'Open page')}
                        type="button"
                    ><ExternalLink size={13} /></button>
                ) : null}
            </div>
            <div style={{ flex: 1, overflow: 'hidden', padding: '8px 10px', fontSize: 11, lineHeight: 1.45, color: 'var(--text-secondary,#475569)', whiteSpace: 'pre-wrap' }}>
                {preview || (
                    <span style={{ fontStyle: 'italic', color: '#94a3b8' }}>
                        {t('editor.no_content', 'No content')}
                    </span>
                )}
            </div>
        </HTMLContainer>
    );
}
