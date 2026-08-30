import type { SyntheticEvent } from 'react';
import { ArrowLeft, Check, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ReaderArticle } from '../../../shared/api/reader';
import { readerArticleMeta } from './readerDashboardModel';

const ARTICLE_IFRAME_CSS = `
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
        font-family: Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        font-size: 16px;
        line-height: 1.7;
        color: #1e293b;
        margin: 0;
        padding: 0;
        word-wrap: break-word;
        overflow-wrap: break-word;
    }
    @media (prefers-color-scheme: dark) {
        body { color: #e2e8f0; }
        blockquote { color: #94a3b8; border-color: #475569; }
        code, pre { background: rgba(255,255,255,0.07); }
        th { background: rgba(255,255,255,0.04); }
        th, td, hr { border-color: #334155; }
        a { color: #93c5fd; }
        a:hover { border-bottom-color: #93c5fd; }
    }
    h1, h2, h3, h4, h5, h6 {
        font-weight: 600;
        line-height: 1.3;
        margin: 1.6em 0 0.5em;
        letter-spacing: -0.01em;
    }
    h1 { font-size: 1.5em; }
    h2 { font-size: 1.3em; }
    h3 { font-size: 1.15em; }
    h4 { font-size: 1.05em; }
    p { margin: 0 0 1.8em; }
    ul, ol { padding-left: 1.5em; margin: 0 0 1em; }
    li { margin: 0.25em 0; }
    li > p:last-child { margin-bottom: 0; }
    blockquote {
        border-left: 3px solid #cbd5e1;
        padding-left: 1em;
        margin: 1em 0;
        color: #64748b;
        font-style: italic;
    }
    code {
        background: rgba(0,0,0,0.06);
        padding: 0.15em 0.35em;
        border-radius: 3px;
        font-size: 0.9em;
        font-family: ui-monospace, SF Mono, Menlo, monospace;
    }
    pre {
        background: rgba(0,0,0,0.06);
        padding: 1em;
        border-radius: 6px;
        overflow-x: auto;
        margin: 1em 0;
    }
    pre code { background: none; padding: 0; font-size: 0.9em; }
    img, video {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        margin: 1em 0;
        display: block;
    }
    a {
        color: #4f46e5;
        text-decoration: none;
        border-bottom: 1px solid rgba(79,70,229,0.3);
    }
    a:hover { border-bottom-color: currentColor; }
    table {
        width: 100%;
        border-collapse: collapse;
        margin: 1em 0;
        font-size: 0.95em;
    }
    th, td { border: 1px solid #cbd5e1; padding: 0.5em 0.75em; text-align: left; vertical-align: top; }
    th { background: rgba(0,0,0,0.04); font-weight: 600; }
    hr { border: none; border-top: 1px solid #cbd5e1; margin: 2em 0; }
    figure { margin: 1em 0; }
    figcaption { font-size: 0.85em; color: #64748b; margin-top: 0.5em; text-align: center; }
    iframe { max-width: 100%; }
`;

function fitIframeToContent(event: SyntheticEvent<HTMLIFrameElement>): void {
    const iframe = event.currentTarget;
    try {
        const documentNode = iframe.contentDocument ?? iframe.contentWindow?.document;
        if (!documentNode) return;
        const measure = (): void => {
            const height = Math.max(
                documentNode.body.scrollHeight,
                documentNode.documentElement.scrollHeight,
            );
            iframe.style.height = `${String(height + 16)}px`;
        };
        measure();
        const images = Array.from(documentNode.images);
        let pending = images.filter((image) => !image.complete).length;
        if (pending === 0) return;
        const settle = (): void => {
            pending -= 1;
            if (pending <= 0) measure();
        };
        images.forEach((image) => {
            if (image.complete) return;
            image.addEventListener('load', settle, { once: true });
            image.addEventListener('error', settle, { once: true });
        });
    } catch {
        // Cross-origin or sandbox quirks leave the default height intact.
    }
}

interface ReaderArticleContentProps {
    readonly article: ReaderArticle;
    readonly locale: string;
    readonly onBack: () => void;
    readonly onMarkRead: (articleId: number) => void;
}

export function ReaderArticleContent({
    article,
    locale,
    onBack,
    onMarkRead,
}: ReaderArticleContentProps) {
    const { t } = useTranslation();
    const body = article.full_content || article.content || '';
    const isHtml = body.includes('<');
    const paragraphs = isHtml ? [] : body.split(/\n\s*\n/).filter((paragraph) => paragraph.trim());
    return <article className="max-w-[640px] mx-auto py-12 px-6 md:px-10 animate-fade-in-up">
        <button onClick={onBack} className="md:hidden mb-8 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 hover:text-[var(--text-primary)] transition-colors" type="button">
            <ArrowLeft size={16} /><span>{t('reader_back')}</span>
        </button>
        <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
            {readerArticleMeta(article, locale)}
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold text-[var(--text-primary)] leading-tight tracking-tight mb-6">{article.title}</h1>
        <div className="flex items-center gap-5 mb-10 text-sm">
            <button onClick={() => { onMarkRead(article.id); }} className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-[var(--text-primary)] transition-colors" type="button">
                <Check size={15} /><span>{t('reader_mark_read')}</span>
            </button>
            <a href={article.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-[var(--text-primary)] transition-colors">
                <span>{t('reader_original_source')}</span><ExternalLink size={13} />
            </a>
        </div>
        {isHtml ? <iframe
            key={article.id}
            srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>${ARTICLE_IFRAME_CSS}</style></head><body>${body}</body></html>`}
            sandbox="allow-same-origin allow-popups"
            title="article-content"
            onLoad={fitIframeToContent}
            style={{ width: '100%', minHeight: '200px', border: 'none', display: 'block' }}
        /> : <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-p:leading-7 prose-a:text-[var(--gnosi-blue)] prose-a:font-medium prose-a:no-underline hover:prose-a:underline prose-strong:font-semibold prose-img:rounded-md prose-img:max-w-full">
            {paragraphs.length > 1
                ? paragraphs.map((paragraph, index) => <p key={String(index)} style={{ whiteSpace: 'pre-wrap' }}>{paragraph}</p>)
                : <p style={{ whiteSpace: 'pre-wrap' }}>{body}</p>}
        </div>}
    </article>;
}
