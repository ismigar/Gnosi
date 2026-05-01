# Directiva: Resolució de claus foranes (relations) → títols

## Objectiu
Garantir que els camps de tipus `relation` mai mostrin l'ID en cru. Sempre han de mostrar el títol del registre referenciat.

## Arquitectura

El frontend manté un mapa `globalIndex` (variable d'estat a `VaultDashboard.jsx`, anomenat `idToTitle` als components fills) que tradueix `page_id → title`. Aquest mapa és la font única de veritat per renderitzar relacions.

El backend l'omple via `build_id_title_index()` a `vault_routes.py`, que recorre tot el VAULT i el DASHWORKS i retorna un diccionari complet. Es serveix a `GET /api/vault/global-index`.

## Principi obligatori: l'índex és **acumulatiu**, no s'esborra mai

Tots els punts d'escriptura de `globalIndex` han de fer **merge** amb l'estat anterior, mai substituir-lo:

```js
// Correcte
setGlobalIndex(prev => ({ ...prev, ...nuevasEntradas }));

// Incorrecte — destrueix entrades d'altres taules
setGlobalIndex(Object.fromEntries(...));
```

Restriccions/Edge cases:
- **No utilitzar `setGlobalIndex` amb un objecte literal**. Sempre amb funció d'updater (`prev => ...`).
- **Després de `fetchPagesByTable`** s'ha de cridar `fetchGlobalIndex()` per refrescar l'índex complet del backend, perquè les pàgines en memòria només cobreixen la taula activa.
- **Els components fills (`VaultTable`, `VaultGallery`, `VaultFeed`, `BlockEditor`)** mai han de derivar el seu propi mapping de títols a partir de `notes` o `pages` exclusivament. Han de rebre `idToTitle` per props.

## Fallbacks de renderitzat

Quan un ID no es troba al mapa (cas excepcional, p.ex. registre acabat de crear o pàgina externa):

- **Mode lectura:** Si el camp té `relation_database_id` configurat al schema, enriquir el `displayMap` amb les notes d'aquella taula relacionada (mateixa lògica que ja fa el mode edició a `VaultTable.jsx:937`).
- **Fallback final:** mostrar ID truncat (`it.substring(0, 8) + '…'`) — mai l'ID complet, que seria visualment confús.

### Helper unificat

Tots els components que renderitzen relacions (VaultTable, VaultGallery, VaultFeed) implementen una funció equivalent:

```js
const getRelationDisplayMap = (field) => {
    const config = getFieldConfig(schema, field);
    const relatedTableId = config?.relation_database_id;
    const relatedNotes = relatedTableId
        ? (allNotes || []).filter(n => {
            const nTableId = n.resolved_table_id || n.metadata?.table_id || n.metadata?.database_table_id;
            return nTableId === relatedTableId;
        })
        : [];
    return {
        ...idToTitle,
        ...Object.fromEntries(relatedNotes.map(n => [n.id, n.title || idToTitle[n.id] || n.id])),
    };
};
```

Per això han de rebre **el prop `allNotes`** (= `pages` complet de VaultDashboard, no només la taula activa).

## Flux esperat

1. `App` arrenca → `fetchGlobalIndex()` carrega l'índex complet.
2. Usuari navega a una taula → `fetchPagesByTable()` actualitza `globalIndex` (merge) i refresca des del backend.
3. `syncPagesState` afegeix entrades al `globalIndex` quan arriben pàgines noves (merge).
4. Cap operació esborra entrades pre-existents.

## Punts d'escriptura coneguts (`VaultDashboard.jsx`)

| Línia | Funció | Patró requerit |
|---|---|---|
| ~350 | `syncPagesState` | merge |
| ~479 | `fetchPagesByTable` | merge + crida a `fetchGlobalIndex` |
| ~643 | `fetchGlobalIndex` | substitució directa (és el reset autoritzat des de backend) |

## Tests manuals

Després de qualsevol canvi en aquesta àrea:
1. Navegar entre 2 taules amb relacions creuades.
2. Verificar que els pills de relacions mostren títols i no IDs en mode lectura, edició, galeria i feed.
3. Crear un registre nou i comprovar que es resol immediatament a títol als llocs on es referencia.
