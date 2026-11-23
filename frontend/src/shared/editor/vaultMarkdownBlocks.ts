import { normalizeCalloutType } from './markdown-mapper/protocol';

const TOGGLE_START_RE = /^:{3,}(toggle-heading|toggle)(?:\s|(?=\{)|$)(.*)$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

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

export interface MarkdownBlock {
  content: string;
  type: 'markdown';
}

export interface ToggleBlock extends ToggleHeader {
  children: VaultMarkdownBlock[];
}

type ContainerHeader =
  | { type: 'callout'; tone: string }
  | { type: 'column-list' }
  | { type: 'column'; width: number };

function parseContainer(line: string): ContainerHeader | null {
  const match = /^:{3,}(callout|column-list|column)(?:\s*\{([^}]*)\})?\s*$/u.exec(line);
  if (!match) return null;
  if (match[1] === 'column-list') return { type: 'column-list' };
  const props = match[2] ?? '';
  if (match[1] === 'callout') return { type: 'callout', tone: normalizeCalloutType(/\btype=([^\s}]+)/u.exec(props)?.[1]) };
  const width = Number(/\bwidth=([\d.]+)/u.exec(props)?.[1]);
  return { type: 'column', width: Number.isFinite(width) && width > 0 ? width : 1 };
}

export type VaultMarkdownBlock = MarkdownBlock | ToggleBlock | (ContainerHeader & { children: VaultMarkdownBlock[] });

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
    let codeFence: { marker: string; length: number } | null = null;
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

      const fence = FENCE_RE.exec(line);
      if (codeFence) {
        if (fence?.[1]?.[0] === codeFence.marker && fence[1].length >= codeFence.length && !fence[2]?.trim()) codeFence = null;
        markdownLines.push(line);
        index += 1;
        continue;
      }
      if (fence?.[1] && !(fence[1][0] === '`' && fence[2]?.includes('`'))) {
        codeFence = { marker: fence[1][0] ?? '`', length: fence[1].length };
        markdownLines.push(line);
        index += 1;
        continue;
      }

      if (/^:{3,}$/.test(trimmed)) {
        flushMarkdown();
        if (startIndex > 0) return { blocks, nextIndex: index + 1 };
        index += 1;
        continue;
      }

      const toggle = parseContainer(trimmed) ?? parseToggleHeader(line);
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
