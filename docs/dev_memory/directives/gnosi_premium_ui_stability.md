# Directiva: Estabilitat de la Interfície Premium de Gnosi

Aquesta directiva estableix els estàndards per mantenir la UI "Premium" de Gnosi i evitar regressions a versions obsoletes de "Digital Brain".

## 1. Branding Oficial
- **Nom del Producte**: Gnosi (MAI "Digital Brain").
- **Logo**: El logotip quadrat amb la lletra "G" (definida a `AppSidebar.jsx`).
- **Títols**: 
    - Home: "Gnosi"
    - Dashboard: "Gnosi Control Center"

## 2. Jerarquia de Rutes (App.jsx)
- **Ruta Arrel (`/`)**: SEMPRE ha d'apuntar al component `HomePage`.
- **Dashboard (`/dashboard`)**: S'ha d'utilitzar com a panell de monitorització tècnica, no com a pàgina d'aterratge inicial.

## 3. Neteja de Codi Llegat
L'existència de fitxers duplicats és la causa principal d'errors. S'ha de seguir aquest criteri:
- **Sidebar**: Utilitzar `AppSidebar.jsx`. Eliminar `Sidebar.jsx` si encara existeix.
- **Pàgina Principal**: `HomePage.jsx` és la moderna. `Dashboard.jsx` és per a monitorització.

## 4. Estils i Disseny Premium
- **CSS**: Qualsevol canvi d'estat ha de ser compatible amb les variables de `index.css` (gradients, glassmorphism).
- **Icones**: Totes les icones de la sidebar han de tenir una mida uniforme de **20px**.

## 5. Protocol de Verificació (QA)
Abans de donar una tasca per finalitzada:
1. Executar `npm run build` al frontend per verificar dependències i tipus.
2. Comprovar visualment que el logo és la "G" quadrada.
3. Verificar que la ruta `/` carrega la `HomePage`.

---
*Nota: Aquesta directiva és d'obligat compliment per a tots els agents que operin en el monorepo de Gnosi.*
