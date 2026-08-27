# DIRECTIVE: RELEASE_PREFLIGHT

> ID: 2026-08-26-release-preflight
> Associated Script: scripts/release_preflight.py
> Last Update: 2026-08-26
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Bloquejar una release de Gnosi abans d'executar builds si les metadades, els runners o l'entorn local no són coherents.
- **Success Criteria:** El script retorna codi zero i confirma versions coherents, Node fixat a 22.22.2, quatre runners lliures i cap altra release activa.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Required Arguments:** versió objectiu en format `X.Y.Z` i arrel del repositori.
- **Environment Variables:** `GH_TOKEN` o autenticació existent de GitHub CLI.
- **Source Files:** manifests de frontend i Electron, lockfiles i workflow de release.

### Outputs

- **Generated Artifacts:** informe JSON a `.tmp/release-preflight.json`.
- **Console Output:** resum curt i codi de sortida diferent de zero si hi ha bloquejos.

## 3. Logical Flow (Algorithm)

1. Validar el format de la versió objectiu.
2. Comparar la versió dels manifests i les arrels dels lockfiles.
3. Confirmar que totes les fases del workflow usen Node 22.22.2.
4. Consultar GitHub i exigir els runners macOS ARM64, macOS X64, Linux ARM64 i Windows X64 online i lliures.
5. Detectar altres execucions actives de `Build and Release`.
6. Verificar espai lliure local i registrar VMs/processos de build actius.
7. Persistir un informe JSON sense secrets.

## 4. Tools and Libraries

- **Python libraries:** només biblioteca estàndard.
- **External APIs:** GitHub CLI autenticada.

## 5. Restrictions and Edge Cases

- No iniciar una release mentre una altra estigui `queued`, `in_progress`, `waiting` o `pending`.
- No considerar el nom de l'artefacte com a prova d'arquitectura; validar les etiquetes del runner.
- No modificar ni aturar VMs des del preflight; només informar i bloquejar si hi ha processos de build competidors.
- No usar instal·lacions permissives amb locks desalineats; exigir `pnpm install --frozen-lockfile` i `uv sync --frozen`.
- No executar simultàniament builds Linux, macOS i Windows quan comparteixen el mateix host físic; serialitzar-los i limitar la matriu macOS a una arquitectura cada vegada.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 26/08 | v2.0.5 sense Windows | El build Windows va fallar repetidament i la release es va completar manualment sense l'instal·lador | Exigir els artefactes de totes les plataformes abans de publicar |
| 26/08 | Node incompatible | El workflow usa Node 20 però el frontend exigeix >=22.22.2 | Fixar Node 22.22.2 a totes les fases |
| 26/08 | Lockfiles amb versions antigues | Els manifests eren 2.0.5 però les arrels dels lockfiles seguien a 2.0.0 i 1.0.4 | Sincronitzar manifests i lockfiles en cada bump |
| 26/08 | Worktree incomplet | El checkout de 35.000 fitxers continuava després del primer yield | Nota: no executar dins del worktree fins que el procés `git worktree add` hagi finalitzat i l'índex estigui desbloquejat |
| 26/08 | Cua zombie no cancel·lable | GitHub retorna `queued` però rebutja cancel·lació normal, forçada i eliminació perquè el run no ha arribat a crear jobs | Nota: no bloquejar per cues sense activitat de més de dues hores; informar-les com a advertència i usar `concurrency` en les releases noves |
| 26/08 | Competència entre VMs | Dos builds macOS i el build Windows podien executar-se alhora sobre el mateix Mac físic | Nota: no paral·lelitzar aquests jobs; executar Linux, macOS ARM64, macOS X64 i Windows seqüencialment |
| 26/08 | `pytest` i PyYAML absents | El Python global del Mac no conté les dependències de desenvolupament | Nota: no executar QA backend amb el Python del sistema; usar la `.venv` local de Gnosi |
| 26/08 | Backend CI rebutja una skill nova | `release_preflight` no constava a `pipeline/skills/catalog.yaml` | Nota: no consolidar una skill sense afegir-ne la classificació explícita al catàleg i executar el test de classificació |
| 26/08 | Gate documental rebutja el bump | Canviar `frontend/package.json` és d'alt impacte i exigeix actualitzar `docs/engineering` | Nota: no preparar una versió sense documentar el contracte de release dins del domini d'escriptori |
| 26/08 | Suite documental no importa `pipeline` | La suite es va executar des de l'arrel del monorepo privat | Nota: no executar la suite completa des de fora de `Gnosi`; usar aquesta arrel perquè els imports siguin resolubles |
| 26/08 | Referència generada obsoleta | Afegir una skill i un test va canviar els inventaris, però no es va executar el generador | Nota: no publicar una skill nova sense executar `generate.py`, després `generate.py --check`, `localize.py --check` i el validador des de l'arrel de Gnosi amb la `.venv` |
| 27/08 | `npm ci` falla només al runner Linux | El lockfile es va validar amb npm 11 local, però Node 22.22.2 proporciona npm 10 i aquest detecta paquets opcionals `@y/*` absents | Nota: no validar lockfiles amb una versió de npm diferent del runner; regenerar amb npm 10.9.4 i executar `npm ci --dry-run` al primer job abans de reservar cap build de plataforma |

## 7. Rationalizations

| Rationalization | Consequence |
| --- | --- |
| "Els runners apareixen online, per tant la release funcionarà." | Online no garanteix eines, espai, arquitectura ni absència de processos competidors. |
| "Una instal·lació no congelada ho arreglarà al runner." | Pot resoldre dependències diferents a cada plataforma i ocultar un lockfile trencat. |

## 8. Red flags

- Qualsevol runner offline o ocupat.
- Una release anterior activa.
- Menys de 25 GB lliures al host.
- Versions diferents entre manifests i lockfiles.
- Node del workflow diferent de 22.22.2.

## 9. Examples of Use

`uv run python pipeline/skills/release_preflight/scripts/release_preflight.py --version 2.0.6`

## 10. Pre-Execution Checklist

- [ ] GitHub CLI autenticada.
- [ ] VMs Windows i Linux engegades.
- [ ] Cap build manual en execució.
- [ ] Branca basada en l'últim `origin/main`.

## 11. Post-Execution Checklist (Verification Gates)

- [ ] Informe JSON inspeccionat.
- [ ] Frontend construït amb Node 22.22.2.
- [ ] Instal·lacions pnpm i uv congelades correctes.
- [ ] Workflow validat sintàcticament.
- [ ] PR fusionat abans de crear el tag.

## 12. Additional Notes

La release pública no s'ha de publicar parcialment. La fase de publicació depèn de tots els builds i ha d'exigir explícitament els fitxers de Windows, macOS i Linux.
