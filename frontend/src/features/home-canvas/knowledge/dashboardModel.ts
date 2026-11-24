import { commonmarkLanguage } from '@codemirror/lang-markdown';
import { blocksToRichMarkdown } from '../../../shared/editor/markdown-mapper/serialize-blocks';
import { extractSectionMarkdown, listSectionReferences } from '../../../shared/editor/vault-markdown/transclusionModel';

type View = Readonly<Record<string, unknown>>;
export interface BoardView { readonly kind: 'view'; readonly key: string; readonly label: string; readonly view: View }
interface BoardText { readonly kind: 'text'; readonly key: string; readonly markdown: string }
export type BoardPart = BoardText | BoardView;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function readFence(content: string): View {
  try {
    const value: unknown = JSON.parse(content);
    return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
  } catch { return {}; }
}

const DEF_COMMENT_RE = /<!--\s*gnosi-view:def\s+(\{[\s\S]*?\})\s*-->(?:\s*<!--\s*gnosi-view:result[\s\S]*?<!--\s*\/gnosi-view:result\s*-->)?/gu;

function boardParts(markdown: string, sections: readonly View[], includeLegacySections: boolean): BoardPart[] {
  const result: BoardPart[] = [];
  const occurrences = new Map<string, number>();
  let offset = 0;
  const addText = (end: number) => {
    const body = markdown.slice(offset, end).replace(/^(?:[ \t]*\r?\n)+|(?:\r?\n[ \t]*)+$/gu, '');
    if (body.trim()) result.push({ kind: 'text', key: `text-${String(offset)}`, markdown: body });
  };
  const addView = (view: View) => {
    const label = text(view.displayTitle) || text(view.heading) || text(view.name);
    const sectionId = text(view.section_id);
    const viewId = text(view.view_id);
    const binding = sectionId ? `section:${sectionId}` : viewId ? `view:${viewId}` : `inline:${label || text(view.source_table_id)}`;
    const count = occurrences.get(binding) ?? 0;
    occurrences.set(binding, count + 1);
    result.push({ kind: 'view', key: `view:${JSON.stringify([binding, count])}`, label, view });
  };

  interface ViewToken {
    from: number;
    to: number;
    payload: View;
  }
  const tokens: ViewToken[] = [];

  commonmarkLanguage.parser.parse(markdown).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return;
      const info = node.node.getChild('CodeInfo');
      if (!info || markdown.slice(info.from, info.to).trim() !== 'gnosi-view') return false;
      const code = node.node.getChild('CodeText');
      const fence = readFence(code ? markdown.slice(code.from, code.to) : '');
      tokens.push({ from: node.from, to: node.to, payload: fence });
      return false;
    },
  });

  DEF_COMMENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DEF_COMMENT_RE.exec(markdown)) !== null) {
    tokens.push({
      from: match.index,
      to: match.index + match[0].length,
      payload: readFence(match[1] ?? ''),
    });
  }

  tokens.sort((a, b) => a.from - b.from);

  for (const token of tokens) {
    if (token.from < offset) continue;
    addText(token.from);
    const fence = token.payload;
    const bound = (fence.section_id && sections.find(section => section.section_id === fence.section_id))
      || (fence.view_id && sections.find(section => section.view_id === fence.view_id && section.heading === fence.heading))
      || (fence.view_id && sections.find(section => section.view_id === fence.view_id))
      || (!fence.view_id && fence.heading && sections.find(section => !section.view_id && section.heading === fence.heading));
    addView({ ...(typeof bound === 'object' && bound ? bound : {}), ...fence });
    offset = token.to;
  }

  addText(markdown.length);
  // Older dashboards store their entire view layout under registry.pages.
  if (!occurrences.size && includeLegacySections) sections.forEach(addView);
  return result;
}

function dashboardMarkdown(body: string): string {
  if (/^\s*\{\s*\}\s*$/u.test(body)) return '';
  if (body.trimStart().startsWith('[')) {
    try {
      const blocks: unknown = JSON.parse(body);
      if (Array.isArray(blocks) && blocks.every((block: unknown) => block && typeof block === 'object' && 'type' in block)) {
        return blocksToRichMarkdown(blocks);
      }
    } catch { /* A Markdown paragraph may also start with a bracket. */ }
  }
  return body;
}

export function dashboardLayout(body: string, sections: readonly View[]) {
  const markdown = dashboardMarkdown(body);
  const parts = boardParts(markdown, sections, true);
  const headings = listSectionReferences(markdown).filter(ref => !ref.target.startsWith('^'));
  const choices = [
    ...headings.map(ref => ({ key: `heading:${ref.target}`, label: ref.label, viewId: '' })),
    ...parts.filter((part): part is BoardView => part.kind === 'view').map(part => ({ key: part.key, label: part.label, viewId: text(part.view.view_id) })),
  ];
  return {
    choices,
    partsFor(key: string): BoardPart[] | null {
      if (!key) return parts;
      if (key.startsWith('heading:')) {
        const fragment = extractSectionMarkdown(markdown, key.slice('heading:'.length));
        return fragment === null ? null : boardParts(fragment, sections, false);
      }
      const found = parts.find(part => part.key === key);
      return found ? [found] : null;
    },
  };
}
