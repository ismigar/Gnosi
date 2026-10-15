import { useContext } from 'react';
import { ExternalLink, FileText, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HTMLContainer } from 'tldraw';

import { InstructionMarkdownEditor } from '../../../../shared/editor/InstructionMarkdownEditor';
import { useEditablePageCard } from './useEditablePageCard';
import { CanvasPageContext } from './context';
import { pageCardPreview } from './model';
import type { PageCardShape } from './types';


interface PageCardComponentProps {
    readonly shape: Pick<PageCardShape, 'props'>;
}


export function PageCardComponent({ shape }: PageCardComponentProps) {
    const { t } = useTranslation();
    const { onOpenPage } = useContext(CanvasPageContext);
    const editor = useEditablePageCard(shape.props.pageId);
    const data = editor.page;
    const title = (typeof data?.title === 'string' ? data.title : '') || shape.props.pageTitle || t('tldraw.page', 'Page');
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
                <button type="button" onPointerDown={event => { event.stopPropagation(); }}
                    onClick={editor.begin} disabled={!data?.etag || editor.editing}
                    className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-40"
                    aria-label={t('page_card.edit', 'Edit page content')} title={t('page_card.edit', 'Edit page content')}>
                    <Pencil size={13} />
                </button>
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
            <div className="flex-1 min-h-0 overflow-auto p-2 text-xs text-[var(--text-secondary)]"
                onPointerDown={editor.editing ? event => { event.stopPropagation(); } : undefined}
                onKeyDown={editor.editing ? event => { event.stopPropagation(); } : undefined}
                onWheel={event => { event.stopPropagation(); }}>
                {editor.editing ? <>
                    <InstructionMarkdownEditor label={t('page_card.content', 'Page content')} value={editor.draft}
                        onChange={editor.setDraft} disabled={editor.saving} />
                    <div className="flex gap-2 py-2">
                        <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={editor.saving}
                            onClick={() => { void editor.save(); }}>{t('common.save', 'Save')}</button>
                        <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={editor.saving}
                            onClick={() => { void editor.cancel(); }}>{t('common.cancel', 'Cancel')}</button>
                    </div>
                </> : <div className="whitespace-pre-wrap">{preview || <span className="italic text-[var(--text-tertiary)]">
                    {t('editor.no_content', 'No content')}
                </span>}</div>}
                {editor.error && <p role="alert" className="py-2 text-[var(--gnosi-danger)]">
                    {editor.error === 'conflict'
                        ? t('page_card.conflict', 'This page changed elsewhere. Your draft is kept. Copy it before cancelling to load the latest page.')
                        : editor.error === 'load'
                            ? t('page_card.load_error', 'The page could not be loaded.')
                            : t('page_card.save_error', 'The page could not be saved. Your draft is kept.')}
                </p>}
            </div>
        </HTMLContainer>
    );
}
