import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  type EditorState,
} from '@tiptap/pm/state';
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from '@tiptap/pm/view';

import type { Speller } from './nspellManager';


export interface SpellcheckContext {
  readonly enabled: boolean;
  readonly ignored?: ReadonlySet<string>;
  readonly speller?: Speller | null;
}


export interface SpellError {
  readonly from: number;
  readonly to: number;
  readonly word: string;
}


interface RecomputeMeta {
  readonly recompute: true;
}


export const spellPluginKey = new PluginKey<DecorationSet>('gnosiSpellcheck');

const WORD_RE = /[\p{L}·'’]+/gu;
const APOSTROPHE_RE = /['’]/;


function isRecomputeMeta(value: unknown): value is RecomputeMeta {
  return value !== null
    && typeof value === 'object'
    && 'recompute' in value
    && value.recompute === true;
}


function isCorrect(speller: Speller, word: string): boolean {
  try {
    return speller.correct(word);
  } catch {
    return true;
  }
}


function buildDecorations(
  document: ProseMirrorNode,
  context: SpellcheckContext | null | undefined,
): DecorationSet {
  if (!context?.enabled || !context.speller) return DecorationSet.empty;
  const { ignored, speller } = context;
  const decorations: Decoration[] = [];

  document.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    WORD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WORD_RE.exec(text)) !== null) {
      const token = match.at(0);
      if (!token) continue;
      const tokenStart = match.index;
      let offset = 0;
      for (const part of token.split(APOSTROPHE_RE)) {
        const partStart = tokenStart + offset;
        offset += part.length + 1;
        if (
          part.length < 2
          || /\d/.test(part)
          || part === part.toUpperCase()
          || ignored?.has(part.toLowerCase()) === true
          || isCorrect(speller, part)
        ) continue;
        const from = position + partStart;
        decorations.push(Decoration.inline(
          from,
          from + part.length,
          { class: 'gnosi-spell-error' },
          { word: part },
        ));
      }
    }
  });

  return DecorationSet.create(document, decorations);
}


export function createSpellcheckPlugin(
  getContext: () => SpellcheckContext | null | undefined,
): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: spellPluginKey,
    props: {
      decorations(state) {
        return spellPluginKey.getState(state) ?? DecorationSet.empty;
      },
    },
    state: {
      apply(transaction, previous) {
        const meta: unknown = transaction.getMeta(spellPluginKey);
        if (isRecomputeMeta(meta)) {
          return buildDecorations(transaction.doc, getContext());
        }
        return transaction.docChanged
          ? previous.map(transaction.mapping, transaction.doc)
          : previous;
      },
      init(_config, state) {
        return buildDecorations(state.doc, getContext());
      },
    },
    view() {
      let timer: ReturnType<typeof setTimeout> | null = null;
      return {
        destroy() {
          if (timer !== null) clearTimeout(timer);
        },
        update(view: EditorView, previousState: EditorState) {
          if (view.state.doc.eq(previousState.doc)) return;
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            if (view.isDestroyed) return;
            view.dispatch(view.state.tr.setMeta(
              spellPluginKey,
              { recompute: true } satisfies RecomputeMeta,
            ));
          }, 500);
        },
      };
    },
  });
}


export function requestRecompute(view: EditorView | null | undefined): void {
  if (!view || view.isDestroyed) return;
  view.dispatch(view.state.tr.setMeta(
    spellPluginKey,
    { recompute: true } satisfies RecomputeMeta,
  ));
}


function decorationWord(value: unknown): string | null {
  return value !== null
    && typeof value === 'object'
    && 'word' in value
    && typeof value.word === 'string'
    ? value.word
    : null;
}


export function spellErrorAt(
  state: EditorState,
  position: number,
): SpellError | null {
  const decoration = spellPluginKey.getState(state)
    ?.find(position, position)
    .at(0);
  if (!decoration) return null;
  return {
    from: decoration.from,
    to: decoration.to,
    word: decorationWord(decoration.spec)
      ?? state.doc.textBetween(decoration.from, decoration.to),
  };
}
