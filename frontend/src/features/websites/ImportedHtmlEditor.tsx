import { createElement, useLayoutEffect, useRef, useState, type ReactNode, type ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Textarea } from './components';

const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'code', 'span', 'a', 'br', 'sub', 'sup']);
const TEXT_BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,figcaption,td,th';
const PRESERVED_ATTRIBUTES = ['class', 'id', 'name', 'lang', 'dir', 'title'] as const;

function safeHref(value: string): boolean {
  return !Array.from(value).some(character => character.charCodeAt(0) <= 32 || character === '\\') && (/^(?:https?:\/\/|mailto:|tel:|#[^#]|\/(?!\/))/iu.test(value));
}

function inlineNodes(nodes: NodeListOf<ChildNode>): ReactNode[] {
  return [...nodes].map((node, index) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (!(node instanceof Element)) return null;
    const tag = node.tagName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'img'].includes(tag)) return null;
    const children = inlineNodes(node.childNodes);
    if (!INLINE_TAGS.has(tag)) return children;
    const href = node.getAttribute('href') || '';
    // Source classes and IDs must survive edits without applying website CSS to Gnosi.
    const preserved = Object.fromEntries(PRESERVED_ATTRIBUTES.map(attribute => [`data-websites-${attribute}`, node.getAttribute(attribute) || undefined]));
    return createElement(tag, { key: index, ...preserved, ...(tag === 'a' && safeHref(href) ? { href } : {}) }, tag === 'br' ? undefined : children);
  });
}

function textElements(document: Document): Element[] {
  return [...document.body.querySelectorAll(TEXT_BLOCKS)].filter(element => !element.querySelector(`${TEXT_BLOCKS},img,picture,video,audio,iframe,object`));
}

function cleanInline(value: string, forEditor = false): string {
  const document = new DOMParser().parseFromString(value, 'text/html');
  for (const element of [...document.body.querySelectorAll('*')].reverse()) {
    const tag = element.tagName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'img'].includes(tag)) { element.remove(); continue; }
    if (tag === 'div' || tag === 'p') { element.replaceWith(document.createElement('br'), ...element.childNodes); continue; }
    if (!INLINE_TAGS.has(tag)) { element.replaceWith(...element.childNodes); continue; }
    const href = element.getAttribute('href') || '';
    const preserved = PRESERVED_ATTRIBUTES.map(attribute => [attribute, element.getAttribute(`data-websites-${attribute}`) ?? element.getAttribute(attribute)] as const);
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    for (const [attribute, value] of preserved) if (value) element.setAttribute(forEditor ? `data-websites-${attribute}` : attribute, value);
    if (tag === 'a' && safeHref(href)) element.setAttribute('href', href);
  }
  return document.body.innerHTML;
}

function EditableFragment({ html, label, onChange }: { html: string; label: string; onChange: (html: string) => void }) {
  const field = useRef<HTMLDivElement>(null);
  const [initial] = useState(() => inlineNodes(new DOMParser().parseFromString(html, 'text/html').body.childNodes));
  useLayoutEffect(() => {
    if (!field.current || window.document.activeElement === field.current || field.current.innerHTML === html) return;
    const safe = new DOMParser().parseFromString(cleanInline(html, true), 'text/html');
    field.current.replaceChildren(...safe.body.childNodes);
  }, [html]);
  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!event.currentTarget.contains(range.commonAncestorContainer)) return;
    range.deleteContents(); const fragment = window.document.createDocumentFragment();
    event.clipboardData.getData('text/plain').split(/\r?\n/u).forEach((line, index) => { if (index) fragment.appendChild(window.document.createElement('br')); fragment.appendChild(window.document.createTextNode(line)); });
    const last = fragment.lastChild;
    range.insertNode(fragment); if (last) range.setStartAfter(last); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    onChange(event.currentTarget.innerHTML);
  };
  return <div ref={field} role="textbox" aria-label={label} aria-multiline="true" contentEditable suppressContentEditableWarning className="websites-input websites-html-text" onClick={event => { if (event.target instanceof Element && event.target.closest('a')) event.preventDefault(); }} onInput={event => { onChange(event.currentTarget.innerHTML); }} onPaste={paste} onDrop={event => { event.preventDefault(); }}>{initial}</div>;
}

/** Edit text inside preserved layout wrappers; unedited markup remains byte-for-byte intact. */
export function ImportedHtmlEditor({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const { t } = useTranslation();
  const document = new DOMParser().parseFromString(value, 'text/html');
  const elements = textElements(document);
  const change = (index: number, html: string) => {
    const next = new DOMParser().parseFromString(value, 'text/html');
    const target = textElements(next)[index];
    if (!target || target.innerHTML === html) return;
    target.innerHTML = cleanInline(html);
    onChange(next.body.innerHTML);
  };
  return <div><div className="websites-list">{elements.map((element, index) => <EditableFragment key={index} html={element.innerHTML} label={`${label} ${String(index + 1)}`} onChange={html => { change(index, html); }} />)}</div>
    <details className="websites-spacer"><summary>{t('websites.visual.originalMarkup')}</summary><Textarea aria-label={t('websites.visual.originalMarkup')} value={value} onChange={event => { onChange(event.target.value); }} /></details>
  </div>;
}
