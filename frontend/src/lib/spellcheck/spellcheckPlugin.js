import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const spellPluginKey = new PluginKey('gnosiSpellcheck');

// @language-example: Unicode regex including the Catalan middle dot (l·l) and
// @language-example: apostrophes (l'home). We split by apostrophe to check each piece.
const WORD_RE = /[\p{L}·'’]+/gu;
const APOSTROPHE_RE = /['’]/;

/** Walks the document and marks the words the spell checker doesn't recognize. */
function buildDecorations(doc, ctx) {
    if (!ctx || !ctx.enabled || !ctx.speller) return DecorationSet.empty;
    const { speller, ignored } = ctx;
    const decos = [];

    doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        const text = node.text;
        let m;
        WORD_RE.lastIndex = 0;
        while ((m = WORD_RE.exec(text)) !== null) {
            const token = m[0];
            const tokenStart = m.index;
            let offset = 0;
            for (const part of token.split(APOSTROPHE_RE)) {
                const partStart = tokenStart + offset;
                offset += part.length + 1; // +1 = the separating apostrophe
                if (part.length < 2) continue;            // «l», «d», single-letter initials
                if (/\d/.test(part)) continue;            // alphanumeric codes
                if (part === part.toUpperCase()) continue; // sigles (PDF, HTTP)
                if (ignored && ignored.has(part.toLowerCase())) continue;
                const ok = (() => {
                    try {
                        return speller.correct(part);
                    } catch {
                        return true;
                    }
                })();
                if (ok) continue;
                const from = pos + partStart;
                decos.push(
                    Decoration.inline(from, from + part.length, { class: 'gnosi-spell-error' }, { word: part }),
                );
            }
        }
    });

    return DecorationSet.create(doc, decos);
}

/**
 * ProseMirror plugin that underlines misspellings. `getContext()` must return
 * `{ enabled, speller, ignored:Set }` — read lazily because the spell checker
 * loads asynchronously and can switch language on the fly.
 */
export function createSpellcheckPlugin(getContext) {
    return new Plugin({
        key: spellPluginKey,
        state: {
            init(_config, state) {
                return buildDecorations(state.doc, getContext());
            },
            apply(tr, old) {
                const meta = tr.getMeta(spellPluginKey);
                if (meta && meta.recompute) return buildDecorations(tr.doc, getContext());
                if (tr.docChanged) return old.map(tr.mapping, tr.doc);
                return old;
            },
        },
        props: {
            decorations(state) {
                return spellPluginKey.getState(state);
            },
        },
        // Full recalculation debounced while typing (`apply` only remaps).
        view() {
            let timer = null;
            return {
                update(view, prevState) {
                    if (view.state.doc.eq(prevState.doc)) return;
                    if (timer) clearTimeout(timer);
                    timer = setTimeout(() => {
                        timer = null;
                        if (view.isDestroyed) return;
                        view.dispatch(view.state.tr.setMeta(spellPluginKey, { recompute: true }));
                    }, 500);
                },
                destroy() { if (timer) clearTimeout(timer); },
            };
        },
    });
}

/** Forces an immediate recalculation (new language, dictionary loaded, word ignored…). */
export function requestRecompute(view) {
    if (!view || view.isDestroyed) return;
    view.dispatch(view.state.tr.setMeta(spellPluginKey, { recompute: true }));
}

/** Returns { from, to, word } of the misspelling covering `pos`, or null. */
export function spellErrorAt(state, pos) {
    const set = spellPluginKey.getState(state);
    if (!set) return null;
    const found = set.find(pos, pos);
    if (!found || !found.length) return null;
    const d = found[0];
    return { from: d.from, to: d.to, word: d.spec?.word || state.doc.textBetween(d.from, d.to) };
}
