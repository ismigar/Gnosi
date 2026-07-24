import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useTranslation } from 'react-i18next';
import 'katex/dist/katex.min.css';
import { WikilinkInline } from './WikilinkInline';
import { WIKILINK_HREF_SENTINEL, STYLE_HREF_SENTINEL, CITE_HREF_SENTINEL, convertWikilinksToMd, convertInlineHtmlToMd, decodeStylePayload, wikilinkUrlTransform, normalizeAssetUrl } from './vaultMarkdownUtils';
import { openCitation } from '../../lib/fileResource';

/* -------------------------------------------------------------------------- */
/*  Equations inherited from Notion                                              */
/*  The Notion clone saves equation blocks as a ```latex fence (or ```math)*/
/*  because previously we didn't have native math. Now that we do, we convert them back to `$$…$$`    */
/*  so remark-math renders them. The rest of the fences (js, py…) remain untouched.  */
/* -------------------------------------------------------------------------- */
function latexFencesToMath(md) {
    return md.replace(
        /```(?:latex|math)\n([\s\S]*?)\n```/g,
        (_m, body) => `\n$$\n${body.trim()}\n$$\n`,
    );
}

/* -------------------------------------------------------------------------- */
/*  Image with retry (OneDrive Errno 35 → 503 until the file finishes downloading)     */
/* -------------------------------------------------------------------------- */
export function RetryableImage({ src, title, onClick }) {
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
                    // The backend starts the OneDrive download in the background and
                    // returns 503 instantly; we retry with backoff (capped at
                    // 4s) for up to ~2.5 min to cover the real latency of the
                    // downloaded before rendering and hiding the image.
                    if (attempt < 40) {
                        const delay = Math.min(500 * Math.pow(2, attempt), 4000);
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
/*  Markdown rendering of the Vault                                          */
/*  Shared between the feed (DbViewEmbed) and the preview pop-up.     */
/* -------------------------------------------------------------------------- */
/**
 * Renders Vault Markdown with the same treatment as the page:
 * clickable `[[…]]` wikilinks (with hover preview) and Assets images with retry.
 * Does not wrap with any container: the parent provides wrapper, classes, and ref if
 * it needs one (e.g. the feed measures the height for "See more").
 *
 * Props:
 *  - md: Markdown string to render.
 *  - onActivate: optional callback when clicking an image (typically opens the page).
 *  - imageTitle: fallback title/alt for the images.
 */
export function VaultMarkdown({ md, onActivate, imageTitle = '', vaultId }) {
    const { t } = useTranslation();
    const [evidence, setEvidence] = useState(null);
    const [evidenceLoading, setEvidenceLoading] = useState(false);

    const handleCitation = async (query) => {
        const resourceId = query.get('res');
        if (!resourceId) return;
        const citation = Object.fromEntries(query.entries());
        setEvidence(null);
        setEvidenceLoading(true);
        try {
            const result = await openCitation(resourceId, query.get('page'), { citation, t });
            if (result) setEvidence(result);
        } finally {
            setEvidenceLoading(false);
        }
    };

    return (
      <>
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            urlTransform={wikilinkUrlTransform}
            components={{
                // Inline images: we normalize the URL (Assets/... →
                // /api/vault/assets/...) and we use RetryableImage because
                // OneDrive sometimes returns 503 until it has the file downloaded.
                // `vaultId` forces the vault for assets on the shared
                // public page (the anonymous visitor has no vault in localStorage).
                img: ({ src = '', alt = '' }) => {
                    const norm = normalizeAssetUrl(String(src || ''), vaultId);
                    if (!norm) return null;
                    return <RetryableImage src={norm} title={alt || imageTitle || ''} onClick={onActivate} />;
                },
                h1: (props) => <h1 className="font-bold text-2xl text-[var(--text-primary)] my-2" {...props} />,
                h2: (props) => <h2 className="font-bold text-xl text-[var(--text-primary)] my-2" {...props} />,
                h3: (props) => <h3 className="font-semibold text-lg text-[var(--text-primary)] my-2" {...props} />,
                ul: (props) => <ul className="list-disc pl-5 my-2" {...props} />,
                ol: (props) => <ol className="list-decimal pl-5 my-2" {...props} />,
                blockquote: (props) => <blockquote className="pl-3 italic text-[var(--text-tertiary)] my-2" {...props} />,
                // If the href carries our wikilink sentinel, we render the
                // real component (clickable, with hover preview, context menu, etc.)
                // instead of an opaque anchor. The pre-conversion of `[[…]]` to
                // `[text](sentinel:target)` has already been done on `md` before parsing.
                a: ({ href = '', children, ...rest }) => {
                    // Text acolorit heretat (`<span style>` → sentinel `gnosi-style:`):
                    // we turn it back into a `<span>` with the color, without link styles.
                    if (typeof href === 'string' && href.startsWith(STYLE_HREF_SENTINEL)) {
                        return <span style={decodeStylePayload(href)}>{children}</span>;
                    }
                    if (typeof href === 'string' && href.startsWith(WIKILINK_HREF_SENTINEL)) {
                        let target;
                        try { target = decodeURIComponent(href.slice(WIKILINK_HREF_SENTINEL.length)); }
                        catch { target = href.slice(WIKILINK_HREF_SENTINEL.length); }
                        const text = React.Children.toArray(children)
                            .map(c => (typeof c === 'string' ? c : (c?.props?.children || '')))
                            .join('') || target;
                        return <WikilinkInline title={text} target={target} />;
                    }
                    // Citation links open the source and a persisted evidence
                    // paragraph/timestamp drawer.
                    if (typeof href === 'string' && href.startsWith(CITE_HREF_SENTINEL)) {
                        const qs = new URLSearchParams(href.slice(CITE_HREF_SENTINEL.length).replace(/^\?/, ''));
                        const res = qs.get('res');
                        return (
                            <a
                                href="#cite"
                                className="text-[var(--gnosi-primary)] hover:underline cursor-pointer"
                                onClick={(event) => {
                                    event.preventDefault();
                                    if (res) handleCitation(qs);
                                }}
                            >{children}</a>
                        );
                    }
                    return <a href={href} className="text-[var(--gnosi-primary)] hover:underline" {...rest}>{children}</a>;
                },
                // react-markdown v10 no longer passes the `inline` prop: we distinguish the
                // block code (fence with a language or multiline) from inline
                // by className/content. We also destructure className/node
                // so the `{...props}` spread doesn't overwrite our class
                // of styling (previously `language-js` overrode it → block with no styling).
                code: ({ className, children, node, ...props }) => {
                    const isBlock = /language-/.test(className || '') || String(children).includes('\n');
                    return isBlock
                        ? <code className="block p-2 rounded bg-[var(--bg-tertiary)] text-[12px] overflow-x-auto" {...props}>{children}</code>
                        : <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[12px]" {...props}>{children}</code>;
                },
            }}
        >
            {convertWikilinksToMd(convertInlineHtmlToMd(latexFencesToMath(md || '')))}
        </ReactMarkdown>
        {(evidence || evidenceLoading) && (
            <aside
                className="fixed right-4 bottom-4 z-[130] w-[min(420px,calc(100vw-2rem))] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4 shadow-2xl"
                role="dialog"
                aria-label={t('llm_wiki.evidence_title', "Citation evidence")}
            >
                <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-xs font-bold text-[var(--text-primary)]">
                            {t('llm_wiki.evidence_title', "Citation evidence")}
                        </div>
                        {evidence?.label && (
                            <div className="truncate text-[11px] text-[var(--text-tertiary)]">
                                {evidence.label}
                            </div>
                        )}
                    </div>
                    <button
                        type="button"
                        className="gnosi-close-btn"
                        aria-label={t('common.close', "Close")}
                        onClick={() => setEvidence(null)}
                    >
                        ×
                    </button>
                </div>
                {evidenceLoading && (
                    <p className="text-xs text-[var(--text-tertiary)]">
                        {t('llm_wiki.evidence_loading', "Loading excerpt…")}
                    </p>
                )}
                {evidence?.segment?.text && (
                    <mark className="block rounded-md bg-amber-200/40 p-3 text-xs leading-relaxed text-[var(--text-primary)]">
                        {evidence.segment.text}
                    </mark>
                )}
                {evidence?.source_url && (
                    <a
                        href={evidence.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-block text-xs text-[var(--gnosi-primary)] hover:underline"
                    >
                        {t('llm_wiki.evidence_open_original', "Open original source")}
                    </a>
                )}
            </aside>
        )}
      </>
    );
}

export default VaultMarkdown;
