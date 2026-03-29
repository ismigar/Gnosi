# Directiva d'Organització de GitHub (ismigar)

Aquesta directiva defineix l'estructura de miralls i sincronització del monorepo a GitHub per garantir la integritat del codi i la visibilitat pública controlada.

## Font de Veritat (Source of Truth)

- **Repo Local**: `/Users/ismaelgarciafernandez/Projectes`
- **Repo GitHub Principal**: `ismigar/Projectes` (**Privat**)
    - Conté tot el monorepo (Backend, Frontend, Pipeline, Docs, Scripts).
    - L'actualització es fa mitjançant `git push origin main`.

---

## Estratègia de Miralls (Mirrors)

Per als repositoris públics, s'utilitza una estratègia de sincronització neta (Clean Slate) mitjançant el script `scripts/sync_repos.py`.

### 1. Gnosi (Públic)
- **Objectiu**: Mostrar l'aplicació final (producte).
- **Contingut**: Directori `monorepo/` situat a l'arrel del repositori `Gnosi`.
- **Sincronització**: `git subtree split --prefix monorepo main` o mètode d'òrfena si hi ha conflictes de secrets.

### 2. ismigar (Públic)
- **Objectiu**: Perfil d'usuari i eines d'utilitat.
- **Contingut**: Directoris `docs/` i `scripts/` (excloent el monorepo d'infraestructura).

---

## Política de Neteja

Queden terminantment **PROHIBITS** els següents repositoris per evitar redundància i riscos de seguretat (historial brut):

- **Repositoris de fragments**: Els repositoris individuals per a `frontend`, `backend` o `pipeline` han estat absorbits pel monorepo i s'han d'eliminar de GitHub si encara existeixen.
- **Repositoris heredats**: Qualsevol versió anterior a la migració SSH de Març de 2026 (com `digital-brain` o `Monorepo`).

---

## Verificació de Seguretat

- **Secrets**: Prohibida la inclusió de claus API (`Notion`, `Google`, `OpenAI`) al codi.
- **Variables**: S'han d'utilitzar sempre variables d'entorn (`.env`) o el sistema `os.getenv`.
- **Auditoria**: Abans de qualsevol canvi estructural, s'ha de revisar el contingut via `scripts/audit_notion.py` (si s'escau).
