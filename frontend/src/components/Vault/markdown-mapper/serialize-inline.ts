import { citationSentinelToHref } from '../../../lib/citationDeepLink';
import { logError } from '../../../lib/notifyError';
import {
    type InlineNode,
    type MarkdownBlock,
    type MarkdownSerializationContext,
    legacyStringOrEmpty,
    propsOf,
    stylesOf,
    toInlineArray,
} from './model';
import { sentinelToFileUrl } from './protocol';

export interface InlineSerializationOptions {
    readonly atLineStart?: boolean;
    readonly escape?: boolean;
}

function isMarkdownPunctuation(value: string | undefined): boolean {
    if (value === undefined) return false;
    const code = value.charCodeAt(0);
    return (code >= 33 && code <= 47)
        || (code >= 58 && code <= 64)
        || (code >= 91 && code <= 96)
        || (code >= 123 && code <= 126);
}

function isMarkdownSpace(value: string | undefined): boolean {
    return value === undefined || /\s/.test(value);
}

function escapeLeadingBlockMarker(line: string): string {
    const match = line.match(/^(\s*)([\s\S]*)$/);
    const whitespace = match?.[1] ?? '';
    let rest = match?.[2] ?? line;
    if (!rest) return line;
    if (rest[0] === '>') {
        rest = `\\${rest}`;
    } else if (/^[-+*]\s/.test(rest)) {
        rest = `\\${rest}`;
    } else if (/^\d{1,9}[.)]\s/.test(rest)) {
        rest = rest.replace(/^(\d{1,9})([.)])/, '$1\\$2');
    } else if (/^([-*_])\1{2,}\s*$/.test(rest)) {
        rest = `\\${rest}`;
    } else if (/^=+\s*$/.test(rest) || /^-+\s*$/.test(rest)) {
        rest = `\\${rest}`;
    }
    return whitespace + rest;
}

function escapeUnstyledMarkdown(text: string, atLineStart: boolean): string {
    if (!text) return text;
    let output = '';
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index] ?? '';
        if (character === '\\') {
            output += '\\\\';
            continue;
        }
        if (character === '`') {
            output += '\\`';
            continue;
        }
        const previous = index > 0 ? text[index - 1] : undefined;
        const next = index < text.length - 1 ? text[index + 1] : undefined;
        if (character === '~') {
            output += next === '~' || previous === '~' ? '\\~' : '~';
            continue;
        }
        if (character === '*' || character === '_') {
            const previousSpace = isMarkdownSpace(previous);
            const nextSpace = isMarkdownSpace(next);
            const previousPunctuation = isMarkdownPunctuation(previous);
            const nextPunctuation = isMarkdownPunctuation(next);
            const leftFlank = !nextSpace
                && (!nextPunctuation || previousSpace || previousPunctuation);
            const rightFlank = !previousSpace
                && (!previousPunctuation || nextSpace || nextPunctuation);
            const dangerous = character === '*'
                ? leftFlank || rightFlank
                : (leftFlank && (!rightFlank || previousPunctuation))
                    || (rightFlank && (!leftFlank || nextPunctuation));
            output += dangerous ? `\\${character}` : character;
            continue;
        }
        output += character;
    }
    output = output.replace(
        /(!?)\[([^[\]\n]*)]\(/g,
        (_match, bang: string, label: string) => `${bang}\\[${label}](`,
    );
    output = output.replace(
        /<(\/?[A-Za-z][^<>]*>|[A-Za-z][A-Za-z0-9+.-]*:[^<>\s]*>)/g,
        '\\<$1',
    );
    return atLineStart
        ? output.split('\n').map(escapeLeadingBlockMarker).join('\n')
        : output;
}

function wrapMarkedText(text: string, open: string, close = open): string {
    if (!text) return text;
    const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const leading = match?.[1] ?? '';
    const core = match?.[2] ?? text;
    const trailing = match?.[3] ?? '';
    return core ? `${leading}${open}${core}${close}${trailing}` : text;
}

function serializeTextNode(
    item: InlineNode,
    escape: boolean,
    atLineStart: boolean,
): { readonly markdown: string; readonly endsWithLineBreak: boolean } {
    if (typeof item.text !== 'string') {
        logError('markdown-mapper:inline-text', new Error('item.text is not a string'));
        return { markdown: '', endsWithLineBreak: false };
    }
    let text = item.text;
    const styles = stylesOf(item);
    const hasMark = Boolean(
        styles.bold || styles.italic || styles.underline || styles.strike || styles.code,
    );
    if (escape && !hasMark) text = escapeUnstyledMarkdown(text, atLineStart);
    const endsWithLineBreak = text.endsWith('\n');
    if (text.includes('\n')) text = text.replace(/\n/g, '<br>');
    if (styles.bold) text = wrapMarkedText(text, '**');
    if (styles.italic) text = wrapMarkedText(text, '*');
    if (styles.underline) text = wrapMarkedText(text, '<u>', '</u>');
    if (styles.strike) text = wrapMarkedText(text, '~~');
    if (styles.code) text = wrapMarkedText(text, '`');
    const textColor = styles.textColor;
    const backgroundColor = styles.backgroundColor;
    if ((textColor && textColor !== 'default')
        || (backgroundColor && backgroundColor !== 'default')) {
        let style = '';
        if (textColor && textColor !== 'default') {
            style += `color: ${legacyStringOrEmpty(textColor)};`;
        }
        if (backgroundColor && backgroundColor !== 'default') {
            style += `background-color: ${legacyStringOrEmpty(backgroundColor)};`;
        }
        text = `<span style="${style}">${text}</span>`;
    }
    return { markdown: text, endsWithLineBreak };
}

function serializeLink(
    item: InlineNode,
    context: MarkdownSerializationContext,
): string {
    let linkContent = item.content;
    if (linkContent && !Array.isArray(linkContent) && typeof linkContent !== 'string') {
        linkContent = [linkContent];
    }
    const innerText = inlineContentToMarkdown(linkContent, {}, context);
    const rawHref = typeof item.href === 'string' ? item.href : '';
    const safeHref = citationSentinelToHref(sentinelToFileUrl(rawHref));
    const finalHref = /[\s<>]/.test(safeHref) ? `<${safeHref}>` : safeHref;
    return `[${innerText}](${finalHref})`;
}

function serializeSpecialInline(
    item: InlineNode,
    context: MarkdownSerializationContext,
): string {
    const props = propsOf(item);
    if (item.type === 'link') return serializeLink(item, context);
    if (item.type === 'wikilink') {
        const target = legacyStringOrEmpty(props.target);
        const section = legacyStringOrEmpty(props.section);
        const title = legacyStringOrEmpty(props.title);
        const link = section ? `${target}#${section}` : target;
        return title && title !== link && title !== target
            ? `[[${link}|${title}]]`
            : `[[${link}]]`;
    }
    if (item.type === 'cite') {
        const key = legacyStringOrEmpty(props.citationKey);
        return key ? `[@${key}]` : '';
    }
    if (item.type === 'footnote') {
        const id = legacyStringOrEmpty(props.id);
        const key = id || `auto-${String(context.footnoteOrder.size + 1)}`;
        let number = context.footnoteOrder.get(key);
        if (!number) {
            number = context.footnoteOrder.size + 1;
            context.footnoteOrder.set(key, number);
            const body = legacyStringOrEmpty(props.content).replace(/\s*\n\s*/g, ' ').trim();
            context.footnoteDefinitions.push(`[^${String(number)}]: ${body}`);
        }
        return `[^${String(number)}]`;
    }
    if (item.type === 'mention') {
        const name = legacyStringOrEmpty(props.name).replace(/[|\]]/g, ' ').trim();
        const id = legacyStringOrEmpty(props.id).trim();
        return name || id ? `@[${name}|${id}]` : '';
    }
    if (item.type === 'dateref') {
        const date = legacyStringOrEmpty(props.date).trim();
        const time = legacyStringOrEmpty(props.time).trim();
        return date ? (time ? `@${date}T${time}` : `@${date}`) : '';
    }
    if (item.type === 'inlineIcon') {
        const value = legacyStringOrEmpty(props.value).trim();
        return value ? `{{gnosi-icon:${encodeURIComponent(value)}}}` : '';
    }
    return '';
}

export function inlineContentToMarkdown(
    content: unknown,
    options: InlineSerializationOptions = {},
    context: MarkdownSerializationContext,
): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    const nodes = toInlineArray(content);
    if (!nodes) return '';
    const escape = options.escape ?? true;
    let lineStart = options.atLineStart ?? false;
    return nodes.map((item) => {
        const nodeAtLineStart = lineStart;
        lineStart = false;
        if (item.type === 'text') {
            const serialized = serializeTextNode(item, escape, nodeAtLineStart);
            lineStart = serialized.endsWithLineBreak;
            return serialized.markdown;
        }
        return serializeSpecialInline(item, context);
    }).join('');
}

export function codeBlockText(block: MarkdownBlock): string {
    if (!block.content) return '';
    if (typeof block.content === 'string') return block.content;
    const content = toInlineArray(block.content);
    if (!content) return '';
    return content.map((item) => typeof item.text === 'string' ? item.text : '').join('');
}
