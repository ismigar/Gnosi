# Auth i multi-usuari de Gnosi — estat real + pla de tancament de gaps

> Descobert 2026-06-17 (auditoria de codi): **l'auth ja està majoritàriament IMPLEMENTADA**, no és greenfield. El que cal NO és dissenyar-la de zero sinó **tancar gaps concrets** per al mode self-host d'equip. El mode desktop individual ja funciona sense auth.

## El que JA EXISTEix (sòlid)
- **Auth JWT email/password**: `backend/api/auth_routes.py` (`/api/auth/register|login|logout|me`), `backend/services/auth_service.py` (bcrypt cost 12 via passlib; JWT HS256, cookie HttpOnly `gnosi_session`, TTL 7 dies, signat amb `GNOSI_JWT_SECRET`).
- **Resolució d'identitat amb prioritat**: JWT (cookie/Bearer) > header `X-User-ID` > `ismael-legacy` (default històric). `auth_service.get_current_user_id()` / `get_user_id_or_legacy()`. O sigui que `X-User-ID` NO és confiança cega: és només el *fallback* del mode personal.
- **RBAC real**: `workspace_service.require_role(min_role)` amb jerarquia `owner:3 > admin:2 > editor:1 > viewer:0`. Rols a `models/management.py` (`UserRole`), assignats via `Membership`.
- **Model de dades multi-usuari** (SQLite `management.sqlite`, SQLAlchemy): `User` (email únic, `password_hash` bcrypt nullable), `Workspace`, `Membership` (user↔workspace+role), `Vault` (per workspace), `VaultAccess` (permisos fins: `{capabilities:[read,write,delete]}`).
- **Bifurcació `gnosi_mode`**: **personal** = un usuari, sense login, auto-crea workspace/vault; **org** = multi-tenant amb login obligatori i VaultAccess.
- **Frontend**: `context/AuthContext.jsx`, `components/Auth/LoginPage.jsx`, gate a `App.jsx` (només en mode org), `hooks/use-api.js` (cookie `credentials:include` + headers `X-User-ID/Email/Workspace` de fallback).

## GAPS (el que falta per a self-host d'equip segur)

### 🔴 Crítics (BLOQUEGEN el mode equip — són forats de seguretat)
1. **Secrets globals, no per-usuari.** `services/integration_manager.py` és un **singleton** amb un únic `integrations.json` per instància → en mode org, TOTS els membres compartirien els tokens OAuth de Google / contrasenyes IMAP / API keys d'una persona = **fuga i suplantació** (ja avisat a `environment_integrity.md`). Cal secrets **per-usuari (o per-workspace)**, idealment xifrats a la BD amb FK a `user_id`.
2. **VaultAccess no s'aplica a la capa de dades.** L'accés es filtra amb *hints* de capçalera/frontend, però la I/O de fitxers del vault no es contrasta contra `VaultAccess` al backend → un usuari podria accedir a vaults aliens canviant capçaleres. Cal **enforcement al backend** (cada lectura/escriptura del vault valida `VaultAccess`).

### 🟠 Enduriment (producció, no bloquegen però calen)
- Rate-limiting a `/api/auth/login` (anti-brute-force) — hi ha TODO al codi.
- Reset de contrasenya (email + token temporal) — TODO.
- Verificació d'email — TODO.
- Revocació de tokens (logout server-side / llista negra; ara el JWT val fins que expira).
- CSRF (ara confia en SameSite=Lax).
- 2FA opcional — TODO.
- Logs d'auditoria (qui canvia rols/permisos/membres).

### 🟢 Mode desktop individual
Es queda **com està**: `gnosi_mode: personal`, sense login, un sol amo. NO cal tocar res. L'auth és només per al mode org/servidor.

## Capa d'autorització FINA: accés a parts del vault (estil grups+rols de Drupal)
Requisit (Ismael, 2026-06-17): poder donar a certes persones accés a certes **PARTS** del vault, no només a vaults sencers. És l'extensió natural del gap crític #2, a granularitat de subarbre.

**Model (potent però ACOTAT — no replicar tot Drupal):**
- **Workspace** = tenant/equip (≈ site de Drupal). **Group** (NOU) = subconjunt de membres dins el workspace amb rol (≈ grups de Drupal). **Grant** = (subjecte: `user` O `group`) × (àmbit: `vault` + `path_prefix`, p. ex. `BD/Projectes/ClientA/`) × (capabilities: `read/write/delete/share`).
- **Resolució**: per (usuari, ruta) s'agreguen els grants que casen (per l'usuari o via grup) on `path_prefix` és ancestre de la ruta; **el més específic guanya**; capabilities en unió. Owner/admin del workspace = baseline total; viewer = res sense grant.
- **Mapeig**: estendre `VaultAccess` (afegir `path_prefix` + subjecte `group_id`) + nous models `Group`/`GroupMembership`. Reutilitzar `require_role` per al baseline. NO reescriure.
- **Acotament anti-Drupal-monster**: 4 capabilities (no centenars de permisos), àmbit = prefix de ruta (cobreix carpetes i les BD/pàgines de dins), MVP només-allow (sense deny rules). 20% que dona el 80%.
- **Dependència**: es construeix SOBRE el gap #2 (primer el backend ha de fer complir QUALSEVOL grant a la capa de dades; després s'afina amb path+grups).

## Decisions a prendre (amb recomanació)
1. **Abast dels secrets**: per-usuari vs per-workspace? → **Recomano per-usuari** (cada un connecta el SEU Google/mail), amb opció de compartir a nivell workspace explícitament. Xifrar a la BD (clau de `GNOSI_JWT_SECRET`/env, no en clar).
2. **SSO/OAuth-login**: les rutes OAuth de Google/Microsoft existeixen però per a *integracions* (calendari/mail), no per a *login*. Decidir si afegim "Entra amb Google" com a login (enllaçant a `User.email`). → Recomano deixar-ho per a una fase posterior; email/password ja cobreix l'MVP d'equip.
3. **Encryption-at-rest del vault/secrets** en servidor compartit: abast a decidir.

## Ordre recomanat (per al self-host d'equip) — CONFIRMAT per Ismael 2026-06-17
1. **Secrets per-usuari** (gap crític #1, independent) — desbloqueja compartir instància sense fugues de tokens.
2. **Enforcement de VaultAccess al backend** (gap crític #2) — LA FUNDACIÓ: sense això cap permís és real. Implementar com a **no-op estricte en mode personal** (no trencar el desktop individual).
3. **Autorització fina** (path-prefix + grups, estil Drupal) — a sobre de (2).
4. **Enduriment auth**: rate-limit + reset-password + email-verify (mínim per exposar el login).
5. Revocació de tokens, CSRF, auditoria, 2FA (segons exposició).

> Implementació: estendre el codi existent (`auth_service`, `workspace_service`, `models/management.py`, `vault_routes`), no reescriure. Cada pas verificat contra l'app en mode personal (ha de seguir intacte).

## Constraints memoritzats
- L'auth NO és greenfield: estendre el que hi ha (`auth_service`, `workspace_service`, `models/management.py`), no reescriure.
- Mode personal/desktop: intacte, sense login.
- Els 2 gaps crítics són **seguretat-crítics** → implementar amb cura i decisió prèvia, mai a cegues.

## Spec d'implementació del gap #2 (grounded al codi, 2026-06-17)
- **Chokepoint**: `backend/services/workspace_service.py::get_workspace_context()` és el resolutor central (dependència FastAPI: JWT > X-User-ID > legacy). Mode `personal` → `owner` + vault per defecte (enforcement = **no-op natural**). Mode `org` → resol membership + `VaultAccess` (a nivell de vault) + capabilities.
- **El forat**: `VaultAccess` (vault×user×capabilities) només s'usa per SELECCIONAR el vault (L153-176), no per validar cada operació ni per ruta. `require_role`/`require_capability` existeixen però molts endpoints de vault no els apliquen.
- **A implementar (incremental):**
  1. **Schema (additiu, no trenca)**: `VaultAccess` + `path_prefix` (nullable; null = vault sencer) + subjecte `group_id` (nullable). Nous models `Group`+`GroupMembership`. La migració lleugera de `management_db.py` ja afegeix columnes/taules que falten.
  2. **Resolutor**: `effective_capabilities(db, user_id, workspace_id, path) -> set` = unió de grants que casen (per usuari O via grup) on `path_prefix` és ancestre de `path`; **més específic guanya**; owner/admin = baseline total; **mode personal = total (no-op)**.
  3. **Enforcement CENTRAL**: trobar la capa central d'I/O del vault (lectura/escriptura/llistat/esborrat de pàgines/fitxers) i validar-hi `effective_capabilities` contra la ruta objectiu (403 si falta) — fer-ho al punt central, NO endpoint a endpoint (vault_routes té 9000+ línies; escampar-ho és com es deixa un forat).
- **Cal banc de proves org** (NO es pot verificar a la instància personal actual sense posar-la en mode org = activaria el gate de login sobre l'ús diari): aixecar una **instància de test separada** (port propi + `management.sqlite` de test + `GNOSI_MODE=org`), 2 usuaris, grant a l'usuari B de `read` només a `BD/X/` → verificar B permès a X, denegat fora, denegat write. Implementar TDD contra aquest banc, no a cegues.
- **Regla**: cada canvi verificat contra la instància personal en marxa (ha de seguir intacta) + contra el banc org.

## Decisions CONFIRMADES per Ismael (2026-06-17) — disseny LOCKED
- **Públic = desktop distribuïble + self-host d'equip** (NO SaaS). Ismael NO farà servir org; és funció de producte **per a equips** → l'única validació possible són **tests automàtics** (ell no en farà de dogfooding).
- **Secrets**: per-usuari (els tokens de comptes connectats). Claus d'infra compartides es queden a `.env_shared`/instància.
- **Feina en segon pla (mail sync, scheduler) en mode org = Opció 1: JOBS PER-USUARI** — el scheduler itera els usuaris amb integracions actives i fa servir els tokens de cadascú. Cada membre connecta el SEU compte.
- **Autorització fina**: path-prefix + grups, 4 capabilities, només-allow (estil Drupal acotat).
- **Ordre**: secrets per-usuari → enforcement VaultAccess → granular (path+grups) → enduriment.

> ESTAT: **fase de DISSENY completa**. La IMPLEMENTACIÓ és un refactor real i seguretat-crític (integration_manager singleton→per-usuari + consumidors + scheduler; enforcement central a vault_routes 9000+ línies) que toca l'app EN MARXA d'Ismael per a una funció que ell no usarà. Fer-ho **test-driven, incremental, amb banc org de test, i amb el mode personal verificat-intacte a cada pas**. Recomanat com a esforç dedicat, no rush.
</content>
