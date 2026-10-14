import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useTranslation } from 'react-i18next';
import type { PublicationBundle } from '../../../shared/api/vault-publishing';
import { headingId, publishedLink } from './publicMarkdownLinks';
import 'katex/dist/katex.min.css';

interface Props {
    readonly markdown: string;
    readonly bundle: PublicationBundle;
    readonly onNavigate: (id: string, fragment?: string) => void;
}

function contentText(children: ReactNode): string {
    return Children.toArray(children).map(child => {
        if (typeof child === 'string' || typeof child === 'number') return String(child);
        return isValidElement<{ children?: ReactNode }>(child) ? contentText(child.props.children) : '';
    }).join('');
}

/** Public snapshots have no editor context, image loader, private resolver or query executor. */
export function PublishedMarkdown({ markdown, bundle, onNavigate }: Props) {
    const { t } = useTranslation();
    const omitted = <span className="text-sm italic text-[var(--text-tertiary)]">{t('publishing.omitted', 'Content omitted from publication')}</span>;
    const linkStyle = 'text-[var(--gnosi-primary)] hover:underline';
    return <div className="feed-md break-words leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false }]]} skipHtml
            urlTransform={url => url.startsWith('gnosi-omitted:') || publishedLink(url, bundle) ? url : ''}
            components={{
                a: ({ href, children }) => {
                    if (href?.startsWith('gnosi-omitted:')) return omitted;
                    const link = publishedLink(href ?? '', bundle);
                    if (!link) return omitted;
                    if ('external' in link) return <a className={linkStyle} href={link.external} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>;
                    const anchor = headingId(link.fragment);
                    return <a className={linkStyle} href={`?page=${link.pageId}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`} onClick={event => {
                        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        event.preventDefault(); onNavigate(link.pageId, anchor);
                    }}>{children}</a>;
                },
                img: () => omitted,
                code: ({ className, children }) => /(?:^|\s)language-(?:query|search)(?:\s|$)/iu.test(className ?? '')
                    ? omitted : <code className={`${className ?? ''} rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-[12px]`}>{children}</code>,
                pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded bg-[var(--bg-tertiary)] p-3">{children}</pre>,
                h1: ({ children }) => <h1 className="my-2 text-2xl font-bold" id={headingId(contentText(children))}>{children}</h1>,
                h2: ({ children }) => <h2 className="my-2 text-xl font-bold" id={headingId(contentText(children))}>{children}</h2>,
                h3: ({ children }) => <h3 className="my-2 text-lg font-semibold" id={headingId(contentText(children))}>{children}</h3>,
                h4: ({ children }) => <h4 className="my-2 font-semibold" id={headingId(contentText(children))}>{children}</h4>,
                h5: ({ children }) => <h5 className="my-2 font-semibold" id={headingId(contentText(children))}>{children}</h5>,
                h6: ({ children }) => <h6 className="my-2 font-semibold" id={headingId(contentText(children))}>{children}</h6>,
                ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
                ol: ({ children, start }) => <ol className="my-2 list-decimal pl-5" start={start}>{children}</ol>,
                blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-[var(--border-primary)] pl-3 italic text-[var(--text-tertiary)]">{children}</blockquote>,
                table: ({ children }) => <div className="my-4 overflow-x-auto"><table className="w-full border-collapse text-sm">{children}</table></div>,
                th: ({ children }) => <th className="border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-left font-semibold">{children}</th>,
                td: ({ children }) => <td className="border border-[var(--border-primary)] px-3 py-2">{children}</td>,
            }}>{markdown}</ReactMarkdown>
    </div>;
}
