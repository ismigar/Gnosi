# Plugins d'exemple de Gnosi (v2)

Plugins de tercers de referència per al sistema de plugins de Gnosi. Veure la
directiva `docs/dev_memory/directives/plugin_system.md`.

## Instal·lació

Copia la carpeta del plugin a `<vault>/.gnosi/plugins/`:

```sh
cp -R hello-command "<vault>/.gnosi/plugins/"
```

Després, a **Configuració → Plugins → Plugins de tercers**: activa'l i concedeix
els permisos que demana. Fins que no aprovis els permisos, el plugin no fa res
(model de seguretat: tot inert per defecte).

## Exemples

| Plugin | Tipus | Què fa |
|--------|-------|--------|
| `hello-command` | UI (iframe sandbox) | Afegeix la comanda «Hola des del plugin d'exemple» a la paleta (Cmd/Ctrl+Shift+P). Permisos: `ui:command`, `vault:read`. |
| `clone-logger` | Dades (Node sandbox) | Reacciona a `clone:finished` i `page:updated` i ho registra. Permisos: `vault:read`. |

## Anatomia d'un plugin

- `manifest.json` — obligatori: `id`, `version`, `permissions[]`. UI: `main` (entry JS).
  Dades: `backend` (entry .mjs) + `events[]` (esdeveniments subscrits).
- **UI**: el codi corre en un iframe aïllat i només accedeix a l'objecte global
  `gnosi` (`registerCommand`, `registerView`, `registerSidebarPanel`, `vault.*`, `fetch`, `log`).
- **Dades**: exporta `onEvent(event, api)`; corre en un subprocés Node capat i
  toca el vault via `api.vault.*` (tot gated pels permisos concedits).

Els permisos declarats al manifest són el MÀXIM que l'usuari pot concedir; sense
concessió, l'API corresponent no existeix per al plugin.
