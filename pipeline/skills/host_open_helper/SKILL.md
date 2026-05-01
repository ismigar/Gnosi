---
name: host_open_helper
description: Servei al host del Mac que obre fitxers/carpetes amb el Finder quan el backend de Gnosi corre dins de Docker (sense accés al sistema gràfic).
---

# Host Open Helper

## Què fa

Petit servei HTTP que escolta a `127.0.0.1:5099` i obre rutes locals amb
`open` (Mac), `xdg-open` (Linux) o `os.startfile` (Windows). El backend de
Gnosi (dins de Docker) el contacta via `host.docker.internal:5099` quan
l'usuari clica un enllaç `file://` al editor.

## Endpoints

- `GET /healthz` — comprova vida.
- `POST /open` — body `{"path": "/Users/.../Cuina"}` o `{"path": "file:///..."}`.
  Retorna `200 OK` si s'ha pogut obrir, `403` si la ruta és fora de
  `GNOSI_OPEN_ROOTS`, `404` si no existeix.

## Seguretat

- Bind a `127.0.0.1` (només localhost + contenidors via `host.docker.internal`).
- Allowlist de roots: variable `GNOSI_OPEN_ROOTS` (separats per `:`). Si
  buida, accepta qualsevol ruta dins de `$HOME`.
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
