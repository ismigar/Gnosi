---
name: host_open_helper
description: Servei al host del Mac que obre fitxers/carpetes amb el Finder i cerca per nom amb Spotlight (mdfind) per al backend de Gnosi, que corre dins de Docker (sense accés al sistema gràfic ni a mdfind).
---

# Host Open Helper

## Què fa

Petit servei HTTP que escolta a `127.0.0.1:5099` i obre rutes locals amb
`open` (Mac), `xdg-open` (Linux) o `os.startfile` (Windows). El backend de
Gnosi (dins de Docker) el contacta via `host.docker.internal:5099` quan
l'usuari clica un enllaç `file://` al editor.

També exposa una cerca per nom (`/search`) que delega a Spotlight
(`mdfind`): el contenidor no té `mdfind`, i el seu `os.walk` recursiu sobre
OneDrive trigava segons. Spotlight, amb índex viu, torna en mil·lisegons.

## Endpoints

- `GET /healthz` — comprova vida.
- `POST /open` — body `{"path": "/Users/.../Cuina"}` o `{"path": "file:///..."}`.
  Retorna `200 OK` si s'ha pogut obrir, `403` si la ruta és fora de
  `GNOSI_OPEN_ROOTS`, `404` si no existeix.
- `POST /search` — body `{"query": "...", "limit": 100, "roots": ["/Users/.../Vault", ...]}`.
  Cerca per nom amb `mdfind -onlyin <root> -name <query>`. `roots` és
  opcional (per defecte `$HOME`); els roots continguts dins d'un altre es
  col·lapsen. Retorna `{"results": [{"name","path","is_dir"}], "truncated": bool}`.
  `400` si la query té menys de 2 caràcters; `500` si Spotlight falla del
  tot (llavors el backend fa fallback al seu `os.walk`).

## Seguretat

- Bind a `127.0.0.1` (només localhost + contenidors via `host.docker.internal`).
- Allowlist de roots: variable `GNOSI_OPEN_ROOTS` (separats per `:`). Si
  buida, accepta qualsevol ruta dins de `$HOME`.
- `/search` respecta la mateixa allowlist per als `roots` i filtra
  resultats dins de carpetes ocultes/sorolloses (`.git`, `node_modules`,
  `.history`…). La `query` es passa com a argv separat — no és injectable.
- `subprocess` sense shell.

## Instal·lació (LaunchAgent al Mac)

```bash
# 1) Carrega el LaunchAgent (s'executa al login i sempre que es mor)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.gnosi.host-open-helper.plist
# 2) Verifica
curl -sS http://127.0.0.1:5099/healthz
```

Per aturar-lo:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.gnosi.host-open-helper.plist
```

### Recarregar després d'un canvi de codi

El LaunchAgent apunta a `host_open_helper.py` per ruta; si edites l'script
(p.ex. afegint endpoints), cal reiniciar el servei perquè agafi el codi nou:

```bash
launchctl kickstart -k gui/$(id -u)/com.gnosi.host-open-helper
curl -sS http://127.0.0.1:5099/healthz
```

## Restriccions / Edge cases

- **Per què no fer-ho directament al backend Docker?** El contenidor és
  Linux i no té accés al Finder/Explorer del Mac. `subprocess.Popen(["open"])`
  falla amb `FileNotFoundError: open` perquè no està al PATH del contenidor.
- **Per què 5099 i no un port aleatori?** Per simplicitat i previsibilitat.
  El backend del contenidor ho té cablat a `host.docker.internal:5099`.
- **Si el port està ocupat:** canvia `GNOSI_HOST_OPEN_PORT` al plist i a
  `_safe_open_target` del backend.
- **Resource deadlock al Mac amb OneDrive:** alguns paths a OneDrive donen
  `Errno 35`. No afecta aquest helper directament; només afecta
  l'indexer de Gnosi.
- **`/search` depèn de l'índex de Spotlight.** Si Spotlight està desactivat
  en un volum, `mdfind` hi tornarà buit (no error). Si `mdfind` peta del
  tot, el helper retorna `500` i el backend cau al seu `os.walk`. Els
  missatges `[UserQueryParser] Loading keywords…` de `mdfind` van a stderr
  i no contaminen els resultats (que es llegeixen només de stdout).

### `/search` torna buit sota el LaunchAgent (Full Disk Access)

- **Símptoma:** `POST /search` retorna `200` amb `{"results": []}` de
  forma instantània, però `mdfind -onlyin $HOME -name <query>` executat
  manualment des de Terminal sí troba els fitxers. Típicament, queden
  amagats resultats sota `~/Downloads` o `~/Library/CloudStorage/...`.
- **Causa:** El LaunchAgent corre sota `launchd`, que no hereta el Full
  Disk Access (FDA) del Terminal de l'usuari. macOS TCC concedeix FDA per
  (binari, procés responsable), així que `mdfind` torna resultats sanejats
  sense error. És el mateix patró que afecta el daemon de warmup d'OneDrive.
- **Fix:** Afegir el binari de Python del LaunchAgent a *System Settings →
  Privacy & Security → Full Disk Access*. Per localitzar-lo:

  ```bash
  ps -p $(pgrep -f host_open_helper.py | head -1) -o command=
  # típicament: /Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python
  ```

  Després, reinicia el servei perquè TCC reavaluï:

  ```bash
  launchctl kickstart -k gui/$(id -u)/com.gnosi.host-open-helper
  ```

- **Alternativa:** `launchctl bootout` del LaunchAgent i llançar
  `host_open_helper.py` manualment des de Terminal (que sí té FDA),
  igual que es fa amb el daemon de warmup d'OneDrive.
