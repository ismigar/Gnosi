# Directive: Política d'aprovació de tools auto-generades per l'agent

> **Decisió (2026-07-06):** OPCIÓ A — **aprovació humana obligatòria per a TOTES les
> tools generades**. Res d'auto-execució automàtica. Implementat a
> `backend/agent/generated_tools/creator.py` (`needs_approval = True` sempre).

## Objectiu

El sistema d'auto-generació de tools (`monorepo/apps/gnosi/backend/agent/generated_tools/`)
permet a l'agent *coder* escriure codi Python nou i afegir-lo a les seves pròpies eines
(`create_new_tool`, enllaçat a la factory a `coder_tools`). Això és auto-millora, però
també és **execució de codi arbitrari** generat per un LLM que pot estar influït per
contingut NO confiable (pàgines del vault, correus, PDFs → prompt-injection).

## Per què no n'hi havia prou amb el hardening del validador (PR #757)

El PR #757 va tancar els escapes demostrats del validador via AST
(`eval`/`exec`/`__import__`/`os.environ`/`os.remove`/`open`-write). PERÒ el sandbox
segueix sent **porós per disseny** i el gate d'auto-aprovació era trencat:

1. **`pathlib` és a la whitelist d'imports** → una tool auto-aprovada pot fer
   `Path("/qualsevol").read_text()/write_text()/unlink()` → lectura/escriptura/esborrat
   de fitxers arbitraris (inclosos secrets, `.env_shared`, el vault OneDrive).
2. **El loader (`loader.py::_load_tool`) executa amb `exec()` i deixa `__import__` viu**
   al namespace. El propi docstring admet: *"not a real sandbox — just a tripwire"*.
3. **`create_new_tool` AUTO-APROVAVA** tot el que no fos classificat `EXTERNAL_WRITE`, i
   la classificació (`_analyze_risk_level`) es basava en **KEYWORDS DEL NOM** de la tool
   (+ si esmenta `mcp`). Trivial de manipular: una tool anomenada `read_x` amb codi
   perillós → risc `READ` → auto-aprovada i executada sense supervisió.

El forat és **arquitectural**, no un bug puntual del validador: cap validador estàtic
tanca del tot un `exec()` amb `pathlib`/`__import__` a l'abast. La defensa fiable és
**no executar codi generat sense que un humà l'hagi llegit**.

## Opcions considerades (decisió de producte)

| Opció | Què | Trade-off |
|-------|-----|-----------|
| **A (ESCOLLIDA)** | Aprovació humana per a TOTES les tools generades | Perd la comoditat "fully automatic"; guanya que cap codi generat corre sense revisió. **Cost d'implementació mínim: la cua `pending/` + Dashboard `/api/tools/approve` (gated `admin`) JA existeixen.** |
| B | Sandbox de procés real (subprocess restringit / RestrictedPython) | Robust fins i tot amb tools aprovades a cegues, però molt més invasiu, obre decisions de disseny (IPC, timeouts, quotes) i encara cal decidir què s'exposa. |
| C | Treure `pathlib`/`__import__` de l'espai d'execució; donar només APIs controlades (`backend.agent.memory`, `mcp.client`) | Redueix la superfície però trenca tools legítimes que necessiten stdlib; segueix confiant en un `exec()` filtrat. |

**Es tria A** perquè tanca el forat d'auto-execució ARA, reaprofita infraestructura
existent i converteix `_analyze_risk_level` (fràgil, basat en el nom) de *gate de
seguretat* a mera **pista informativa per al revisor humà**. B i C queden documentats com
a enduriment futur (defense-in-depth) si es vol tornar a obrir un camí semi-automàtic.

## Implementació

- `creator.py::create_new_tool`: `needs_approval = True` **sempre** (abans:
  `== RiskLevel.EXTERNAL_WRITE`). Tota tool nova va a `pending/` i espera l'admin.
  El `risk_level` calculat es desa i es mostra al Dashboard només com a etiqueta.
- Missatges i docstrings actualitzats: cap tool s'"auto-aprova"; `get_pending_tools`
  ja no diu "només 🔴 EXTERNAL_WRITE requereix aprovació".
- Flux d'aprovació sense canvis: Dashboard → `GET /api/tools/pending` →
  `POST /api/tools/approve` (`require_role("admin")`) → `loader.refresh()`.

## Restrictions / Edge Cases

- **NO tornis a lligar l'auto-aprovació a `_analyze_risk_level`** ni a cap heurística
  derivada del nom/descripció: és controlable per l'LLM (i per injecció) → no és un
  límit de seguretat.
- El `risk_level` segueix sent útil com a **senyal de prioritat/atenció** per al revisor,
  no com a permís.
- Si algun dia es vol reintroduir un camí automàtic, fer-ho SOTA opció B o C, no
  relaxant A. A és el terra de seguretat.
- Relacionat: contenció de path a les tools d'acció de `backend/agent/`
  (memòria `feedback_agent_tools_path_containment`, PRs #755/#756) i el hardening del
  validador (PR #757).
