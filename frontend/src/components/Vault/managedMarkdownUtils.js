const MANAGED_START_RE = /^<!-- gnosi:llm-wiki:start [^\r\n]* -->$/;
const MANAGED_END_RE = /^<!-- gnosi:llm-wiki:end [^\r\n]* -->$/;
const FENCE_RE = /^\s*(```|~~~)/;

/**
 * Separates managed LLM Wiki markers from their Markdown content.
 *
 * BlockNote treats a list immediately following an HTML comment as paragraph
 * text. Adding a blank line at each managed boundary preserves block-level
 * constructs without changing the portable content stored in older pages.
 */
export const normalizeManagedBlockSpacing = (markdown) => {
    if (typeof markdown !== 'string' || !markdown.includes('<!-- gnosi:llm-wiki:')) {
        return markdown;
    }

    const lines = markdown.split('\n');
    const normalized = [];
    let inFence = false;

    lines.forEach((line, index) => {
        if (FENCE_RE.test(line)) {
            inFence = !inFence;
            normalized.push(line);
            return;
        }

        if (!inFence && MANAGED_END_RE.test(line) && normalized.at(-1)?.trim()) {
            normalized.push('');
        }

        normalized.push(line);

        if (
            !inFence
            && MANAGED_START_RE.test(line)
            && index + 1 < lines.length
            && lines[index + 1].trim()
        ) {
            normalized.push('');
        }
    });

    return normalized.join('\n');
};
