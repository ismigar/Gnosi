# Directiva: Polyfill de `process` en Vite para Gnosi

## Contexto
D'algunes llibreries (ex. `@excalidraw/excalidraw`) requereixen l'objecte global `process` que no existeix de forma nativa en el navegador sota Vite. Això provoca un `ReferenceError: process is not defined`.

## Solució Implementada
S'ha d'utilitzar la propietat `define` a `vite.config.js` per substituir les referències a `process.env` en temps de compilació/servei.

### `vite.config.js`
```javascript
export default defineConfig(({ mode }) => {
  return {
    // ...
    define: {
      "process.env": "({})", // Polyfill segur
      global: "window",      // Polyfill per a llibreries legacy
    },
    // ...
  };
});
```

## Lliçons Apreses i Restriccions

> [!CAUTION]
> **React 19 i Excalidraw**: S'ha confirmat que la versió 0.17.6 d'Excalidraw **CRASHA** fatalment l'aplicació en React 19 degut a l'accés a `ReactCurrentDispatcher`. No s'ha de rehabilitar fins a actualitzar la llibreria o trobar un workaround per als dispatchers.

> [!WARNING]
> **BlockNote Multi-column**: Pot causar `Duplicate use of selection JSON ID` si s'utilitza amb certes configuracions d'HMR de Vite.

> [!IMPORTANT]
> **Ordre d'Imports en ESM**: En els fitxers `.jsx` sota Vite, els `import` han d'estar SEMPRE a la part superior. Posar codi executable (com `console.log` o `alert`) abans dels imports pot trencar l'avaluació del mòdul i provocar pantalles en blanc silencioses.

### Protocol de Depuració
1. Si hi ha pantalla en blanc, comprovar la consola per `ReferenceError`.
2. Si no hi ha errors però està en blanc, comprovar si hi ha un bucle de recàrrega (pestanya Network parpellejant).
3. Desactivar imports pesats (Excalidraw, BlockNote) un per un per identificar el bloquejador.
