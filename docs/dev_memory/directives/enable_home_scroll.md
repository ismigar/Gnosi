# Directiva: Habilitar Scroll Vertical a la Home

## Objectiu
Habilitar el desplaçament vertical a la pàgina d'inici (Home) i assegurar que l'àrea de contingut principal de l'aplicació pugui gestionar contingut que superi l'alçada de la finestra visual (viewport).

## Context
L'aplicació és un dashboard en React. Actualment, diversos nivells de la capa visual (`App.jsx` i la classe CSS `.home-page`) tenen `overflow: hidden`, cosa que impedeix el scroll fins i tot quan les targetes del dashboard superen l'alçada de la pantalla.

## Lògica / Passos
1. **Contenidor Principal de Layout**: Canviar el contenidor de contingut principal a `App.jsx` de `overflow-hidden` a `overflow-y-auto`. Això permetrà que qualsevol pàgina que superi l'alçada pugui fer scroll.
2. **Estils Específics de Component**: A `index.css`, localitzar la classe `.home-page` i canviar `overflow: hidden` a `overflow-y: auto`.
3. **Consistència**: Verificar que `min-height: 100vh` permet al contingut empènyer el contenidor de scroll correctament.

## Restriccions i Advertències
- No canviis el `overflow: hidden` del `body` ni del contenidor exterior `h-screen` de l'App, ja que mantenen la Sidebar fixa.
- Assegura't que la Sidebar es mantingui fixa i no es desplaci amb el contingut.
- Compte amb pàgines com `GraphPage` que poden dependre d'un contenidor de mida fixa; haurien de seguir funcionant si el seu contingut intern és exactament el 100% de l'alçada.

## Verificació
- Provar visualment que apareix la barra de scroll a la Home quan hi ha prou targetes.
- Confirmar que la Sidebar no es mou en fer scroll.
