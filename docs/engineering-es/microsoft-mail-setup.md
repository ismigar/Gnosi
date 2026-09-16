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

# Correo de Microsoft en el escritorio de Gnosi

Gnosi necesita su propio registro de aplicación en Microsoft Entra antes de iniciar
el acceso a Microsoft. Una dirección de correo o la contraseña de la universidad
no son un registro de aplicación. No utilice el identificador de otra aplicación.

Para una instalación de escritorio, registre Gnosi como **aplicación móvil y de escritorio**
con este URI de redirección:

`http://localhost:5002/api/auth/microsoft/desktop/callback`

Si el backend de escritorio selecciona otro puerto libre, el retorno predeterminado
utiliza ese puerto. La coincidencia de redirecciones nativas a localhost de
Microsoft ignora el puerto. Un `MICROSOFT_OAUTH_REDIRECT_URI` personalizado tiene
prioridad y debe llegar al backend en ejecución.

Elija un público de cuentas que incluya a los usuarios previstos. Un registro
propiedad de otra organización debe admitir cuentas organizativas de otros
directorios para permitir el acceso de estudiantes de la UNED. Para admitir también
cuentas personales de Microsoft, seleccione el público organizativo y personal.

Configure `MICROSOFT_OAUTH_CLIENT_ID` con el identificador de aplicación (cliente)
del registro, mediante el ajuste seguro `microsoft_oauth_client_id` o el entorno
del backend. Deje `MICROSOFT_OAUTH_CLIENT_SECRET` sin definir para el registro nativo
de escritorio. El flujo de código de autorización utiliza PKCE (S256), un estado
de un solo uso y una caducidad de diez minutos. Los registros web confidenciales
existentes pueden seguir proporcionando un secreto.

Los permisos delegados solicitados son Microsoft Graph `User.Read`,
`Mail.Read`, `Mail.ReadWrite`, `Mail.Send` y `offline_access`. La institución puede
exigir la aprobación de un administrador. No sustituya estos permisos por permisos
de aplicación ni conceda consentimiento a toda la organización para eludir este requisito.

Los dominios de la UNED `alumno.uned.es` y `uned.es` seleccionan Microsoft automáticamente.
La dirección se envía como `login_hint`; Microsoft descubre la federación y redirige
a la institución. El acceso de escritorio abre el navegador del sistema y conserva
la ventana de configuración de Gnosi. Al finalizar, el navegador invita a volver a Gnosi.

Verifique un acceso real solo después de registrar la aplicación: inícielo desde
Gnosi, complete la autenticación institucional y compruebe que la cuenta aparece y
puede leer correo. Las pruebas locales con simulaciones no demuestran que existan
el registro ni el consentimiento institucional.

Referencia: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
