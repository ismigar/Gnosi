export { transclusionSourceRange as transclusionRange } from '../../../../shared/editor/vault-markdown/transclusionModel';

export interface TransclusionRange { start: number; end: number }

export function replaceTransclusion(source: string, range: TransclusionRange, content: string): string {
    const suffix = source.slice(range.end);
    if (/^[ \t]*\^/u.test(suffix)) return source.slice(0, range.start) + content.trimEnd() + ' ' + suffix.trimStart();
    const separator = suffix && !suffix.startsWith('\n') && content && !content.endsWith('\n') && !/^[ \t]*\^/u.test(suffix) ? '\n' : '';
    return source.slice(0, range.start) + content + separator + suffix;
}
