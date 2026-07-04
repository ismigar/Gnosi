# Rename Vault to Knowledge

## Context
Hem rebatejat la component que engloba la Base de Dades (BD) i la Wiki. Abans s'anomenava **Vault**, però ara aquest terme s'utilitzarà per referir-se a tot el sistema (el contenidor global). La component específica de dades i documents ara s'anomena **Knowledge** (Coneixement).

## Propositiu
Mantenir la coherència visual i terminològica a tota l'aplicació, assegurant que l'usuari vegi "Knowledge" (o la seva traducció) en lloc de "Vault" quan es refereixi a la secció de BD i Wiki.

## Procediment de Traducció
- **Anglès (en)**: Knowledge
- **Català (ca)**: Coneixement
- **Castellà (es)**: Conocimiento
- **Francès (fr)**: Connaissance

## Restriccions i Regles
- No canviar claus de traducció si no és estrictament necessari per evitar trencar la UI, a menys que es faci un refactoring complet de les referències al codi.
- Prioritzar el canvi dels valors (labels) que l'usuari veu.
- Si apareix "My Vault", canviar a "My Knowledge" (o traducció equivalent).

## Errors Comuns a Evitar
- No canviar "Vault" quan es refereix a la ruta del sistema (`vault_path`), ja que això podria afectar la persistència local si no es canvia també al backend. *Nota: En aquesta fase ens centrem en la terminologia de la component UI.*

## Actualització Multi-Vault (2026-07-04)
- **Hook Centralitzat (`useActiveVaultName.js`)**: S'ha creat el hook personalitzat `useActiveVaultName` que encapsula la lectura inicial de `localStorage` (`gnosi_active_vault_name`) per evitar parpellejos i la sincronització asíncrona amb `/api/vaults`. Aquest hook es comparteix a tot el frontend per garantir una única font de veritat visual sobre el vault actiu.
- **Capçaleres i Sidebars Globals**: Per tal que l'usuari sàpiga en tot moment en quin vault es troba independentment de l'aplicació oberta, s'ha integrat el badge `Vault: {nom del vault}` a:
  - **Coneixement (`VaultSidebar.jsx`)**: Al capdamunt de la barra lateral.
  - **Graf de Coneixement (`Layout.jsx`)**: Al costat del títol principal de la barra superior.
  - **Gestor de Mitjans (`MediaCenter.jsx`)**: Al costat del títol de la capçalera.
  - **Correu (`MailSidebar.jsx`)**: Al capdamunt de la barra lateral d'inbox.
  - **Capçalera Estàndard (`AppHeader.jsx`)**: De forma nativa per a totes les pantalles que la utilitzen (**Control Center / Dashboard**, **Calendari**, **Contactes**, **Lector de Feeds** i vistes de taules/docs a pantalla completa).
  - **Resta de pantalles**: **Home Page** (`/`), **Social Dashboard** (`/social-dashboard`), **Task Scheduler** (`/scheduler`) i **Composer** (`/composer`).
- **Prevenció de Parpelleig (No-flicker)**: El nom del vault actiu es desa a `localStorage` sota la clau `gnosi_active_vault_name` cada cop que es consulta `/api/vaults` o es canvia de vault a `VaultMenu` o `VaultSwitcher`. Així, en recarregar la pàgina, qualsevol component inicialitza l'estat de forma síncrona sense canvis bruscos de text.
