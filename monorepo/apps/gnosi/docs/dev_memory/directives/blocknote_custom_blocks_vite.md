# Directiva: Blocs Personalitzats de BlockNote i Compatibilitat amb Vite

## Context
En Gnosi, usem **BlockNote 0.47.1** per a l'editor de notes. Aquesta versió ha introduït canvis en la forma en què es defineixen els blocs personlitzats que poden entrar en conflicte amb el pre-bundling de **Vite 7.x**.

## Problema Detectat
L'ús de `createReactBlockSpec` i `BlockNoteSchema.create` a nivell top-level d'un mòdul (fora d'un component React) pot causar:
1. **Bloqueig del servidor Vite (Hang)**: Vite intenta pre-processar el codi al servidor per fer el bundle de dependències, i la lògica d'inicialització de BlockNote pot quedar encallada si no té un DOM real.
2. **TypeError al carregar**: Si s'oblida el patró de "factory function", Prosemirror fallarà al intentar llegir la propietat `.node` d'un objecte que és en realitat una funció.

## Regles d'Implementació (SOP)

### 1. Patró Factory Function
En BlockNote 0.47.x, `createReactBlockSpec` retorna una funció que ha de ser cridada per obtenir la `BlockSpec` final.
- **Incorrecte:** `database: DatabaseBlock`
- **Correcte:** `database: DatabaseBlock()`

### 2. Inicialització Lazy amb `useMemo`
Per evitar que Vite es pengi i assegurar l'estabilitat del schema, **sempre** defineix el schema dins d'un hook `useMemo` al component principal de l'editor.

```javascript
const schema = useMemo(() => {
    const MyCustomBlock = createReactBlockSpec({ ... }, { render: ... });
    return BlockNoteSchema.create({
        blockSpecs: {
            ...defaultBlockSpecs,
            myBlock: MyCustomBlock(),
        },
        // ... (inlineContentSpecs, styleSpecs)
    });
}, []);
```

### 3. Evitar Defaults Ambigus
Prosemirror i BlockNote poden fallar si els `propSchema` tenen valors per defecte que es comporten com strings buits però són `null` o `[]` (com a string).
- **Consell:** Usa strings buits (`""`) per a valors opcionals per evitar `TypeError: Cannot read properties of undefined (reading 'isInGroup')`.

## Manteniment
Si es canvia la versió de `@blocknote/core` o `@blocknote/react`, revisa si el retorn de `createReactBlockSpec` torna a ser un objecte directe en lloc d'una factory.
