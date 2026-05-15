# Directive: Feed Entry Truncation ("Veure més")

## Objectiu
A les vistes de tipus **feed**, el cos d'una entrada llarga s'ha de retallar a
~25 línies i oferir un botó amb fletxa ("Veure més") per desplegar-lo i
("Veure menys") per tornar-lo a plegar. Replica el comportament de Notion.

## Abast
- La vista feed que renderitza el cos de l'entrada és `FeedItem` dins
  `monorepo/apps/gnosi/frontend/src/components/Vault/DbViewEmbed.jsx` (vista
  feed incrustada a les pàgines via blocs de base de dades).
- La vista feed de pantalla completa (`VaultFeed.jsx`) NO renderitza el cos de
  l'entrada (només portada, títol i propietats); no hi ha res a retallar i
  queda fora d'abast.

## Protocol d'implementació
1. **Llindar de col·lapse**: constant en píxels equivalent a ~25 línies del cos
   (`text-sm` 14px + `leading-relaxed` 1,625 ≈ 22,75px/línia → ~570px).
   Documentar el càlcul a la constant.
2. **Mesura**: el cos es mesura amb un element de referència NO retallat
   (`offsetHeight`). El retall (`max-height` + `overflow:hidden`) s'aplica a un
   contenidor pare, no a l'element mesurat — així el `ResizeObserver` continua
   veient l'alçada real quan les imatges del markdown carreguen tard.
3. **Botó**: fletxa avall ("Veure més") quan està plegat, fletxa amunt
   ("Veure menys") quan està desplegat. Només apareix si el cos supera el
   llindar.
4. **Degradat**: franja de degradat (`bg-primary` → transparent) a la part
   inferior del cos retallat per indicar que hi ha més contingut, amb
   `pointer-events-none` perquè no bloquegi els enllaços de sota.

## Restriccions i casos límit
- **No usar `-webkit-line-clamp`** per al retall: amb contingut markdown mixt
  (encapçalaments, llistes, imatges, cites) i `display:-webkit-box` el layout
  dels fills de bloc es trenca. Usar `max-height` + `overflow:hidden`.
- **No observar amb `ResizeObserver` l'element retallat**: si l'element té
  `max-height`, el seu border-box queda fixat i el `ResizeObserver` no dispara
  quan el contingut intern creix (imatges que carreguen tard). Observar sempre
  l'element de contingut sense retallar.
- L'estat de desplegament és efímer (per instància de `FeedItem`); no es
  persisteix — es reinicia si el bloc es remunta. És acceptable.

## Validació
1. `npm run build` i `npm run lint` sense errors.
2. Una entrada de feed amb cos > ~25 línies mostra el retall + botó "Veure més".
3. Una entrada curta NO mostra cap botó.
4. Clic a "Veure més" desplega tot el cos; clic a "Veure menys" el torna a
   plegar.
5. El retall no trenca wikilinks, imatges ni encapçalaments del markdown.
