---
status: implemented
last_verified: 2026-09-16
source_paths:
  - backend/api/microsoft_auth_routes.py
  - backend/services/auth_public_surface.py
  - backend/services/microsoft_mail_service.py
  - desktop/microsoft-sign-in.js
  - desktop/main.js
  - frontend/src/shared/api/microsoft-auth.ts
  - frontend/src/features/settings/global-settings/accountProviders.ts
tests:
  - backend/tests/test_microsoft_auth_routes.py
  - backend/tests/test_auth_public_surface.py
  - desktop/microsoft-sign-in.test.js
  - frontend/src/shared/api/microsoft-auth.test.ts
---

# Correu de Microsoft a l’escriptori de Gnosi

Gnosi necessita un registre propi d’aplicació a Microsoft Entra abans d’iniciar
l’accés a Microsoft. Una adreça de correu o la contrasenya de la universitat no
són un registre d’aplicació. No utilitzeu l’identificador d’una altra aplicació.

Per a una instal·lació d’escriptori, registreu Gnosi com a **aplicació mòbil i d’escriptori**
amb aquest URI de redirecció:

`http://localhost:5002/api/auth/microsoft/desktop/callback`

Si el backend d’escriptori selecciona un altre port lliure, el retorn predeterminat
utilitza aquell port. La coincidència de redireccions natives a localhost de
Microsoft ignora el port. Un `MICROSOFT_OAUTH_REDIRECT_URI` personalitzat té
prioritat i ha d’arribar al backend en execució.

Trieu un públic de comptes que inclogui els usuaris previstos. Un registre propietat
d’una altra organització ha d’admetre comptes organitzatius d’altres directoris
per permetre l’accés dels estudiants de la UNED. Per admetre també comptes personals
de Microsoft, cal seleccionar el públic de comptes organitzatius i personals.

Configureu `MICROSOFT_OAUTH_CLIENT_ID` amb l’identificador d’aplicació (client) del
registre, mitjançant l’ajust segur `microsoft_oauth_client_id` o l’entorn del backend.
Deixeu `MICROSOFT_OAUTH_CLIENT_SECRET` sense definir per al registre natiu d’escriptori.
El flux de codi d’autorització utilitza PKCE (S256), un estat d’un sol ús i una
caducitat de deu minuts. Els registres web confidencials existents poden continuar
proporcionant un secret.

Els permisos delegats sol·licitats són Microsoft Graph `User.Read`,
`Mail.Read`, `Mail.ReadWrite`, `Mail.Send` i `offline_access`. La institució pot
exigir l’aprovació d’un administrador. No substituïu aquests permisos per permisos
d’aplicació ni concediu consentiment a tota l’organització per evitar aquest requisit.

Els dominis de la UNED `alumno.uned.es` i `uned.es` seleccionen Microsoft automàticament.
L’adreça s’envia com a `login_hint`; Microsoft descobreix la federació i redirigeix
cap a la institució. L’accés d’escriptori obre el navegador del sistema i conserva
la finestra de configuració de Gnosi. En acabar, el navegador convida a tornar a Gnosi.

Verifiqueu un accés real només després de registrar l’aplicació: inicieu-lo des de
Gnosi, completeu l’autenticació institucional i comproveu que el compte apareix i
pot llegir correu. Les proves locals amb simulacions no demostren que el registre
ni el consentiment institucional existeixin.

Referència: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
