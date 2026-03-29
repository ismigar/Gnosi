# Directiva: Correció de Regressions de Props en VaultViewHeader

Aquesta directiva documenta la necessitat d'assegurar que tots els components que renderitzen `VaultViewHeader` passin la totalitat de props necessàries per al funcionament de la barra d'eines de configuració.

## Context
S'ha detectat un error `TypeError: setShowLayout is not a function` en fer clic al botó de "Vista" (Layout) quan s'obre una taula a través d'una pestanya al `VaultDashboard`. Això és fruit de que el component `VaultViewHeader` rep `setShowLayout` com a prop i la crida, però aquesta no ha estat passada pel component pare.

## Procediment Correctiu
1. **Verificar Props en el Pare**: Cada vegada que s'afegeixi una nova funcionalitat de toggle (com `showLayout`, `showSort`, `showFilters`, `showGroup`) al `VaultViewHeader`, cal assegurar-se que TOTS els llocs on es renderitza (actualment `VaultDashboard.jsx` - 2 llocs, i `BlockEditor.jsx`) estiguin actualitzats amb l'estat i el setter corresponent.
2. **Estat Compartit**: Al `VaultDashboard`, s'ha de fer servir l'estat global del header (`headerShowLayout`, `setHeaderShowLayout`, etc.) per mantenir la coherència visual.
3. **Casos d'Incrustació (Embedded)**: En components com `BlockEditor` on de moment la configuració és limitada, s'ha de passar almenys un no-op (`() => {}`) per evitar el crash, o idealment implementar un estat local.

## Restriccions
- No utilitzar operadors de "optional chaining" en crides a funcions de props de toggle si s'espera que el component pare les gestioni SEMPRE. És preferible que el pare les passi explícitament per evitar comportaments on el botó "no fa res" sense que hi hagi un error a la consola. Tot i això, en aquest cas, `VaultViewHeader` ho cridava directament.

## Validació
- Obrir una taula existent com a pestanya.
- Activar el botó "CONFIGURACIÓ".
- Tocar cada un dels botons de la barra secundària: Vista, Ordenació, Filtres, Grup, Propietats.
- Cap d'ells ha de causar un error a la consola.
