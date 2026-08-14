const TOGGLE_START_RE = /^:{3,}(toggle-heading|toggle)(?:\s|(?=\{)|$)(.*)$/;
const FENCE_RE = /^(`{3,}|~{3,})/;

function parseToggleHeader(line) {
    const match = line.trim().match(TOGGLE_START_RE);
    if (!match) return null;

    const type = match[1];
    const rawLabel = match[2].trim();
    const levelMatch = rawLabel.match(/\{level=(\d+)\}/);
    const level = Math.min(6, Math.max(1, Number(levelMatch?.[1] || 1)));
    const label = type === 'toggle-heading'
        ? rawLabel.replace(/\{level=\d+\}/, '').trim()
        : rawLabel;

    return { type, label, level };
}

/**
 * Splits Vault Markdown into ordinary Markdown fragments and the custom toggle
 * fences used by the editor. Code fences are treated as opaque, so an example
 * containing `:::toggle` is never rendered as an interactive preview control.
 */
export function parseVaultMarkdownBlocks(markdown) {
    const lines = String(markdown || '').split(/\r?\n/);

    const parseRange = (startIndex) => {
        const blocks = [];
        const markdownLines = [];
        let inCodeFence = false;
        let i = startIndex;

        const flushMarkdown = () => {
            if (markdownLines.length === 0) return;
            blocks.push({ type: 'markdown', content: markdownLines.join('\n') });
            markdownLines.length = 0;
        };

        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();

            if (FENCE_RE.test(trimmed)) {
                inCodeFence = !inCodeFence;
                markdownLines.push(line);
                i += 1;
                continue;
            }

            if (!inCodeFence && /^:{3,}$/.test(trimmed)) {
                flushMarkdown();
                return { blocks, nextIndex: i + 1 };
            }

            const toggle = !inCodeFence ? parseToggleHeader(line) : null;
            if (toggle) {
                flushMarkdown();
                const childResult = parseRange(i + 1);
                blocks.push({ ...toggle, children: childResult.blocks });
                i = childResult.nextIndex;
                continue;
            }

            markdownLines.push(line);
            i += 1;
        }

        flushMarkdown();
        return { blocks, nextIndex: i };
    };

    return parseRange(0).blocks;
}
