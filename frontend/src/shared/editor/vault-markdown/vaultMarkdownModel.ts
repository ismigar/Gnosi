import { Children, isValidElement, type ReactNode } from 'react';


export interface CitationEvidence {
    readonly kind?: string;
    readonly label?: string;
    readonly segment?: Readonly<{ readonly text?: string }>;
    readonly source_url?: string;
}


function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}


export function latexFencesToMath(markdown: string): string {
    return markdown.replace(
        /```(?:latex|math)\n([\s\S]*?)\n```/g,
        (_match, body: string) => `\n$$\n${body.trim()}\n$$\n`,
    );
}


export function reactNodeText(children: ReactNode, fallback: string): string {
    const text = Children.toArray(children)
        .map((child) => {
            if (typeof child === 'string' || typeof child === 'number') {
                return String(child);
            }
            return isValidElement<{ readonly children?: ReactNode }>(child)
                ? reactNodeText(child.props.children, '')
                : '';
        })
        .join('');
    return text || fallback;
}


export function citationEvidence(value: unknown): CitationEvidence | null {
    if (!isRecord(value)) return null;
    const segmentValue = value.segment;
    const segment = isRecord(segmentValue) && typeof segmentValue.text === 'string'
        ? { text: segmentValue.text }
        : undefined;
    return {
        ...(typeof value.kind === 'string' ? { kind: value.kind } : {}),
        ...(typeof value.label === 'string' ? { label: value.label } : {}),
        ...(segment ? { segment } : {}),
        ...(typeof value.source_url === 'string' ? { source_url: value.source_url } : {}),
    };
}
