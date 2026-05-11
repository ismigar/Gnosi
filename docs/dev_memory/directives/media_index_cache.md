# DIRECTIVE: Filesystem-First Photo Manager + UI Unification

> ID: media-manager-filesystem-first-2026-05
> Associated Code: `monorepo/apps/gnosi/frontend/src/pages/MediaCenter.jsx`, `monorepo/apps/gnosi/frontend/src/components/GlobalSettingsModal.jsx`
> Last Update: 2026-05-09
> Status: ACTIVE

---

## 1. Objectius i Abast

Aquesta directiva documenta dues decisions de disseny aterrades al MediaCenter i una correcció al GlobalSettingsModal:

1. **Filosofia Finder-first** per al gestor fotogràfic: el sistema de fitxers (Finder al Mac) és la font de veritat per a operacions massives. La UI web es limita a visualització, cerca i edició de metadades.
2. **Capçalera unificada** amb la resta de pàgines del projecte (`AppHeader`) i amb un toggle de la barra lateral consistent amb MailList/CalendarPage.
3. **Fix de scroll** al modal de configuració: els controls de formulari natius (`<select>`, `<input>`, `<textarea>`) absorbien events `wheel` a Mac+Chrome i bloquejaven el scroll del modal.

### Què hi ha al main actualment (i NO es duplica)

- Cache de mèdia amb `pickle` + `os.scandir` + TTL 24h, persistit a `/app/data/media_cache` ([commit `a8c152459`](https://github.com/ismigar/Projectes/commit/a8c152459)).
- Lazy tree (`/api/vault/media/tree`) per navegació jeràrquica de ~33k carpetes.
- Warmup OneDrive via daemon host per a fitxers cloud-only.

Es manté tota aquesta feina ja existent. La proposta inicial de cache SQLite **s'arxiva** com a alternativa no implementada.

## 2. Decisions de disseny (Frontend)

### 2.1 Filosofia: Finder-first per a CRUD massiu

**Regla:** no afegir endpoints/UI per a operacions massives de fitxers (afegir en bloc, eliminar, reanomenar, moure, crear carpetes). L'usuari ho fa al Finder; el sistema detecta canvis automàticament (cache TTL o reindex).

**Per què:**
- macOS Finder ja fa això millor que qualsevol UI que poguem construir (drag&drop, multi-select, accés ràpid a tota la carpeta).
- Evita duplicar lògica que el SO ja resol.
- Redueix superfície d'API i de bugs.

**Botó "Penjar fitxer" (abans "Afegir Foto"): ELIMINAT de la UI** (2026-05-09).

Raons:
- Només pujava **un** fitxer a la vegada (UX pobre per a galeries).
- Destí ambigu: a `images` anava a l'àlbum actiu o a `General` si no n'hi havia; a `assets` sempre a `Assets/`. Confús.
- Contradiu el principi Finder-first.

**Endpoint `POST /api/vault/media/upload` es manté al backend** per a un futur ús (mòbil/remot). No es referencia des del frontend. Si es vol reintroduir, ha de ser amb drop-zone multi-fitxer condicionat a tenir un àlbum actiu i mostrar clarament la carpeta destí.

### 2.2 Capçalera unificada amb `AppHeader`

**Patró establert** (vist a `ContactsPage`, `CalendarPage`, `Dashboard`, `ReaderDashboard`):

```jsx
<div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
  <AppHeader icon={IconName} title="...">
    <div className="flex items-center gap-3">
      {/* Controls compactes: cerca h-7, píndoles bg-secondary p-0.5,
          botó primari bg-gnosi-blue h-7 text-[11px] uppercase */}
    </div>
  </AppHeader>
  <div className="flex-1 flex overflow-hidden">{/* sidebar + content */}</div>
</div>
```

**Aplicat al MediaCenter:**
- Substituït el `<header className="p-6 ...">` custom (icona-caixa gran, títol XL + subtítol) per `<AppHeader icon={ImageIcon} title="Gestor de Mitjans">`.
- Cerca: `rounded-full py-2 w-64` (~36px) → `h-7 rounded-md w-56 text-[12px]`.
- Toggle de vista (grid/llista): píndola `p-0.5` amb icones de 14px i estat actiu `text-[var(--gnosi-primary)] bg-[var(--gnosi-primary)]/10`.
- L'**indicador del root** (Images/Assets/Biblioteca/Vault) es trasllada a la barra de toggle del sidebar (sota la capçalera).

### 2.3 Toggle de la barra lateral

**Patró:** com a `MailList.jsx:891`, botó `PanelLeft` a la part superior de la columna principal (no al header), de manera que:
- Sidebar visible → toggle a la vora dreta del sidebar.
- Sidebar amagat → toggle a la zona superior-esquerra, sempre accessible per reobrir-lo.

**Implementació técnica (gotcha de flexbox):**
- Wrapper `<div>` amb `transition-[width] duration-300 ease-in-out overflow-hidden min-w-0` i `style={{ width: showLeftSidebar ? '16rem' : '0' }}`.
- `<aside>` interior manté `w-64` perquè el contingut no col·lapsi.
- **`min-w-0` és imprescindible**: per defecte els flex items tenen `min-width: auto`, que els impedeix encongir per sota del `min-content` dels seus fills. Sense `min-w-0`, `width: 0` no aplica.
- S'usa **estil inline** per al `width` perquè en aquest context (amb `transition-all`) Tailwind `w-0` condicional via template literal no sempre s'aplica correctament. L'inline garantitza el comportament.

## 3. Decisions de disseny (Scroll fix a `GlobalSettingsModal`)

### Bug

A Mac+Chrome, fer scroll amb la roda del ratolí sobre un `<select>`, `<input>` o `<textarea>` natiu dins del modal de configuració **no scrollejava** la capa pare (`.settings-main`). Depenia de la zona del modal on tenies el cursor.

### Causa

Els controls de formulari natius **absorbeixen** events `wheel`. Si el target no necessita scroll propi (ex. un `<select>` no focalitzat o un `<textarea>` amb contingut que cap), l'event es consumeix sense propagar-se al pare.

### Fix

`useEffect` que mentre el modal és obert instal·la un listener `wheel` en fase de captura al `document`. Quan el target és un `SELECT`/`INPUT`/`TEXTAREA` dins de `.settings-main` i el control no necessita el seu propi scroll, redirigeix `e.deltaY` al `.settings-main` i fa `preventDefault`.

```jsx
useEffect(() => {
  if (!isOpen) return;
  const handler = (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const main = t.closest('.settings-main');
    if (!main) return;
    const tag = t.tagName;
    if (tag !== 'SELECT' && tag !== 'INPUT' && tag !== 'TEXTAREA') return;
    if (tag === 'TEXTAREA' && t.scrollHeight > t.clientHeight + 1) return;
    if (main.scrollHeight > main.clientHeight) {
      main.scrollTop += e.deltaY;
      e.preventDefault();
    }
  };
  document.addEventListener('wheel', handler, { passive: false, capture: true });
  return () => document.removeEventListener('wheel', handler, { capture: true });
}, [isOpen]);
```

**Verificat empíricament**: abans del fix, `WheelEvent` simulat sobre el select deixava `main.scrollTop = 0`. Després, `main.scrollTop` s'incrementa amb `deltaY`. Textarea amb contingut scrollable propi no s'interfereix (el seu scroll intern continua funcionant).

## 4. Regla de projecte derivada: caches fora d'OneDrive

Tot index/cache/BD local que un servei del backend generi ha d'anar **fora del vault d'OneDrive**. Ubicacions recomanades:

- **Host path (compartit amb container)**: `${HOME_HOST_PATH}/.cache/gnosi/[component]/`. La home de l'usuari està bind-mountada al contenidor a `monorepo/apps/gnosi/docker-compose.yml`.
- **Container-local (efímer)**: `/app/data/cache/`. Persistent però gitignorable.

Llegeix `HOME_HOST_PATH` de l'entorn per construir la ruta dins del contenidor; fallback a `Path.home()` per a dev local sense Docker.

**Per què:**
- OneDrive corromp SQLite per conflictes de sync (crea còpies "(Conflict from <user>).db").
- Malgasta ample de banda i quota en dades regenerables.
- Pot disparar reindexacions falses tocant mtimes durant el sync.
- La opció "Trieu carpetes" d'OneDrive Mac no permet excloure subcarpetes ocultes, només carpetes de primer nivell.

**Excepció:** si en algun moment cal accés multi-dispositiu al cache, primer avaluar si SQLite és segur en xarxa o si cal una BD remota (PostgreSQL al servidor). No assumir mai que OneDrive és viable per a caches.

## 5. Què queda fora d'aquesta directiva (futurs)

- Multi-fitxer drop-zone si en algun moment es vol upload remot (mòbil).
- `DELETE /media` (operació pràctica per a quan no s'està al Mac).
- Edició de `date_taken` EXIF persistent (ara només sidecar JSON).

## 6. QA

- `npm run build` passa sense errors nous.
- Sintaxi JSX validada amb `@babel/parser`.
- Verificat live a `localhost:5173/media`: capçalera 47px, toggle a x=320 (vora dreta del sidebar), col·lapsa amb transició de 300ms a width=0.
- Verificat live el fix de scroll: wheel sobre `<select>` redirigeix correctament a `.settings-main.scrollTop`.
