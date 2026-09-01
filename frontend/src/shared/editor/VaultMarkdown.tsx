import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { useTranslation } from 'react-i18next';
import 'katex/dist/katex.min.css';

import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { openCitation } from '../resources/fileResource';
import { WikilinkInline } from './WikilinkInline';
import {
    parseVaultMarkdownBlocks,
    type VaultMarkdownBlock,
} from './vaultMarkdownBlocks';
import {
    CITE_HREF_SENTINEL,
    STYLE_HREF_SENTINEL,
    WIKILINK_HREF_SENTINEL,
    convertInlineHtmlToMd,
    convertWikilinksToMd,
    decodeStylePayload,
    normalizeAssetUrl,
    wikilinkUrlTransform,
} from './vaultMarkdownUtils';
import { CitationEvidencePanel } from './vault-markdown/CitationEvidencePanel';
import { RetryableImage } from './vault-markdown/RetryableImage';
import {
    citationEvidence,
    latexFencesToMath,
    reactNodeText,
    type CitationEvidence,
} from './vault-markdown/vaultMarkdownModel';


interface VaultMarkdownProps {
    readonly idToTitle?: Readonly<Record<string, string>>;
    readonly imageTitle?: string;
    readonly md: string;
    readonly onActivate?: () => void;
    readonly onOpenInCurrentTab?: (pageId: string) => void;
    readonly onOpenInNewTab?: (pageId: string) => void;
    readonly onOpenParallel?: (pageId: string) => void;
    readonly vaultId?: string | null;
}


const MARKDOWN_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];
const HEADING_CLASSES: Readonly<Partial<Record<number, string>>> = {
    1: 'text-2xl font-bold',
    2: 'text-xl font-bold',
    3: 'text-lg font-semibold',
};


type MarkdownRenderer = (
    content: string,
    key: string,
    inline?: boolean,
) => ReactNode;


function renderVaultBlocks(
    blocks: readonly VaultMarkdownBlock[],
    path: string,
    renderMarkdown: MarkdownRenderer,
    toggleFallback: string,
): ReactNode {
    return blocks.map((block, index) => {
        const key = `${path}-${String(index)}`;
        if (block.type === 'markdown') return renderMarkdown(block.content, key);
        const headingClass = HEADING_CLASSES[block.level] ?? 'text-base font-semibold';
        return (
            <details className="vault-markdown-toggle" key={key} open>
                <summary>
                    <span
                        aria-level={block.type === 'toggle-heading' ? block.level : undefined}
                        className={`${headingClass} text-[var(--text-primary)]`}
                        role={block.type === 'toggle-heading' ? 'heading' : undefined}
                    >
                        {renderMarkdown(block.label || toggleFallback, `${key}-label`, true)}
                    </span>
                </summary>
                <div className="vault-markdown-toggle__content">
                    {renderVaultBlocks(
                        block.children,
                        `${key}-children`,
                        renderMarkdown,
                        toggleFallback,
                    )}
                </div>
            </details>
        );
    });
}


export function VaultMarkdown({
    md,
    idToTitle,
    imageTitle = '',
    onActivate,
    onOpenInCurrentTab,
    onOpenInNewTab,
    onOpenParallel,
    vaultId,
}: VaultMarkdownProps) {
    const { t } = useTranslation();
    const [evidence, setEvidence] = useState<CitationEvidence | null>(null);
    const [evidenceLoading, setEvidenceLoading] = useState(false);
    const evidenceRef = useRef<HTMLElement>(null);
    const citationRequestRef = useRef(0);

    const closeEvidence = useCallback((): void => {
        citationRequestRef.current += 1;
        setEvidence(null);
        setEvidenceLoading(false);
    }, []);
    useModalKeyboard({
        isOpen: evidence !== null || evidenceLoading,
        onClose: closeEvidence,
        containerRef: evidenceRef,
    });

    const handleCitation = useCallback(async (query: URLSearchParams): Promise<void> => {
        const resourceId = query.get('res');
        if (!resourceId) return;
        const requestId = citationRequestRef.current + 1;
        citationRequestRef.current = requestId;
        setEvidence(null);
        setEvidenceLoading(true);
        try {
            const result = await openCitation(resourceId, query.get('page'), {
                citation: Object.fromEntries(query.entries()),
                t,
            });
            if (citationRequestRef.current === requestId) {
                setEvidence(citationEvidence(result));
            }
        } finally {
            if (citationRequestRef.current === requestId) setEvidenceLoading(false);
        }
    }, [t]);

    const markdownComponents = useMemo<Components>(() => ({
        img: ({ src = '', alt = '' }) => {
            const normalized = normalizeAssetUrl(src, vaultId);
            return normalized
                ? <RetryableImage onClick={onActivate} src={normalized} title={alt || imageTitle} />
                : null;
        },
        h1: (props) => <h1 className="my-2 text-2xl font-bold text-[var(--text-primary)]" {...props} />,
        h2: (props) => <h2 className="my-2 text-xl font-bold text-[var(--text-primary)]" {...props} />,
        h3: (props) => <h3 className="my-2 text-lg font-semibold text-[var(--text-primary)]" {...props} />,
        ul: (props) => <ul className="my-2 list-disc pl-5" {...props} />,
        ol: (props) => <ol className="my-2 list-decimal pl-5" {...props} />,
        blockquote: (props) => <blockquote className="my-2 pl-3 italic text-[var(--text-tertiary)]" {...props} />,
        a: ({ href = '', children, ...rest }) => {
            if (href.startsWith(STYLE_HREF_SENTINEL)) {
                return <span style={decodeStylePayload(href)}>{children}</span>;
            }
            if (href.startsWith(WIKILINK_HREF_SENTINEL)) {
                const encodedTarget = href.slice(WIKILINK_HREF_SENTINEL.length);
                let target = encodedTarget;
                try {
                    target = decodeURIComponent(encodedTarget);
                } catch {
                    // Keep the raw target when a legacy URL contains malformed escapes.
                }
                return (
                    <WikilinkInline
                        idToTitle={idToTitle}
                        onOpenInCurrentTab={onOpenInCurrentTab}
                        onOpenInNewTab={onOpenInNewTab}
                        onOpenParallel={onOpenParallel}
                        target={target}
                        title={reactNodeText(children, target)}
                    />
                );
            }
            if (href.startsWith(CITE_HREF_SENTINEL)) {
                const query = new URLSearchParams(
                    href.slice(CITE_HREF_SENTINEL.length).replace(/^\?/, ''),
                );
                return (
                    <a
                        className="cursor-pointer text-[var(--gnosi-primary)] hover:underline"
                        href="#cite"
                        onClick={(event) => {
                            event.preventDefault();
                            if (query.has('res')) void handleCitation(query);
                        }}
                    >{children}</a>
                );
            }
            return <a className="text-[var(--gnosi-primary)] hover:underline" href={href} {...rest}>{children}</a>;
        },
        code: ({ className, children, node: _node, ...props }) => {
            const isBlock = /language-/.test(className ?? '')
                || reactNodeText(children, '').includes('\n');
            return isBlock ? (
                <code className="block overflow-x-auto rounded bg-[var(--bg-tertiary)] p-2 text-[12px]" {...props}>{children}</code>
            ) : (
                <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-[12px]" {...props}>{children}</code>
            );
        },
    }), [handleCitation, idToTitle, imageTitle, onActivate, onOpenInCurrentTab,
        onOpenInNewTab, onOpenParallel, vaultId]);

    const renderMarkdown = useCallback((content: string, key: string, inline = false): ReactNode => (
        <ReactMarkdown
            components={inline
                ? { ...markdownComponents, p: ({ children }) => <>{children}</> }
                : markdownComponents}
            key={key}
            rehypePlugins={REHYPE_PLUGINS}
            remarkPlugins={MARKDOWN_PLUGINS}
            urlTransform={wikilinkUrlTransform}
        >
            {convertWikilinksToMd(convertInlineHtmlToMd(latexFencesToMath(content))) ?? ''}
        </ReactMarkdown>
    ), [markdownComponents]);

    return (
        <>
            {renderVaultBlocks(
                parseVaultMarkdownBlocks(md),
                'root',
                renderMarkdown,
                t('editor.block_type_toggle', 'Toggle'),
            )}
            {evidence !== null || evidenceLoading ? (
                <CitationEvidencePanel
                    evidence={evidence}
                    loading={evidenceLoading}
                    onClose={closeEvidence}
                    panelRef={evidenceRef}
                />
            ) : null}
        </>
    );
}


export { RetryableImage } from './vault-markdown/RetryableImage';
export default VaultMarkdown;
