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

- `apiVersion` (opcional, per defecte 1) — versió MAJOR de l'API que el plugin
  espera. Gnosi refusa instal·lar un plugin que en demani una de superior a la que
  implementa (`plugin_system.PLUGIN_API_VERSION`).

## Signatura i distribució (plugins remots)

Els plugins instal·lats des d'un **.zip remot** o des d'un **índex remot** poden
anar signats (Ed25519). Gnosi verifica la signatura contra el seu magatzem de
confiança abans d'instal·lar: signat i verificat → s'instal·la; signat però no
verificat → es rebutja; sense signatura → s'instal·la marcat com «no verificat».

Eina d'autor (`sign_plugin.py`, depèn només de `cryptography`):

```sh
# 1) genera un parell de claus (guarda la PRIVADA en un lloc segur)
python sign_plugin.py keygen

# 2) signa la carpeta del plugin → escriu el .zip i imprimeix l'entrada de catàleg
python sign_plugin.py sign el-meu-plugin <CLAU_PRIVADA_B64> \
    --url https://on-el-publiques/el-meu.zip --out el-meu.zip
```

L'usuari final afegeix la teva clau PÚBLICA al seu magatzem de confiança a
**Configuració → Plugins → Font remota i confiança** (o `POST /api/vault/plugins/trust`).

### Clau oficial de Gnosi

La clau pública `gnosi-official` ve integrada a `plugin_signing.BUNDLED_TRUSTED_KEYS`
(no cal afegir-la). La seva **privada** viu FORA del repo, a
`~/.gnosi-local/plugin_signing_key.json` (permisos 600), i s'usa per signar els
plugins oficials. Per rotar-la: `sign_plugin.py keygen`, substitueix la pública al
codi i desa la nova privada al mateix lloc.

### Distribució: índex remot signat (pipeline)

L'índex oficial de plugins es construeix i **se signa al pipeline de release**
(`.github/workflows/build-release.yml`, job `release`) amb `build_index.py`:

- La clau privada arriba pel secret **`GNOSI_PLUGIN_SIGNING_KEY`** (base64 de la
  clau Ed25519 crua) i **no toca mai el disc del repo**. Si no està configurada,
  l'índex es genera sense signatura (l'app els marcaria «no verificat»).
- Es publiquen, com a assets del release a `ismigar/Gnosi`, els `.zip` de cada
  plugin oficial i `plugins-index.json` (amb `url`, `sha256` i `signature`).
- Les entrades apunten a `releases/latest/download/…`, així que l'índex queda
  actiu un cop **publiques** el release (recorda: el workflow el crea en *draft*).

Configurar el secret un cop (des de la màquina amb la privada):

```sh
python3 -c "import json,pathlib;print(json.loads((pathlib.Path.home()/'.gnosi-local'/'plugin_signing_key.json').read_text())['private'])" \
  | gh secret set GNOSI_PLUGIN_SIGNING_KEY --repo ismigar/Projectes
```

L'usuari final apunta la galeria a l'índex des de **Configuració → Plugins → Font
remota i confiança**:
`https://github.com/ismigar/Gnosi/releases/latest/download/plugins-index.json`
(ja és el text suggerit del camp). Gnosi en verifica la signatura contra la clau
`gnosi-official` abans d'instal·lar.
