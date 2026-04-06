# Directive: Controls de Física del Graf (Sigma/ForceAtlas2)

## Objectiu
Donar control a l'usuari sobre la distribució espacial del graf mitjançant paràmetres de simulació física.

## Arquitectura i Estabilitat (CRÍTIC)

### 1. Debouncing (Anti-Crash)
El worker de `ForceAtlas2` triga a reiniciar-se. Si enviem cada canvi del slider (centenars d'events per segon), el worker es satura i penja el navegador.
**SOLUCIÓ: Patró d'Estat Dual**
```javascript
// A GraphPage.jsx
const [gravityUI, setGravityUI] = useState(0.05); // Feedback instantani al slider
const [gravity, setGravity] = useState(0.05);     // Valor real pel worker
const [edgeInfluenceUI, setEdgeInfluenceUI] = useState(0); // 0 = Màxima dispersió

useEffect(() => {
    const timer = setTimeout(() => setGravity(gravityUI), 300); // Debounce 300ms
    return () => clearTimeout(timer);
}, [gravityUI]);

// Passeu 'gravity' a GraphViewer, NO gravityUI
```

### 2. Edge Weight Influence (Dispersió)
Per defecte, `ForceAtlas2` utilitza el pes de les arestes per atreure nodes. Si els pesos són alts (ex: 80-100), ni tan sols una repulsió màxima (50.000) separarà els nodes.
**SOLUCIÓ: Slider d'Influència**
- Afegir paràmetre `edgeWeightInfluence` a la configuració.
- **Valor 0:** Ignora pesos de les arestes (Crucial per efecte "Núvol" / "obsidian-like").
- **Valor 1:** Comportament normal.

### 3. Rangs Desbloquejats
Els valors per defecte de les llibreries són massa conservadors per a grafs grans o densos.
- **Repulsió (Scaling Ratio):** Permetre fins a **50.000** (o més).
- **Gravetat:** Permetre baixar fins a **0.00** (pas 0.01).

## Implementació Tècnica (GraphViewer.jsx)

```javascript
useEffect(() => {
    if (layoutRef.current) layoutRef.current.stop();

    const settings = {
        settings: {
            gravity: gravity,
            scalingRatio: repulsion, // Pot ser 50000+
            friction: friction,
            edgeWeightInfluence: edgeInfluence, // 0 = Màxima dispersió (cloud mode)
            // ...
        }
    };

    layoutRef.current = new ForceAtlas2(graph, settings);
    layoutRef.current.start();
}, [gravity, repulsion, friction, edgeInfluence]);
```

## Fitxers Relacionats
- `frontend/src/components/ForcesSection.jsx`
- `frontend/src/pages/GraphPage.jsx`
- `frontend/src/components/GraphViewer.jsx`
