import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const spellPluginKey = new PluginKey('gnosiSpellcheck');

// Regex Unicode: seqüències de lletres, incloent el punt volat català (l·l) i
// els apòstrofs (l'home). Després partim per apòstrof per comprovar cada tros.
const WORD_RE = /[\p{L}·'’]+/gu;
const APOSTROPHE_RE = /['’]/;

/** Recorre el document i marca les paraules que el corrector no reconeix. */
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
                offset += part.length + 1; // +1 = l'apòstrof separador
                if (part.length < 2) continue;            // «l», «d», sigles d'una lletra
                if (/\d/.test(part)) continue;            // codis alfanumèrics
                if (part === part.toUpperCase()) continue; // sigles (PDF, HTTP)
                if (ignored && ignored.has(part.toLowerCase())) continue;
                let ok = false;
                try { ok = speller.correct(part); } catch { ok = true; }
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
 * Plugin ProseMirror que subratlla les faltes. `getContext()` ha de retornar
 * `{ enabled, speller, ignored:Set }` — es llegeix mandrós perquè el corrector
 * es carrega de forma asíncrona i pot canviar d'idioma en calent.
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
        // Recàlcul complet amb debounce mentre s'escriu (el `apply` només remapa).
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

/** Força un recàlcul immediat (idioma nou, diccionari carregat, paraula ignorada…). */
export function requestRecompute(view) {
    if (!view || view.isDestroyed) return;
    view.dispatch(view.state.tr.setMeta(spellPluginKey, { recompute: true }));
}

/** Retorna { from, to, word } de la falta que cobreix `pos`, o null. */
export function spellErrorAt(state, pos) {
    const set = spellPluginKey.getState(state);
    if (!set) return null;
    const found = set.find(pos, pos);
    if (!found || !found.length) return null;
    const d = found[0];
    return { from: d.from, to: d.to, word: d.spec?.word || state.doc.textBetween(d.from, d.to) };
}
