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

# Courrier Microsoft dans l’application de bureau Gnosi

Gnosi nécessite sa propre inscription d’application dans Microsoft Entra avant de
commencer la connexion à Microsoft. Une adresse électronique ou un mot de passe
universitaire ne constitue pas une inscription d’application. N’utilisez pas
l’identifiant d’une autre application.

Pour une installation de bureau, inscrivez Gnosi comme **application mobile et de bureau**
avec cet URI de redirection :

`http://localhost:5002/api/auth/microsoft/desktop/callback`

Si le backend de bureau sélectionne un autre port libre, le retour par défaut
utilise ce port. La correspondance des redirections natives localhost de Microsoft
ignore le port. Un `MICROSOFT_OAUTH_REDIRECT_URI` personnalisé est prioritaire et
doit atteindre le backend en cours d’exécution.

Choisissez un public de comptes incluant les utilisateurs prévus. Une inscription
appartenant à une autre organisation doit accepter les comptes professionnels
d’autres annuaires pour permettre l’accès aux étudiants de l’UNED. Pour accepter
également les comptes personnels Microsoft, choisissez le public professionnel et personnel.

Définissez `MICROSOFT_OAUTH_CLIENT_ID` avec l’identifiant d’application (client) de
l’inscription, via le paramètre sécurisé `microsoft_oauth_client_id` ou l’environnement
du backend. Laissez `MICROSOFT_OAUTH_CLIENT_SECRET` non défini pour l’inscription native
de bureau. Le flux de code d’autorisation utilise PKCE (S256), un état à usage unique
et une expiration de dix minutes. Les inscriptions web confidentielles existantes
peuvent continuer à fournir un secret.

Les autorisations déléguées demandées sont Microsoft Graph `User.Read`,
`Mail.Read`, `Mail.ReadWrite`, `Mail.Send` et `offline_access`. L’établissement peut
exiger l’approbation d’un administrateur. Ne les remplacez pas par des autorisations
d’application et n’accordez pas de consentement à toute l’organisation pour contourner cette exigence.

Les domaines UNED `alumno.uned.es` et `uned.es` sélectionnent Microsoft automatiquement.
L’adresse est transmise comme `login_hint` ; Microsoft découvre la fédération et
redirige vers l’établissement. La connexion de bureau ouvre le navigateur du système
tout en conservant la fenêtre des paramètres de Gnosi. À la fin, le navigateur invite
l’utilisateur à revenir dans Gnosi.

Vérifiez une connexion réelle uniquement après l’inscription de l’application :
démarrez depuis Gnosi, terminez l’authentification institutionnelle, puis vérifiez
que le compte apparaît et peut lire le courrier. Les tests locaux avec simulations
ne prouvent pas l’existence de l’inscription ni du consentement institutionnel.

Référence : https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
