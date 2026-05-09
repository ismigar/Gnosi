# Directiva: Redisseny minimalista del Lector

**Estat:** Staging
**Data:** 2026-05-09
**Relacionat amb:** #Reader #UX #Frontend

## Objectiu
Reduir el soroll visual del Lector mantenint la capçalera (`AppHeader`) i el sistema d'estils existents (Tailwind + variables CSS).

## Filosofia
"Reeder/Readwise": tipografia protagonista, un sol accent (`--gnosi-blue`), separadors *hairline* en lloc de targetes, accions secundàries *text-only*.

## Canvis a `apps/gnosi/frontend/src/pages/ReaderDashboard.jsx`

### 1. Header de la sidebar
- Treure `backdrop-blur-md sticky` (no aporta).
- `h2` de `text-xl font-bold` → `text-base font-semibold`.
- Subtítol amb comptador d'articles pendents (`text-xs text-slate-400`).
- Botó "Sincronitzar" surt cap al `AppHeader` via slot `children`.

### 2. Eliminar targeta del Podcast del top
- Treure el bloc gradient blau saturat (línies 154-186 originals).
- Es trasllada al peu de la sidebar com a barra discreta (vegeu §4).

### 3. Llista d'articles → hairline
- Items separats per `border-t border-slate-100`, sense fons ni `border-l-4`.
- Metadata en una línia: `Font · Data` (`text-xs text-slate-500`), sense píndoles ni colors.
- Títol: `text-[15px] font-medium leading-snug`.
- Estat seleccionat: barra absoluta de 2px en `bg-indigo-500` a l'esquerra + `font-semibold text-slate-900`. Cap fons.
- Acció "marcar llegit": fora del block visible — només accessible des del reader obert.

### 4. Podcast bar al peu de la sidebar
- Sticky bottom amb `border-t border-slate-200`, `bg-slate-50/60`.
- Si hi ha podcast: botó play (rodó, accent), text "Podcast diari · {data}", `<audio controls>` compacte amagat amb fallback.
- Si no n'hi ha: botó "Generar podcast diari" full-width discret.
- Si està generant: spinner + missatge de `podcastProgress`.

### 5. Reader (panell dret)
- `max-w-3xl` → `max-w-[640px]`.
- Píndola de data → `text-xs uppercase tracking-wider text-slate-500`.
- `text-3xl md:text-5xl font-extrabold` → `text-3xl md:text-4xl font-semibold` amb `tracking-tight`.
- Botons sòlids → enllaços text-only amb icona, `text-slate-500 hover:text-slate-900`.

### 6. Empty state
- Treure quadre rotat amb emoji.
- Una sola línia centrada: `Selecciona un article per llegir`.

## Iteració 2 — Tres columnes + tema fosc + agrupació temporal (2026-05-09)

### Tema clar/fosc
- Mecanisme del projecte: classe `dark` a `<html>` controlada per `localStorage.getItem('db-theme')` ('system' | 'dark' | 'light').
- Variables CSS aprofitades: `--bg-primary`, `--bg-secondary`, `--text-primary`, `--border-primary`, `--gnosi-blue`.
- Tailwind v4 té `@custom-variant dark (&:where(.dark, .dark *))` — modifier `dark:` funciona.
- Tots els colors hardcoded del component s'han substituït per variables o variants `dark:`.

### Agrupació temporal
- `useMemo` agrupa articles en cinc franges: Avui / Ahir / Aquesta setmana (≤7d) / Aquest mes (≤30d) / Anteriors.
- Headers `text-[10px] uppercase tracking-[0.1em]` (estil Reeder).
- Grups buits no es renderitzen.

### Tres columnes (canals · articles · reader)
- **Aprofitem** el camp `category` que ja existeix al model `FeedSource` i el filtre `source_id` ja existent a `/api/reader/articles`.
- **Cap canvi al backend**: l'agrupació per categoria es fa al frontend a partir de `GET /api/reader/sources`.
- **Layout desktop**: `w-60 (Canals) | w-[360px] (Articles) | flex (Reader)`.
- **Layout mòbil**: la columna de canals queda amagada per defecte (gestionable amb toggle en una iteració futura).
- **Estats nous**:
  - `sources` — array de fonts.
  - `selectedSourceId` — id de la font activa (`null` = "Tots").
  - `collapsedCategories` — Set de categories col·lapsades (per defecte totes obertes).
- **Comptadors d'unread per font**: calculats al frontend amb `useMemo` a partir de l'array `articles` (que ve unread_only).
- **Filtrat d'articles**: client-side amb `articles.filter(a => a.source_name === selectedSource.name)` per evitar refetch quan canvia la font (els articles ja són tots a memòria).
- Categories ordenades alfabèticament; "Sense categoria" sempre al final.
- Connexió al `FeedManagerModal` (que abans no s'obria enlloc) via botó "Gestionar fonts" al peu de la columna de canals.

## Iteració 3 — Traduccions, mobile drawer i OPML jeràrquic (2026-05-09)

### i18n
- Sistema existent: `i18next` + `react-i18next` amb fitxers plans a `src/locales/{ca,es,en,fr}/translation.json` (estructura no anidada).
- Afegides 33 claus `reader_*` als 4 idiomes (ca/es/en/fr).
- Pluralització explícita: `reader_articles_pending_one|other`, `reader_sources_count_one|other`.
- Format de dates segons locale: `LOCALE_MAP[i18n.language]` (`ca-ES` / `es-ES` / `en-US` / `fr-FR`).
- Helper `displayCategory()` mapeja `'Uncategorized'` (i variant catalana antiga `'Sense categoria'`) a `t('reader_uncategorized')` → es manté traducció correcta sigui quina sigui la cadena que retorni el backend.

### Mobile drawer per la columna de canals
- Estat `mobileChannelsOpen`. Botó icona `Menu` al `AppHeader` només `md:hidden`.
- Aside amb classes condicionals: desktop sempre `md:flex md:relative`, mobile `fixed inset-y-0 left-0 w-72 z-50 shadow-2xl` quan obert.
- Overlay `bg-black/40 z-40` només a mobile, clicable per tancar.
- Botó X (icon) al header del drawer per tancar manualment.
- `handleSelectSource()` tanca el drawer automàticament en seleccionar una font.

### OPML jeràrquic
- Backend: `apps/gnosi/backend/api/reader.py` — el parser ara construeix `parent_map = {child: parent for parent in tree.iter() for child in parent}` i puja per l'arbre fins trobar un ancestre `<outline>` que NO té `xmlUrl` (= carpeta) i en pren el `title`/`text` com a categoria.
- El monorepo (servit per Docker) **ja tenia aquesta millora com a WIP local no committat** abans d'aquesta iteració — mateix patró `parent_map`. Per no sobreescriure el WIP, el canvi només s'ha aplicat al worktree. En fer commit, el WIP del monorepo i aquest patch convergeixen.
- Limitació coneguda: només es captura el primer ancestre carpeta (`break` immediat). Per OPMLs amb carpetes anidades, prendrà la més pròxima — suficient per al cas comú però perd jerarquies multinivell.
- Després de canvis al backend Python cal **reiniciar el container Docker** (vegeu commit `5f04198b6`).

## Iteració 4 — Correcció de paths viu vs zombie (2026-05-09)

### Context de l'incidència
El repositori `Projectes` té dos arbres paral·lels que duplicaven `apps/gnosi/...`:
- `apps/gnosi/...` — **zombie** (legacy, "Sync from Projectes" del 6 abril; cap activitat recent).
- `monorepo/apps/gnosi/...` — **viu** (actiu; Docker monta `~/Projectes/monorepo/apps/gnosi/backend` segons `docker inspect gnosi_backend`).

Les iteracions 1-3 d'aquesta directiva van editar els zombies per error. La versió viva del worktree (`monorepo/apps/.../ReaderDashboard.jsx`) ja tenia funcionalitats modernes preexistents: `toast` (react-hot-toast wrapper), `iframe srcDoc + sandbox` per al renderitzat segur del HTML RSS, i un primer esbós de `selectedSourceId`/`showUnreadOnly`. El redisseny s'ha refet sobre la versió viva preservant aquestes funcionalitats.

### Què s'integra de la versió pre-existent
- `import { toast } from '../lib/toast'` per als errors (substitueix `alert(...)`).
- `iframe srcDoc` amb `sandbox="allow-same-origin allow-popups"` per a `selectedArticle.content` quan conté HTML — **mantenir sempre** (XSS prevention contra contingut RSS controlat per atacants).
- Filtre server-side per `source_id` mantingut: el `useEffect` de `fetchDisplayArticles()` té deps `[selectedSourceId, showUnreadOnly]`.

### Decisions noves
- **Dos fetchs separats**: `fetchDisplayArticles()` (filtrats) per la llista visible + `fetchUnreadCounts()` (sense filtres, només `unread_only=true`) per als comptadors per font. Això permet mantenir comptadors estables mentre canvies de font o entres en mode històric.
- **Toggle Pendents/Històric** com a botó icona `History` al header de la columna 2 (mida `text-xs`, accent quan està en mode "tot"). 5 claus de traducció afegides: `reader_show_pending`, `reader_show_history`, `reader_podcast_starting`, `reader_podcast_in_progress`, `reader_podcast_error`.
- Subtítol del comptador "X articles pendents" passa a comptar `displayArticles.length` (els filtrats), no `unreadArticles.length`.

### Restriccions / lessons learned
- Abans d'editar al backend o al frontend de Gnosi, **comprovar `docker inspect`** per saber quin path serveix Docker. Els paths `apps/gnosi/...` (sense prefix `monorepo/`) són zombies i NO afecten producció.
- En aquest repositori `Projectes`, l'estructura "viva" està a `monorepo/apps/...` i els worktrees tenen tot l'arbre, però només el subarbre `monorepo/` està servit.


- **No tocar AppHeader** (`AppHeader.jsx`) ni AppSidebar. La signatura `<AppHeader icon title>{children}</AppHeader>` és estable.
- **Preservar tota la lògica existent**: `pollingRef`, `generatePodcast`, `handleSyncAll`, `markAsRead`, `FeedManagerModal`. Cap canvi a endpoints.
- **Mobile**: mantenir `selectedArticle ? hidden md:flex : flex` per al sidebar i el back-button mòbil al reader.
- L'`<audio>` natiu HTML5 és lleig — el deixem `controls` per ara, amb `h-8 w-full` i `bg-transparent`. Iteració posterior: reproductor custom.

## QA
1. `npm run build` zero errors.
2. Browser test a `localhost`: comptador d'articles correcte, selecció funciona, podcast bar accessible, marcar llegit elimina l'article de la llista.
3. Comprovar que `FeedManagerModal` segueix obrint-se (encara que el botó d'obrir-lo no estava connectat al codi original — separat d'aquesta tasca).
