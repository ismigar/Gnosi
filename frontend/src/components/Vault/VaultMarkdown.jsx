import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { WikilinkInline } from './WikilinkInline';
import { WIKILINK_HREF_SENTINEL, STYLE_HREF_SENTINEL, convertWikilinksToMd, convertInlineHtmlToMd, decodeStylePayload, wikilinkUrlTransform, normalizeAssetUrl } from './vaultMarkdownUtils';

/* -------------------------------------------------------------------------- */
/*  Equacions heretades de Notion                                              */
/*  El clon de Notion desa els blocs d'equació com a fence ```latex (o ```math)*/
/*  perquè abans no teníem math natiu. Ara que sí, els reconvertim a `$$…$$`    */
/*  perquè remark-math els renderitzi. La resta de fences (js, py…) intactes.  */
/* -------------------------------------------------------------------------- */
function latexFencesToMath(md) {
    return md.replace(
        /```(?:latex|math)\n([\s\S]*?)\n```/g,
        (_m, body) => `\n$$\n${body.trim()}\n$$\n`,
    );
}

/* -------------------------------------------------------------------------- */
/*  Imatge amb retry (OneDrive Errno 35 → 503 fins que el fitxer es baixa)     */
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
                    // El backend engega la baixada d'OneDrive en segon pla i
                    // retorna 503 a l'instant; reintentem amb backoff (sostre
                    // 4s) fins ~2,5 min per cobrir la latència real de la
                    // baixada abans de rendir-nos i amagar la imatge.
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
/*  Renderitzat de Markdown del Vault                                          */
/*  Compartit entre el feed (DbViewEmbed) i el pop-up de previsualització.     */
/* -------------------------------------------------------------------------- */
/**
 * Renderitza Markdown del Vault amb el mateix tractament que la pàgina:
 * wikilinks `[[…]]` clicables (amb hover preview) i imatges d'Assets amb retry.
 * No embolcalla amb cap contenidor: el pare aporta wrapper, classes i ref si
 * en necessita (p.ex. el feed mesura l'alçada per al "Veure més").
 *
 * Props:
 *  - md: string Markdown a renderitzar.
 *  - onActivate: callback opcional en clicar una imatge (típicament obrir la pàgina).
 *  - imageTitle: títol/alt de reserva per a les imatges.
 */
export function VaultMarkdown({ md, onActivate, imageTitle = '', vaultId }) {
    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            urlTransform={wikilinkUrlTransform}
            components={{
                // Imatges inline: normalitzem la URL (Assets/... →
                // /api/vault/assets/...) i fem servir RetryableImage perquè
                // OneDrive a vegades retorna 503 fins que té el fitxer descarregat.
                // `vaultId` força el vault dels assets a la pàgina compartida
                // pública (el visitant anònim no té vault a localStorage).
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
                // Si l'href porta el nostre sentinel de wikilink, renderitzem el
                // component real (clicable, amb hover preview, context menu, etc.)
                // en lloc d'un anchor opac. La preconversió de `[[…]]` a
                // `[text](sentinel:target)` ja s'ha fet sobre `md` abans del parse.
                a: ({ href = '', children, ...rest }) => {
                    // Text acolorit heretat (`<span style>` → sentinel `gnosi-style:`):
                    // el tornem a un `<span>` amb el color, sense estils de link.
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
                    return <a href={href} className="text-[var(--gnosi-primary)] hover:underline" {...rest}>{children}</a>;
                },
                // react-markdown v10 ja no passa la prop `inline`: distingim el
                // codi de bloc (fence amb llenguatge o multilínia) de l'inline
                // pel className/contingut. A més desestructurem className/node
                // perquè el spread `{...props}` no sobreescrigui la nostra classe
                // d'estil (abans `language-js` la trepitjava → bloc sense estil).
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
    );
}

export default VaultMarkdown;
