import type { VaultPageHistoryVersion } from '../../../shared/api/vault-history';


export type HistoryDiffKind = 'added' | 'removed' | 'unchanged';


export interface HistoryDiffLine {
    readonly kind: HistoryDiffKind;
    readonly line: string;
}


export interface HistoryDiffSummary {
    readonly added: number;
    readonly removed: number;
}


function contentLines(value: string | null | undefined): string[] {
    return (value ?? '').split('\n');
}


export function pageHistoryDiffSummary(
    previous: string | null | undefined,
    current: string | null | undefined,
): HistoryDiffSummary {
    const before = new Set(contentLines(previous).filter(Boolean));
    const after = new Set(contentLines(current).filter(Boolean));
    return {
        added: [...after].filter((line) => !before.has(line)).length,
        removed: [...before].filter((line) => !after.has(line)).length,
    };
}


export function pageHistoryDiffLines(
    previous: string | null | undefined,
    current: string | null | undefined,
): HistoryDiffLine[] {
    const before = contentLines(previous);
    const after = contentLines(current);
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    return [
        ...before.filter((line) => line && !afterSet.has(line)).map((line) => ({
            kind: 'removed' as const,
            line,
        })),
        ...after.map((line) => ({
            kind: line && !beforeSet.has(line) ? 'added' as const : 'unchanged' as const,
            line,
        })),
    ];
}


export function nextOlderHistoryVersion(
    history: readonly VaultPageHistoryVersion[],
    selectedId: string,
): VaultPageHistoryVersion | null {
    const index = history.findIndex(({ id }) => id === selectedId);
    return index >= 0 ? history[index + 1] ?? null : null;
}
