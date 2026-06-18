# Pla de distribució de Gnosi (públic: desktop individual + self-host d'equip)

> Decisió d'Ismael (2026-06-17): fer Gnosi pública en DOS modes — (A) **app distribuïble** que algú fa servir sol al seu ordinador, i (B) **self-host** que un equip munta al seu servidor intern. **NO SaaS** (trairia l'ethos "Standalone Sovereignty" i seria una re-arquitectura gran). Aquesta directiva és el full de ruta; encara NO està tot implementat.

## Invariant d'arquitectura (el que ho fa possible)
Gnosi és **client-servidor** (frontend React ↔ backend FastAPI per API HTTP). Aquesta separació és justament el que permet els dos modes amb **una sola base de codi**:
- Mode A (desktop): el backend corre local com a *sidecar* dins una finestra d'app.
- Mode B (servidor): el mateix backend corre en un servidor intern; diversos usuaris hi entren pel navegador.

**Regla d'or:** mantenir el límit frontend↔backend com una **API HTTP neta**, sense supòsits de "tot és local" ni "tot és un sol usuari". Tot el que segueixi és aleshores additiu, no reescriptura.

## ARA (desplegat 2026-06-17): PWA per a ús diari
`frontend/public/manifest.json` (corregit: icones reals 192/512/640, `display:standalone`, `start_url:/`) + enllaços a `frontend/index.html` (`<link rel=manifest>`, `apple-touch-icon`, `theme-color`, metes `apple-mobile-web-app-*`). Icones generades amb `sips` des de `app-icon-home.png` (640). 
→ A https://localhost:5173: Safari *Arxiu→Afegir al Dock* o Chrome *Instal·lar* → finestra+icona pròpies, **zero builds, canvis de codi instantanis** (segueix apuntant al dev server viu). És la solució per a l'ús individual del propi Ismael mentre desenvolupa. **No bloqueja res del de sota.**

## Mode A — App d'escriptori distribuïble (model Obsidian)
Empaquetar amb **Tauri** (preferit; WebView del sistema, lleuger) o Electron. La finestra carrega el frontend i **engega el backend Python com a procés fill** (s'acaba el "està el server amunt?").
- **Repte gros: empaquetar el Python + ML.** torch+sentence-transformers són ~1-2 GB → un sidecar PyInstaller seria enorme i fràgil (i a Intel Mac, torch capat a 2.2.2, vegeu `environment_integrity.md`).
  - **Sortida recomanada:** per al build desktop, usar **embeddings via `onnxruntime`** (ja és dep de chromadb) en comptes de torch/sentence-transformers → sidecar molt més lleuger i bundleable. Deixar torch/OPUS-MT com a *opcional* (es baixa a la primera si l'usuari vol traducció/cerca semàntica avançada).
- **Builds = release, NO per canvi.** En dev s'usa `tauri dev` apuntant al dev server (hot-reload intacte). Els instal·ladors (`.dmg`/`.exe`/`.AppImage`) els fa la **CI (GitHub Actions) a cada tag**, no a mà. Signatura/notarització de macOS pendent (necessita compte d'Apple Developer).

## Mode B — Self-host d'equip (servidor intern)
**Ja existeix la recepta**: `monorepo/apps/gnosi/docker-compose.yml` + `Dockerfile.backend` + `Dockerfile.frontend` segueixen al repo (git), intactes. Avui (2026-06-17) vam treure el *runtime* de Docker del Mac d'Ismael perquè petava amb OneDrive (EDEADLK), però **en un servidor Linux real (sense File Provider de OneDrive) Docker és l'eina correcta** i no té aquell problema.
- Empaquetar com a imatges publicables (GHCR) + un `compose` net amb variables (`DIGITAL_BRAIN_VAULT_PATH`, `GNOSI_LOCAL_DATA`, secrets) documentades.
- Vault al servidor (compartit o per usuari), no OneDrive.

## El BLOCAIRE comú: auth + multi-usuari
És l'única peça gran de debò; la necessiten tots dos modes (B sí o sí; A pot quedar mono-usuari).
- Avui és **mono-usuari** (`X-User-ID: ismael-legacy`, sense login real). 
- Ja hi ha **llavors**: `gnosi_mode: personal` vs `organització`, i `VaultAccess` (vaults compartits). El disseny ja modela la bifurcació.
- **Fase de disseny pròpia (seguretat-crítica, NO improvisar):** login real (sessions/JWT o OAuth), permisos per usuari, aïllament de secrets per usuari (avui `integration_manager` és singleton global — OK per a desktop mono-usuari, s'ha de fer per-tenant per al mode servidor). En mode A `personal`, l'auth es pot ometre (un sol amo).

## Fasejat suggerit
1. ✅ **PWA** (fet) — ús individual immediat.
2. **Empaquetat desktop (Tauri)** amb sidecar lleuger (ONNX, torch opcional) + CI d'instal·ladors. → cobreix "app distribuïble" per a un sol usuari sense auth.
3. **Auth + multi-usuari** (fase de disseny + implementació, `personal`/`organització`). ← peça gran.
4. **Self-host d'equip**: polir imatges Docker + compose + docs, sobre la base d'auth de (3).
5. Signatura/notarització i canals de descàrrega (GitHub Releases).

## Constraints memoritzats
- Mantenir SEMPRE l'API HTTP com a frontera (no acoblar frontend a "local").
- Desktop: evitar bundlejar torch (usar ONNX); builds només a release via CI; dev amb hot-reload.
- Server: la recepta Docker del repo és la base; Docker és correcte en Linux/servidor (el problema era OneDrive al Mac).
- Auth és seguretat-crítica → fase de disseny dedicada, mai a cegues.
