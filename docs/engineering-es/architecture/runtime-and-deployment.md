---
status: implemented
last_verified: 2026-08-31
source_paths:
  - scripts/runtime/run_native_dev.sh
  - scripts/runtime/run_native_frontend.sh
  - backend/config/env_config.py
  - backend/config/data_dir.py
  - frontend/vite.config.js
  - docker-compose.yml
  - compose.vaults.yml
  - Dockerfile.backend
  - Dockerfile.frontend
  - desktop/main.js
  - tests/e2e/tests/setup/auth.setup.ts
  - tests/e2e/support/auth-playwright.ts
  - tests/e2e/support/auth-state.ts
tests:
  - pipeline/tests/test_native_runtime_wrappers.py
  - backend/tests/test_env_loading.py
  - backend/tests/test_data_dir.py
  - backend/tests/test_vault_creation_membership.py
  - desktop/application-menu.test.js
  - backend/tests/test_host_helper_url.py
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Ejecución y despliegue

Esta página recoge los contratos revisados en el código en la fecha de
verificación. Docker es un destino de despliegue compatible y opcional; el
desarrollo nativo sigue siendo el predeterminado. Ni revisar el código ni
configurar un destino de publicación acredita la aceptación por plataforma.
Consulte el [manual de operaciones](../operations/runbook.md) para las órdenes,
la conservación de datos y el diagnóstico.

## Ejecución nativa

Inicie los dos wrappers del repositorio desde terminales. Los LaunchAgents de
macOS son una configuración opcional del host, no un requisito:

| Proceso | Wrapper en `scripts/runtime/` | Dirección predeterminada | Recarga del código |
| --- | --- | --- | --- |
| Backend | `run_native_dev.sh 5002` | `127.0.0.1:5002` | uvicorn observa `backend/`. |
| Frontend | `run_native_frontend.sh --config vite.config.js --host 127.0.0.1` | HTTP(S) `127.0.0.1:5173` | Vite recarga el código. |

El backend utiliza `uv run --project "$BASE" --frozen --no-sync` con el
entorno Python existente de la raíz. Las únicas autoridades de entorno y datos
son `load_env()` y `resolve_data_dir()` de Python, no un analizador dotenv en
el shell. La precedencia por variable es: entorno del proceso, `.env` del
repositorio y archivo compartido seleccionado explícitamente mediante
`GNOSI_SHARED_ENV_FILE`; no se infiere ningún `.env_shared` de los directorios
padre. El resolutor de datos selecciona `GNOSI_DATA_DIR`, después
`GNOSI_LOCAL_DATA`, después `LOCAL_DATA_DIR` y finalmente el valor
predeterminado de la plataforma. El wrapper no elige un vault si no está
configurado ni fuerza OneDrive, un proveedor, `HOME_HOST_PATH`, una zona
horaria, un modelo o un endpoint de traducción.

El frontend establece `COREPACK_ENABLE_NETWORK=0` y ejecuta
`corepack pnpm --filter @gnosi/frontend dev`. El ejemplo pasa explícitamente
la configuración de Vite y el host loopback; en otro caso se aplica el host
configurado en Vite. El wrapper conserva los valores explícitos de
`VITE_BACKEND_HOST` y `VITE_BACKEND_PORT` (predeterminados: `localhost` y
`5002`). Vite gestiona sus dotenv; el wrapper deja `VITE_FRONTEND_PORT` sin
definir si no está presente, para no ocultarlos. También conserva las etiquetas
explícitas del checkout y puede avisar cuando el checkout servido es un
antepasado ya integrado de `origin/main`.

Ambos wrappers validan los puertos proporcionados entre 1 y 65535, transmiten
los argumentos y propagan las salidas. No instalan ni sincronizan dependencias;
el gestor de paquetes fijado y los entornos bloqueados ya deben estar
preparados. La recarga del código no actualiza dependencias. `uv.lock` es la
autoridad, pero sus selecciones por plataforma no acreditan la pila de ML en
todos los sistemas operativos o arquitecturas.

## Autoalojamiento Docker

El `docker-compose.yml` base proporciona backend, frontend y translation-server
de Zotero sin exigir rutas de vault del host ni herramientas privadas:

| Almacenamiento | Volumen con nombre | Ruta del backend |
| --- | --- | --- |
| Estado por dispositivo | `gnosi_local_data` (clave existente) | `/data`; `GNOSI_DATA_DIR=/data` |
| Vaults | `gnosi_vaults` (nuevo) | `/vaults`; `GNOSI_VAULTS_ROOT=/vaults`, `DIGITAL_BRAIN_VAULT_PATH=/vaults/default` |

Conserve el nombre existente del proyecto Compose y ambos volúmenes de datos al
actualizar; el nombre del proyecto determina la identidad de los volúmenes.
Un volumen nuevo de vaults no importa los vaults existentes del host. Nunca
utilice `docker compose down -v` ni una purga generalizada de volúmenes para
reparar dependencias; conserve las bases de datos, credenciales y contenido
de los vaults antes de migrar.

Los puertos se publican en loopback por defecto: `127.0.0.1:5002` y
`127.0.0.1:5173`. `GNOSI_BIND_ADDRESS`, `GNOSI_BACKEND_PORT` y
`GNOSI_FRONTEND_PORT` controlan la publicación en el host. Los puertos internos
siguen siendo 5002/5173; el frontend utiliza HTTP y actúa como proxy del tráfico
API/WebSocket hacia `backend:5002`. Revise el acceso y TLS antes de exponer
otra dirección. Se exige un `GNOSI_JWT_SECRET` privado y robusto durante la
interpolación de Compose, mediante el shell o el `.env` local; un `env_file`
del servicio no puede proporcionarlo por sí solo. `GNOSI_REQUIRE_AUTH=1`
es explícito.

Compose lee opcionalmente el archivo compartido seleccionado mediante
`GNOSI_SHARED_ENV_FILE` (alternativa `.env.shared.disabled`) y después el
`.env` local opcional. Los valores locales prevalecen sobre los compartidos;
`environment` explícito del servicio prevalece sobre ambos. Los valores
arbitrarios del shell del host no se convierten automáticamente en variables
del contenedor. Estos archivos no se montan ni se incluyen en las imágenes.
Compose vacía `GNOSI_SHARED_ENV_FILE` dentro del backend tras cargar sus valores.

El translation-server de Zotero sigue siendo interno en 1969.
`GNOSI_TRANSLATION_IMAGE` selecciona su imagen; `TRANSLATION_SERVER_URL` toma
`http://translation-server:1969` solo si no está definida, y conserva un valor
vacío explícito. La traducción es opcional para la aplicación; el Compose
actual incluye el servicio auxiliar sin un perfil opcional.

La sobrescritura explícita `compose.vaults.yml` exige ambas rutas existentes
del host: `VAULT_HOST_PATH` para el vault activo y `VAULTS_ROOT_HOST_PATH` para
su padre. Ambos montajes utilizan `create_host_path: false`. La fusión según
el destino en el contenedor sustituye el volumen `/vaults`, añade `/vault`,
establece `DIGITAL_BRAIN_VAULT_PATH=/vault` y conserva `gnosi_local_data:/data`.
Las dos rutas del host se transmiten explícitamente para las acciones sobre
archivos. Las relativas se resuelven desde el directorio del Compose base;
prefiera rutas absolutas. Esta sobrescritura no migra datos ni configura
servicios auxiliares del host.

No hay montajes implícitos del directorio personal, `.antigravity` privado,
directorio de secretos, socket Docker, código fuente o dependencias del host.
Solo la sobrescritura explícita añade sus dos montajes de vaults. Un CLI Docker
dentro de la imagen del backend no proporciona acceso al motor del host sin un
socket o endpoint configurado explícitamente. El código y las dependencias
pertenecen a las imágenes: no hay recarga del código del host ni volúmenes
anónimos `node_modules`. Reconstruya las imágenes si cambian el código o los
archivos de bloqueo.

La imagen del frontend fija Node 22.22.2 y pnpm 11.19.0, instala con
`--frozen-lockfile` y ejecuta Vite en el puerto estricto 5173. El backend
exporta `uv.lock` con `--frozen`, instala el wheel fijado de Torch solo para
CPU antes de los requisitos exportados y ejecuta uvicorn sin `--reload`.
La disponibilidad del wheel y la compilación y arranque reales son requisitos
de aceptación por plataforma. Los tests estáticos de contratos no sustituyen
la fusión real de Compose, las compilaciones de imágenes, las pruebas básicas
de los contenedores ni la aceptación por plataforma.

## Paquetes Electron

Electron gestiona el ciclo de vida de la aplicación empaquetada. Inicia el
backend Python incluido, expone una interfaz IPC limitada mediante preload,
abre el renderer y gestiona el estado de las actualizaciones manuales.
El renderer se suscribe a las actualizaciones y puede consultar su estado
más reciente para no perder eventos emitidos antes de que React se monte.

El proceso de escritorio instala un menú nativo explícito en lugar del menú
de desarrollo predeterminado de Electron. React es la fuente de verdad de las
etiquetas traducidas: cuando se resuelve el idioma configurado, el renderer
transmite un conjunto validado de etiquetas mediante preload y repite el
intercambio cuando cambia el idioma. Las órdenes nativas de configuración
vuelven al modal existente de Configuración global. Los menús de producción
excluyen la recarga y las herramientas de desarrollo.

Las ventanas principales de Gnosi se gestionan de forma independiente.
Archivo → Nueva ventana crea otro renderer contra el mismo backend incluido;
cerrar una ventana solo elimina esa ventana, y la activación desde el Dock
de macOS recrea una ventana principal cuando se ha cerrado la última.
Las órdenes de menú destinadas al renderer enfocan una ventana existente o
esperan a que el nuevo renderer esté disponible antes de entregarlas.

Los jobs de compilación y publicación producen instaladores por plataforma y
los metadatos de actualización que necesita `electron-updater`. Los borradores
no se publican hasta que un mantenedor revisa todos los artefactos. Los
destinos configurados y los contratos estáticos no acreditan una instalación
limpia, el primer arranque, la actualización, la reversión, la firma ni la
conservación de datos; cada plataforma exige pruebas propias.

## Servicios auxiliares del host

Los servicios host-open pueden ofrecer apertura de archivos, búsqueda Spotlight,
selectores nativos y acciones de papelera. Los servicios de archivos en la nube
pueden hidratar archivos solo en línea; la recuperación de cada proveedor
corresponde a su adaptador. Son integraciones opcionales que requieren
configuración explícita, no requisitos de arranque portable.

Los 15 scripts históricos del runtime del host (instaladores, watchdogs y
herramientas del host), junto con los lanzadores obsoletos `run_brain.sh` y
`run_prod.sh`, se han retirado del repositorio público. Las operaciones del host
pertenecen al repositorio privado `WorkspaceTools`. El instalador histórico
`install_native_startup.sh` detiene los procesos que escuchan en 5002/5173 y
recarga LaunchAgents. Una copia conservada de `native_watchdog.sh` puede matar
procesos multiprocessing con una selección amplia y reiniciar mediante launchd;
no ejecute ninguno como diagnóstico genérico. Revise la configuración real
instalada y los procedimientos privados. Esta limpieza del checkout no modifica,
migra ni desinstala los servicios instalados del host. Los wrappers portables
siguen siendo el contrato de arranque nativo.

## Invariantes de puertos y procesos

- Solo un proceso puede escuchar en cada dirección/puerto elegido; 5002/5173
  son valores predeterminados, no un permiso para que nativo y Docker compartan
  la escucha.
- Vite utiliza `strictPort`; pasar silenciosamente a otro puerto es un fallo de QA.
- La recarga nativa no actualiza dependencias ni versiones inyectadas al arrancar;
  los cambios de código de los contenedores exigen reconstruir la imagen.
- La QA en el navegador sigue el protocolo del Vite activo. Sin certificados
  locales legibles se utiliza HTTP; HTTPS automático los utiliza,
  `VITE_DEV_HTTPS=false` fuerza HTTP y `VITE_DEV_HTTPS=true` los exige.

## Comprobaciones de salud y aceptación

`/api/health` informa del estado del proceso, el modo, la política efectiva de
autenticación y la configuración del vault. Verifique `/api/config` y
`/api/vault/pages` con una sesión autorizada; que el proceso responda no
demuestra que se pueda leer el vault.

La aceptación nativa debe probar el registro real, la creación de un workspace
y del primer vault, el inicio de sesión, `/api/auth/me`, las cookies HttpOnly
y la preparación de autenticación de Playwright, con arranque y parada limpios.
En el navegador hay que crear/editar una página desechable, recargarla/reabrirla
para verificar la persistencia del título y del cuerpo, revisar la consola y
comprobar el cierre de sesión. La preparación exige `GNOSI_TEST_EMAIL` y
`GNOSI_TEST_PASSWORD` explícitos de una cuenta desechable existente, deriva
la identidad y la pertenencia al workspace de la sesión verificada y no registra
cuentas ni inventa privilegios de administrador. `GNOSI_TEST_WORKSPACE_ID`
debe corresponder a una pertenencia; si no se indica, debe haber exactamente
una. `GNOSI_TEST_VAULT_ID` es opcional y no concede acceso. Mantenga privadas
las credenciales, las cookies y `GNOSI_TEST_STORAGE_STATE`.

`backend/tests/test_vault_creation_membership.py` cubre la creación autorizada
del primer vault, los rechazos por autenticación/rol/workspace, el confinamiento
de rutas y los listados de organización sin registrar almacenamiento personal.
Estas comprobaciones acotadas no acreditan toda la suite E2E, la matriz
Docker/Electron ni una publicación. El responsable de integración realiza
las comprobaciones restantes de navegador real, CI, SOP, generación de
documentación y aceptación por plataforma.
