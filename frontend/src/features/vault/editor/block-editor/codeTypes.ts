import type { OutgoingPageLink } from './outgoingLinks';

export type CodeEditorMetadata = Record<string, unknown> & { title?: string };
export interface MarkdownCodeEditorProps {
    readonly noteFilename?: string | null;
    readonly initialContent?: unknown;
    readonly metadata?: CodeEditorMetadata | null;
    readonly idToTitle?: Readonly<Record<string, string>>;
    readonly onUpdate?: (id: string, content: string, patch: { metadata: CodeEditorMetadata; title: string }) => void;
    readonly onRefreshNotes?: () => void;
    readonly onOutgoingLinksChange?: (links: OutgoingPageLink[]) => void;
}

export interface MarkdownDraft {
    readonly source: string;
    readonly text: string;
    readonly dirty: boolean;
}

/** Keep the historical coercion for non-JSON primitive inputs at this boundary. */
function contentScalar(value: unknown): string {
    return String(value);
}

/** Coerce legacy payloads without displaying an accidental [object Object]. */
export function codeContent(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value == null) return '';
    if (typeof value === 'object') {
        const content: unknown = Reflect.get(value, 'content');
        if (typeof content === 'string') return content;
        try { return JSON.stringify(value, null, 2); } catch { return ''; }
    }
    return contentScalar(value);
}
