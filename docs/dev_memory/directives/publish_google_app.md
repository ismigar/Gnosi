# Directiva: Publicar l'app de Gnosi a Google Cloud

> ID: GOOGLE-PUBLISH-20260507
> Estat: ACTIVA
> Motivació: Eliminar la caducitat als 7 dies dels refresh tokens (mode *Testing*).

## Context

Mentre l'app de Google Cloud estigui en estat **Testing**, Google invalida els refresh tokens als **7 dies** d'inactivitat, força a re-autenticar manualment, i limita a 100 usuaris de prova. Publicar l'app a **Production** elimina aquestes limitacions.

Per a apps amb scopes "sensitive" (Gmail, Calendar, Contacts, Drive) i ús **personal o limitat**, la publicació no requereix verificació formal de Google (només s'avisa l'usuari amb una pantalla d'advertiment "Google hasn't verified this app" la primera vegada). Per a ús comercial públic, sí que cal verificació + auditoria de seguretat (CASA tier 2-3).

## Procediment

### Pas 1 — Accedir a la pantalla de consentiment

1. Obre [Google Cloud Console](https://console.cloud.google.com/).
2. Selecciona el projecte vinculat al `GOOGLE_OAUTH_CLIENT_ID` actual (mira a `.env_shared`).
3. Menú lateral → **APIs & Services** → **OAuth consent screen**.

### Pas 2 — Verificar configuració de l'app

> **Avís previ**: per a usuari únic amb `localhost`, sovint **no cal publicar**. El refresh proactiu (cada ~50 min mentre l'app corre) ja evita que els tokens caduquin si fas servir Gnosi setmanalment. Publica només si: (a) preveus períodes llargs sense usar l'app, (b) compartiràs amb tercers, o (c) vols zero-friction permanent.

Camps mínims abans de publicar:
- **App name**: `Gnosi`.
- **User support email**: `ismigar@gmail.com`.
- **App logo**: opcional.
- **Application home page**: `https://ismigar.github.io` (el repo de pàgines del propi usuari, ja existent).
- **Application privacy policy link**: `https://ismigar.github.io/privacy.html` (crear-la al repo `ismigar.github.io/`; sync-landing.yml propaga automàticament). Plantilla mínima:
  ```html
  <!DOCTYPE html>
  <html><body>
  <h1>Privacy Policy — Gnosi</h1>
  <p>Gnosi és una aplicació personal. Les dades obtingudes via OAuth2
  (Gmail/Calendar/Contacts) es processen i emmagatzemen exclusivament al
  dispositiu local de l'usuari. No es transmeten a servidors de tercers.
  L'usuari pot revocar l'accés des de myaccount.google.com/permissions.</p>
  <p>Contacte: ismigar@gmail.com</p>
  </body></html>
  ```
- **Authorized domains**: `ismigar.github.io` (sense `https://`).
- **Application terms of service link**: opcional, deixar buit.
- **Developer contact information**: `ismigar@gmail.com`.

> **Important**: el redirect URI OAuth segueix sent `http://localhost:5002/api/auth/google/callback`. Google permet `localhost` com a redirect_uri en apps publicades. La diferència és:
> - **Authorized domain** = domini públic on viu la documentació (privacy, home).
> - **Redirect URI** = on Google envia el callback OAuth (pot ser localhost).

### Pas 3 — Revisar scopes

A **Scopes** ha d'haver-hi els 5 que demana `google_auth_routes.py:17-23`:
- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/contacts`
- `https://mail.google.com/`  ← scope sensitive

L'últim (`mail.google.com`) és el que demana més atenció. Després de la migració XOAUTH2, és **imprescindible** (s'usa per IMAP/SMTP). Amb aquest scope, sense verificació, l'app pot tenir fins a 100 testers; un cop publicada, té quota il·limitada.

### Pas 4 — Publicar

1. A la pàgina **OAuth consent screen**, premar **PUBLISH APP**.
2. Confirmar el diàleg.
3. L'estat passa de "Testing" a "In production".

> **Nota**: si veus un missatge sobre "Verification required", no cal preocupar-se per ús personal. Pots ignorar-lo i seguir endavant. Els usuaris veuran una pantalla d'advertència "Google hasn't verified this app" la primera vegada però poden clicar "Advanced → Go to Gnosi (unsafe)". A nivell pràctic, com que ets l'únic usuari, no afecta.

### Pas 5 — Re-autenticar comptes existents

Després de publicar:
1. Els refresh tokens emesos en mode Testing **continuen sent vàlids** (no es revoquen automàticament) però poden seguir caducant fins el cicle de 7 dies anterior.
2. Per estar net, fes un *one-shot reauth*: a Configuració → Mail, desconnecta i torna a connectar el compte. Els nous tokens emesos en mode Production no caduquen mai.

### Pas 6 — Verificar

```bash
# Demana l'estat OAuth via el health endpoint
curl http://localhost:5002/api/auth/google/health
```

El JSON retornat ha de tenir `app_status: "production"` un cop publicat (basat en heurística — Google no exposa l'estat exacte).

## Què passa si segueixes en Testing

Casos d'ús legítims per quedar-se en Testing:
- L'app és per a un equip de < 100 persones tester.
- No vols publicar fins tenir privacy policy + dominis verificats.
- Estàs desenvolupant.

En Testing, l'auto-reconnexió és el patró previst — la migració C ja ho gestiona amb un missatge clar a la UI quan el refresh_token cau.

## Si decideixes anar-hi més enllà: verificació formal

Si publiques l'app per ús comercial massiu, Google demanarà:
1. **Privacy policy URL**: pública, accessible, descriu què es fa amb les dades de Gmail.
2. **Domain verification**: TXT record DNS al `tudominy.com`.
3. **Demo video YouTube** mostrant el flux d'OAuth i com s'usen les dades.
4. **CASA security assessment** (per scopes restricted com `gmail.modify` amb intencions específiques).

Cost: ~3.000–15.000 USD si subcontractes auditor. Per ús personal **NO cal**.

## Rollback

Si la publicació crea problemes inesperats, pots tornar a Testing des de la mateixa pantalla. Els tokens emesos en Production continuaran funcionant.
