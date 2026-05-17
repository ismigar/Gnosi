# Directive: Bloqueig del Caret-Snap de ProseMirror al Dashboard

## Objectiu
A les pàgines de **dashboard** (pàgina sencera = un sol `gnosi_view`
atòmic dins de BlockNote), evitar que ProseMirror reposicioni l'scroll
a la posició del caret invisible cada vegada que l'usuari prem una
fletxa del teclat.

## Símptoma reportat
A Chrome, l'usuari fa scroll cap avall (uns 2000-2600 px), després
torna a pujar amb fletxes, i quan torna a baixar amb fletxes **el
scroll salta al principi de la vista**. Stack capturat empíricament a
una sessió real:

```
HTMLDivElement.set
  ← scrollRectIntoView   (prosemirror-view chunk)
  ← EditorView.scrollToSelection
```

A Safari/Firefox no es manifesta amb la mateixa cruesa (Safari no
implementa scroll anchiring, Firefox té un comportament de
`scrollToSelection` menys agressiu).

## Causa
A un dashboard, el caret de ProseMirror viu just abans/després del
bloc atòmic `gnosi_view` (és invisible per a l'usuari però existeix a
l'estructura del document). ProseMirror dispara `scrollToSelection` a
cada tecla per mantenir el caret visible. Si l'usuari ha scrollejat
lluny visualment, ProseMirror considera el caret "off screen" i salta
de cop a la seva posició.

## Implementació
A `monorepo/apps/gnosi/frontend/src/components/Vault/DbViewEmbed.jsx`,
`FeedRender` instal·la un override del setter d'`scrollTop` a la
**instància** del contenidor desplaçable (no a `Element.prototype`):

```js
useLayoutEffect(() => {
    const scroller = getScrollableAncestor(containerRef.current);
    if (!scroller || scroller === document.scrollingElement) return;
    const protoDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    if (!protoDesc?.set || !protoDesc?.get) return;
    const origSet = protoDesc.set;
    const origGet = protoDesc.get;
    Object.defineProperty(scroller, 'scrollTop', {
        configurable: true,
        get: origGet,
        set(v) {
            const cur = origGet.call(this);
            if (Math.abs(v - cur) > 300) {
                const stack = new Error().stack || '';
                if (/scrollToSelection|scrollRectIntoView/.test(stack)) {
                    return;  // caret-snap de ProseMirror — descartat
                }
            }
            origSet.call(this, v);
        },
    });
    return () => { try { delete scroller.scrollTop; } catch (e) {} };
}, []);
```

## Restriccions i casos límit
- **Override per instància, no global**. NO tocar `Element.prototype`
  — afectaria tots els scroll containers de l'app.
- **Filtre per stack + magnitud**. Només es descarten salts >300 px
  originats per `scrollToSelection`/`scrollRectIntoView`. Els ajustos
  petits del caret quan edites text legítimament (p. ex. una pàgina
  hibrida amb `gnosi_view` embegut dins de text normal) passen sense
  tocar.
- **Llindar de 300 px**. Discrimina entre "el caret està una mica fora
  del límit del viewport" (ajust legítim) i "ProseMirror m'arrossega
  2000 px enrere" (caret-snap molest). Si en algun moment cal afinar,
  és una sola constant.
- **NO instrumentar el setter manualment a la consola del navegador**:
  un `Object.defineProperty` sobre `scrollTop` des de DevTools
  **sobreescriu aquest fix**. Si cal observar canvis d'scroll per
  debug, usar `addEventListener('scroll', ..., {passive:true})` que NO
  trenca l'override.
- **Cleanup amb `delete scroller.scrollTop`** al desmuntar perquè la
  classe d'`Element.prototype` torni a actuar.

## Validació
1. `vite build` ✓, eslint ✓ (el `set` no pot retornar valor — només
   `origSet.call(this, v);` sense `return`).
2. Test manual a Chrome:
   - Verificar fix instal·lat: `Object.getOwnPropertyDescriptor(document.querySelector('div.overflow-y-auto.min-w-0'),'scrollTop')` ha de retornar `{get, set, configurable:true, ...}`.
   - Reproduir ↓↓↓ ↑↑↑ ↓: l'scroll s'ha de mantenir, no saltar al principi.
3. Test no-regressió a Firefox (no es manifestava): scroll segueix funcionant igual.

## Per què (decisió arrel)
El bug no és cap dels nostres fixes (#105 textarea, #111 scroll
preservation, #115/#116 cache, #117 local-file). És comportament
intern de ProseMirror/BlockNote. **No es pot resoldre a nivell de CSS
ni de React state**: ProseMirror crida `scrollTop` directament sobre
el contenidor. L'única intervenció possible és **interceptar la
cridada al setter**.

Alternatives descartades:
- **Disable `scrollToSelection` via API de BlockNote**: BlockNote no
  exposa cap opció per desactivar-ho.
- **Posar `tabindex=-1` al ProseMirror**: trencaria l'edició legítima
  d'altres notes.
- **Blur del ProseMirror al scroll**: trencaria l'edició si l'usuari
  està escrivint mentre desplaça.

## PR relacionada
- #118 — `fix(vault/feed-embed): bloca el caret-snap de ProseMirror al contenidor del dashboard`
