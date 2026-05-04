# Directiva: Modificació UI Sidebar Calendari

## Descripció
Aquesta directiva guia la modificació de la interfície d'usuari (UI) del sidebar lateral esquerre del calendari a Gnosi. L'objectiu és centralitzar les accions de gestió de calendaris en un encapçalament superior i netejar la part inferior del sidebar.

## Passos de la Operació
1. **Identificació del Component:** El component principal és `CalendarSidebarLeft.jsx`.
2. **Afegir Encapçalament de Secció:**
   - Inserir un `div` entre la línia de separació (`<hr />`) i la llista de fonts.
   - Utilitzar `flex justify-between` per al títol i el botó.
   - Traduir el títol "Calendaris" i el "tooltip" del botó "+" usant `i18next`.
3. **Gestió de Marges:**
   - Aplicar el marge horitzontal especificat (11px) al contenidor de la llista de fonts.
   - Usar classes de Tailwind arbitràries com `px-[11px]` per a precisió.
4. **Neteja de la Interfície:**
   - Eliminar qualsevol botó d'afegit redundant a la part inferior del sidebar per evitar confusió.
5. **Actualització de Traduccions:**
   - Assegurar que les noves claus de traducció s'afegeixen a `ca.json`, `es.json` i `en.json`.

## Restriccions i Casos de Bord
- **Transicions:** Assegurar que el botó "+" tingui una transició de color consistent amb la resta de la UI.
- **Truncament:** El títol de la secció hauria de ser curt per evitar problemes en mides de sidebar reduïdes.
- **Acció del Botó:** L'acció de disparar un `CustomEvent` anomenat `open-settings` és l'estàndard per obrir modals de configuració des de qualsevol lloc de l'app.
