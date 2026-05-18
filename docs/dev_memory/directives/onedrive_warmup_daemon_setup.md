# Directive: Arquitectura del OneDrive Warmup Daemon

## Objectiu

Documentar el setup robust del daemon `onedrive_warmup_daemon.py` perquè
sobrevisqui reboots, relaunch i actualitzacions de codi sense ritual manual.

## Components

| Component | Path | Funció |
|-----------|------|--------|
| Daemon (codi) | `monorepo/apps/gnosi/sh/onedrive_warmup_daemon.py` | Llegeix fitxers placeholder per disparar el File Provider macOS |
| Plist | `~/Library/LaunchAgents/com.gnosi.onedrive-warmup.plist` | Llança el daemon al login + KeepAlive |
| Script dev | `monorepo/apps/gnosi/sh/start_warmup_daemon.sh` | Per arrencar manualment durant desenvolupament |

## Setup correcte (verificat 2026-05-18)

### 1. Full Disk Access

Settings → Privacy & Security → Full Disk Access → `+` → afegir
**`/usr/bin/python3`** (Cmd+Shift+G al diàleg de Finder). Aquesta entrada
és compartida amb el `host_open_helper`, així que si aquell funciona, el
daemon també.

**No cal** afegir-hi `OneDriveWarmup.app` ni cap altre bundle. El plist
nou invoca `/usr/bin/python3` directament.

### 2. Plist

```xml
<key>ProgramArguments</key>
<array>
    <string>/usr/bin/python3</string>
    <string>/Users/<user>/Projectes/monorepo/apps/gnosi/sh/onedrive_warmup_daemon.py</string>
</array>

<key>EnvironmentVariables</key>
<dict>
    <key>ONEDRIVE_WARMUP_ALLOWED_ROOTS</key>
    <string>/Users/<user>/Library/CloudStorage/OneDrive-UNED</string>
    <key>ONEDRIVE_WARMUP_PORT</key>
    <string>5009</string>
    <key>ONEDRIVE_WARMUP_BIND</key>
    <string>0.0.0.0</string>
    <key>ONEDRIVE_WARMUP_TIMEOUT</key>
    <string>90</string>
</dict>
```

Punts clau:

- **Sense bundle `.app` intermediari.** TCC pot perdre permisos a un
  bundle adhoc-signed quan el codi es modifica (cas verificat: cada
  rebuild del wrapper feia perdre FDA i caldria reautoritzar). Llançant
  `/usr/bin/python3` directament hereta el FDA estable del binari.
- **`ONEDRIVE_WARMUP_ALLOWED_ROOTS`** (`:`-separat, com `$PATH`):
  substitueix la variable `VAULT_HOST_PATH` legacy que limitava el scope
  a una sola carpeta. El daemon ara accepta qualsevol fitxer dins de
  qualsevol root permès — necessari quan el Vault enllaça PDFs/imatges
  de carpetes germanes (`OneDrive-UNED/Documents`, etc.).
- **`KeepAlive=true`** al plist (reinicia si el procés mor).

### 3. Recàrrega

```bash
launchctl unload ~/Library/LaunchAgents/com.gnosi.onedrive-warmup.plist
pkill -f onedrive_warmup_daemon.py   # mata orfes que podrien retenir port 5009
launchctl load   ~/Library/LaunchAgents/com.gnosi.onedrive-warmup.plist
sleep 2
launchctl list | grep onedrive-warmup        # PID, no `-`
curl -s http://localhost:5009/healthz        # → {"status":"ok","allowed_roots":[...]}
```

## Diagnòstic per codi d'errno

Test directe (salta el backend Docker):

```bash
curl -s "http://localhost:5009/warmup?path=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "/abs/path/to/file.pdf")"
```

| Resposta | Causa | Acció |
|----------|-------|-------|
| `{"status": "materialized", ...}` | OK | — |
| `{"status": "out_of_scope", "allowed_roots": [...]}` | Path fora dels roots permesos | Estendre `ONEDRIVE_WARMUP_ALLOWED_ROOTS` al plist |
| `{"status": "read_error", "errno": 1, ...}` | EPERM: `/usr/bin/python3` no té FDA | Afegir `/usr/bin/python3` a Full Disk Access; relaunch |
| `{"status": "read_error", "errno": 11, ...}` (EDEADLK) | OneDrive no descarrega el placeholder | **Fora de Gnosi**: revisar estat del client OneDrive |
| `{"status": "read_error", "errno": 35, ...}` (EAGAIN) | OneDrive temporalment ocupat | Reintentar |
| `{"status": "timeout", ...}` | Descàrrega lenta (>90s) | Esperar; la propera crida pel mateix path sovint encerta |

## Antipattern: bundle `.app` adhoc-signed

L'antic plist invocava `~/Library/Application Support/Gnosi/OneDriveWarmup.app/Contents/MacOS/OneDriveWarmup`
(un wrapper bash amb signatura adhoc). Problema doble:

1. TCC tracta bundles adhoc-signed amb `Sealed Resources version=2 rules=13`
   com a "responsible process" del fitxer wrapper. Si el fitxer canvia
   (rebuild), TCC l'invalida i revoca FDA dels fills.
2. Quan el wrapper feia `exec /usr/bin/python3 ...`, el procés Python
   passava a ser el procés principal però mantenia el `responsible
   process` del bundle. Sense FDA al bundle, el python heretava la
   denegació tot i tenir el binari (`/usr/bin/python3`) autoritzat
   per separat.

L'usuari acabava havent d'afegir **ambdós** binaris al TCC i reautoritzar
després de cada actualització. El setup actual evita el problema d'arrel.

## Què no fer

- No tornar a empaquetar el daemon a un bundle `.app` per "ordre". Els
  bundles són útils només si la signatura és estable (Developer ID o
  Notarized) — l'adhoc no compleix la garantia de TCC.
- No barrejar amb `nohup`/`tmux`/Terminal manual com a workaround
  permanent. El plist actual ja és estable; si falla, és per FDA o
  per port ocupat per un procés orfe.
- No assumir que `errno 11`/`errno 35` són culpa del daemon. Vol dir
  que OneDrive està en estat dolent (pausat, sense xarxa, sense
  autenticació, o el File Provider no respon). Verifica obrint el
  fitxer amb Preview.app — si Preview tampoc el carrega, és OneDrive.

## Vegeu també

- [file_response_warmup_pattern.md](file_response_warmup_pattern.md) — patró
  obligatori per a endpoints del backend que serveixen fitxers físics.
- `feedback_onedrive_warmup_daemon.md` (memòria personal) — playbook
  d'incidents amb troubleshooting pas a pas.
