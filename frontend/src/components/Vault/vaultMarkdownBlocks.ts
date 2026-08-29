const TOGGLE_START_RE = /^:{3,}(toggle-heading|toggle)(?:\s|(?=\{)|$)(.*)$/;
const FENCE_RE = /^(`{3,}|~{3,})/;

type MarkdownInput =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined;

type ToggleBlockType = 'toggle-heading' | 'toggle';

interface ToggleHeader {
  label: string;
  level: number;
  type: ToggleBlockType;
}

interface MarkdownBlock {
  content: string;
  type: 'markdown';
}

interface ToggleBlock extends ToggleHeader {
  children: VaultMarkdownBlock[];
}

type VaultMarkdownBlock = MarkdownBlock | ToggleBlock;

interface ParseRangeResult {
  blocks: VaultMarkdownBlock[];
  nextIndex: number;
}

function parseToggleHeader(line: string): ToggleHeader | null {
  const match = line.trim().match(TOGGLE_START_RE);
  if (!match) return null;

  const type: ToggleBlockType =
    match[1] === 'toggle-heading' ? 'toggle-heading' : 'toggle';
  const rawLabel = (match[2] ?? '').trim();
  const levelMatch = rawLabel.match(/\{level=(\d+)\}/);
  const level = Math.min(
    6,
    Math.max(1, Number(levelMatch?.[1] || 1)),
  );
  const label =
    type === 'toggle-heading'
      ? rawLabel.replace(/\{level=\d+\}/, '').trim()
      : rawLabel;

  return { type, label, level };
}

/** Splits Vault Markdown into ordinary fragments and custom toggle fences. */
export function parseVaultMarkdownBlocks(
  markdown?: MarkdownInput,
): VaultMarkdownBlock[] {
  const lines = String(markdown || '').split(/\r?\n/);

  const parseRange = (startIndex: number): ParseRangeResult => {
    const blocks: VaultMarkdownBlock[] = [];
    const markdownLines: string[] = [];
    let inCodeFence = false;
    let index = startIndex;

    const flushMarkdown = (): void => {
      if (markdownLines.length === 0) return;
      blocks.push({
        type: 'markdown',
        content: markdownLines.join('\n'),
      });
      markdownLines.length = 0;
    };

    while (index < lines.length) {
      const line = lines[index] ?? '';
      const trimmed = line.trim();

      if (FENCE_RE.test(trimmed)) {
        inCodeFence = !inCodeFence;
        markdownLines.push(line);
        index += 1;
        continue;
      }

      if (!inCodeFence && /^:{3,}$/.test(trimmed)) {
        flushMarkdown();
        return { blocks, nextIndex: index + 1 };
      }

      const toggle = !inCodeFence ? parseToggleHeader(line) : null;
      if (toggle) {
        flushMarkdown();
        const childResult = parseRange(index + 1);
        blocks.push({ ...toggle, children: childResult.blocks });
        index = childResult.nextIndex;
        continue;
      }

      markdownLines.push(line);
      index += 1;
    }

    flushMarkdown();
    return { blocks, nextIndex: index };
  };

  return parseRange(0).blocks;
}
