# Directiva: Auto-grow de <textarea> sense saltar l'scroll

## Objectiu
Els `<textarea>` que creixen amb el contingut (vista codi del Vault, títol de
pàgina) no han de moure la posició d'scroll del document a cada tecla.

## Context del bug
Patró clàssic d'auto-grow:
```js
el.style.height = 'auto';
el.style.height = `${el.scrollHeight}px`;
```
`height:auto` col·lapsa el textarea un instant per poder mesurar el
`scrollHeight` real. Si el textarea és enmig d'un document llarg dins d'un
contenidor desplaçable, aquest col·lapse momentani fa que el navegador
reajusti l'scroll (persegueix el cursor / retalla el `scrollTop` contra
l'alçada encongida). Resultat: a cada caràcter la pàgina es desplaça i la
línia que s'edita va caient cap al capdavall de la pantalla.

## Solució (implementada)
`BlockEditor.jsx` → helpers de mòdul `getScrollableAncestor()` +
`autoGrowTextarea()`. Es desa el `scrollTop` de l'avantpassat desplaçable
abans de tocar l'alçada i es restaura just després, **dins del mateix tick**
(abans del paint → sense parpelleig).

Punts d'ús: l'efecte d'auto-grow de `MarkdownCodeEditor` (vista codi) i el de
`titleInputRef` a `EditorInner`.

## Restriccions / Edge cases
- NO fer `height:auto` + `scrollHeight` sense preservar l'scroll → causa el
  salt descrit → usar sempre `autoGrowTextarea()`.
- La restauració ha de ser síncrona dins del mateix `useEffect` (no
  `requestAnimationFrame` ni `setTimeout`): si es difereix, l'usuari veu el
  parpelleig.
- El contenidor desplaçable del Vault és un `div` amb `overflow-y-auto h-full`
  (a `VaultDashboard.jsx`), no la finestra. `getScrollableAncestor()` el
  troba pujant pel DOM; si no en troba cap, cau a `document.scrollingElement`.
- Qualsevol `<textarea>` nou amb auto-grow ha de reutilitzar
  `autoGrowTextarea()`, no recrear el patró cru.
