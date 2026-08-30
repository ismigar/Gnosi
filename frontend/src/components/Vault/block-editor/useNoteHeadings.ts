import { useCallback, useRef } from 'react';
import { parseMarkdownHeading } from './markdownPreview';
import { fetchVaultPage } from '../../../shared/api/vaults';

export interface NoteHeading { readonly title: string; readonly level: number; readonly path: string; readonly kind: 'heading' | 'block'; readonly preview?: string; }

export function extractHeadingsFromMarkdown(markdown: string): NoteHeading[] {
        const text = markdown || '';
        const noCodeBlocks = text.replace(/```[\s\S]*?```/g, '');
        const lines = noCodeBlocks.split('\n');
        const parentStack: string[] = [];
        const seen = new Set<string>();
        const headings: NoteHeading[] = [];

        for (const line of lines) {
            const heading = parseMarkdownHeading(line);
            if (!heading) continue;

            parentStack[heading.level - 1] = heading.title;
            parentStack.length = heading.level;
            const path = parentStack.slice(0, Math.max(0, heading.level - 1)).join(' > ');
            const key = `${String(heading.level)}::${path.toLowerCase()}::${heading.title.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);

            headings.push({
                title: heading.title,
                level: heading.level,
                path,
                kind: 'heading',
            });

            const blockMatch = (line || '').match(/(?:^|\s)\^([a-zA-Z0-9_-]+)\s*$/);
            if (blockMatch?.[1]) {
                const blockId = (blockMatch[1] || '').trim();
                const blockKey = `block::${blockId.toLowerCase()}`;
                if (!seen.has(blockKey)) {
                    seen.add(blockKey);
                    const preview = (line || '').replace(/\s*\^[a-zA-Z0-9_-]+\s*$/, '').trim();
                    headings.push({
                        title: `^${blockId}`,
                        level: 0,
                        path: heading.title,
                        kind: 'block',
                        preview,
                    });
                }
            }
        }

        for (const line of lines) {
            const blockMatch = (line || '').match(/(?:^|\s)\^([a-zA-Z0-9_-]+)\s*$/);
            if (!blockMatch?.[1]) continue;
            const blockId = (blockMatch[1] || '').trim();
            const blockKey = `block::${blockId.toLowerCase()}`;
            if (seen.has(blockKey)) continue;
            seen.add(blockKey);
            const preview = (line || '').replace(/\s*\^[a-zA-Z0-9_-]+\s*$/, '').trim();
            headings.push({
                title: `^${blockId}`,
                level: 0,
                path: '',
                kind: 'block',
                preview,
            });
        }

        return headings;
}

export function useNoteHeadings() {
    const headingCacheRef = useRef(new Map<string, NoteHeading[]>());
    const headingInFlightRef = useRef(new Map<string, Promise<NoteHeading[]>>());
    return useCallback(async (noteId: string): Promise<NoteHeading[]> => {
        const safeId = (noteId || '').trim();
        if (!safeId) return [];

        if (headingCacheRef.current.has(safeId)) {
            return headingCacheRef.current.get(safeId) || [];
        }

        if (headingInFlightRef.current.has(safeId)) {
            return await headingInFlightRef.current.get(safeId) || [];
        }

        const request = (async () => {
            try {
                const response = await fetchVaultPage(safeId);
                const headings = extractHeadingsFromMarkdown(response.content || '');
                headingCacheRef.current.set(safeId, headings);
                return headings;
            } catch {
                headingCacheRef.current.set(safeId, []);
                return [];
            } finally {
                headingInFlightRef.current.delete(safeId);
            }
        })();

        headingInFlightRef.current.set(safeId, request);
        return await request;
    }, []);

}
