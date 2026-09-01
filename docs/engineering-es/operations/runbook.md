---
status: implemented
last_verified: 2026-08-31
source_paths:
  - package.json
  - pyproject.toml
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - uv.lock
  - scripts/runtime/run_native_dev.sh
  - scripts/runtime/run_native_frontend.sh
  - scripts/check_public_runtime.py
  - frontend/vite.config.js
  - backend/app/health_contracts.py
  - backend/config/data_dir.py
  - backend/config/env_config.py
  - backend/config/paths_config.py
  - backend/platform/files/__init__.py
  - backend/platform/files/local.py
  - backend/platform/files/on_demand.py
  - backend/platform/files/onedrive.py
  - scripts/migrate-data-dir.py
  - backend/services/data_dir_migration.py
  - docker-compose.yml
  - compose.vaults.yml
  - Dockerfile.backend
  - Dockerfile.frontend
  - desktop/package.json
  - desktop/backend-launch.js
  - desktop/build-python.sh
  - desktop/electron-builder.yml
  - .github/workflows/build-release.yml
  - .github/workflows/documentation-pages.yml
  - tests/e2e/tests/setup/auth.setup.ts
  - tests/e2e/support/auth-playwright.ts
  - tests/e2e/support/auth-state.ts
tests:
  - pipeline/tests/test_native_runtime_wrappers.py
  - backend/tests/test_vault_creation_membership.py
  - backend/tests/test_data_dir.py
  - backend/tests/test_env_loading.py
  - backend/tests/test_data_dir_migration.py
  - backend/tests/test_health_api_contract.py
  - backend/tests/test_files_provider.py
  - desktop/backend-launch.test.js
  - desktop/packaging-contract.test.js
  - desktop/packaging-resources.test.js
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Manual de operaciones

Esta guía describe los contratos revisados en el código público. La fecha de
verificación corresponde a esa revisión, no a una instalación, migración o
publicación validada en todas las plataformas. Las órdenes siguientes son
instrucciones para el operador, no pruebas de que se hayan ejecutado.

## Desarrollo nativo como primera opción

Ejecute el backend FastAPI y el frontend Vite de forma nativa. Docker, Electron,
el almacenamiento en la nube y los LaunchAgents de macOS son opcionales.
Utilice Python 3.11, Node 22.22.2 y pnpm 11.19.0; la CI actual y el backend
Docker fijan uv 0.9.15. Desde la raíz del repositorio, prepare las dependencias
a partir de los archivos de bloqueo versionados:

```sh
uv sync --frozen
corepack pnpm install --frozen-lockfile
```

Inicie el backend y el frontend en terminales separados, ambos en la raíz del repositorio:

```sh
bash scripts/runtime/run_native_dev.sh 5002
```

```sh
bash scripts/runtime/run_native_frontend.sh --config vite.config.js --host 127.0.0.1
```

El wrapper del backend utiliza el entorno existente de la raíz mediante
`uv run --project "$BASE" --frozen --no-sync`, llama a las funciones canónicas
de Python `load_env()` y `resolve_data_dir()` e inicia uvicorn en loopback con
recarga limitada a `backend/`. No sincroniza ni instala dependencias.
No interpreta dotenv en el shell ni fuerza un vault OneDrive, un proveedor,
`HOME_HOST_PATH`, una zona horaria, un modelo o un endpoint de traducción.

El wrapper del frontend establece `COREPACK_ENABLE_NETWORK=0` y ejecuta
`corepack pnpm --filter @gnosi/frontend dev`; pnpm y las dependencias fijadas
ya deben estar disponibles. El ejemplo pasa una configuración Vite explícita
y una dirección loopback; sin `--host`, se aplica el host configurado en Vite.
Establezca `VITE_BACKEND_HOST` y `VITE_BACKEND_PORT` explícitamente para otro
backend (valores predeterminados: `localhost` y `5002`). Vite carga sus dotenv;
el wrapper no exporta un `VITE_FRONTEND_PORT` predeterminado que los oculte.
Ambos wrappers validan los puertos proporcionados entre 1 y 65535, transmiten
los argumentos y propagan los códigos de salida. El frontend conserva las
etiquetas explícitas del checkout y avisa si ya se ha integrado y ha quedado
por detrás de `origin/main`.

Para un vault local, configure su directorio real y seleccione
`GNOSI_FILES_PROVIDER=local`; no hace falta ningún servicio auxiliar de
descarga. Distinga el vault activo del directorio padre que contiene varios
vaults. `DIGITAL_BRAIN_VAULT_PATH` tiene prioridad sobre `VAULT_HOST_PATH`;
esta segunda variable también interviene en la detección del proveedor.
Si el entorno no establece una ruta, el backend puede utilizar el vault
seleccionado en Configuración.

| Servicio | Dirección predeterminada | Comprobación |
| --- | --- | --- |
| Frontend | `http://localhost:5173` | Se muestra el inicio de sesión o la interfaz de la aplicación; la navegación funciona. |
| Backend | `http://127.0.0.1:5002` | `/api/health` y, después, peticiones autorizadas de configuración y del vault. |

Vite utiliza `strictPort: true`: resuelva los conflictos de puerto en vez
de aceptar un puerto alternativo. HTTPS es opcional: el modo automático utiliza
certificados locales legibles; `VITE_DEV_HTTPS=false` fuerza HTTP y
`VITE_DEV_HTTPS=true` exige certificados. Reinicie Vite si cambian los
certificados. El código se recarga; los cambios de dependencias requieren
sincronizar los archivos de bloqueo y reiniciar el proceso afectado. Reinicie
el frontend para actualizar los valores de versión inyectados durante el arranque.

## Build del frontend y enlaces directos

Ejecute `corepack pnpm build:frontend` desde la raíz del repositorio. Las
comprobaciones previas incluyen el contrato de la configuración real de Vite.
Por defecto, los recursos utilizan `/`: los enlaces profundos y las recargas
resuelven JavaScript, estilos e iconos desde la raíz del origen. El mismo
artefacto sirve para el alojamiento web HTTP y el protocolo estándar `app://gnosi` de
Electron; Electron no necesita una base relativa `./`.

`VITE_BASE_PATH` se mantiene como configuración explícita de la base de recursos.
El valor `./` reintroduce la resolución relativa en rutas anidadas. Un prefijo
de recursos no configura la base del enrutador ni demuestra soporte para montar
toda la app bajo un prefijo de URL. Mantenga el valor por defecto para las
estructuras web y desktop estándar. El servidor HTTP debe devolver la entrada
SPA para las rutas de la app, servir los recursos reales y enviar `/api` al
backend. Vite preview ya incluye ese proxy de API; es un servidor de validación,
no una prueba de aceptación del despliegue en producción.

## Configuración y datos persistentes

La carga del entorno del backend sigue este orden para cada variable: entorno
del proceso, `.env` local del repositorio y archivo compartido seleccionado
explícitamente mediante `GNOSI_SHARED_ENV_FILE`. No se busca implícitamente
ningún `.env_shared` en los directorios padre. El archivo compartido pertenece
al operador y la limpieza del entorno de Gnosi no lo modifica. El almacenamiento
seguro nativo puede aportar credenciales que faltan; no sustituye un valor
ya establecido.

Después de cargar el entorno, la resolución del directorio de datos toma el
primer valor no vacío en este orden: `GNOSI_DATA_DIR`, `GNOSI_LOCAL_DATA`,
`LOCAL_DATA_DIR` y valor predeterminado de la plataforma. Ambos alias están
obsoletos, pero siguen admitidos durante toda la serie 3.x. Configure el nombre
canónico de forma coherente: un valor canónico en conflicto prevalece sobre un
alias, aunque este proceda de una fuente de entorno de mayor prioridad.
Prefiera rutas absolutas: las relativas se resuelven respecto al directorio
de trabajo del proceso.

| Entorno del backend | Directorio de datos predeterminado si no se ha configurado |
| --- | --- |
| macOS | `~/Library/Application Support/Gnosi` |
| Linux | `$XDG_DATA_HOME/gnosi` o, si no está definido, `~/.local/share/gnosi` |
| Windows | `%APPDATA%\Gnosi` o, si no está definido, `~/AppData/Roaming/Gnosi` |
| Docker | `/data`; Compose monta ahí el volumen con nombre `gnosi_local_data`. |

El antiguo directorio `local_data` dentro del checkout no es el valor
predeterminado nativo. El contenido del vault y su configuración `.gnosi/`
están separados del estado de cada dispositivo. Mantenga `GNOSI_DATA_DIR`
en almacenamiento local no sincronizado, fuera del árbol de código.
Conserve `system/management.sqlite`, `system/tool_registry.sqlite`,
`system/checkpoints`, `secrets` y el resto del estado necesario antes de
reinstalar o migrar. No copie archivos SQLite en uso a un vault sincronizado
ni ejecute instancias independientes de Gnosi sobre el mismo directorio de
datos. En otro dispositivo puede ser necesario volver a conectar OAuth,
porque las credenciales y el almacenamiento seguro son locales.

Para trasladar los datos de forma deliberada, revise
`scripts/migrate-data-dir.py`: ofrece `plan`, `migrate`, `status`,
`rollback` y `finalize`. La planificación puede crear el directorio padre
de destino; por tanto, no es un diagnóstico puramente de lectura. Detenga
todos los procesos que escriben antes de migrar o revertir;
`--writers-stopped` es una confirmación del operador, no un detector de
procesos. El servicio registra el progreso en un diario, comprueba la
integridad SQLite y consolida el WAL. Realiza un cambio de nombre dentro del
mismo volumen o una copia provisional verificada entre volúmenes; en el
segundo caso conserva el origen. Guarde el diario y la copia de seguridad,
verifique el destino y configure `GNOSI_DATA_DIR` antes de reiniciar.
Cambiar solo la variable no traslada los datos existentes.

## Primera secuencia de diagnóstico

1. Identifique el entorno elegido, el checkout, el propietario del proceso y
   quién escucha en cada puerto antes de iniciar o reiniciar nada.
2. Revise los registros del backend y del frontend de ese entorno; no
   presuponga las rutas de los LaunchAgents.
3. Consulte `/api/health`: `status`, `mode`, `gnosi_mode`,
   `require_auth` y `vault_configured`. Una respuesta de salud no demuestra
   que el vault se pueda leer.
4. Utilice una sesión autorizada para `/api/config` y `/api/vault/pages`.
   Distinga los errores de autenticación o permisos de un vault vacío o un
   error de E/S; oculte credenciales y rutas privadas antes de compartir diagnósticos.
5. Confirme el vault activo, el directorio de datos efectivo y el proveedor
   seleccionado. No restablezca la configuración ni sustituya bases de datos
   para corregir una ruta equivocada.
6. Reproduzca la acción afectada de la interfaz mientras revisa la consola del
   navegador y los registros del backend; después ejecute la prueba más específica.
7. Tras la reparación, verifique tanto los datos devueltos como la acción
   visible; reiniciar un proceso no es, por sí solo, prueba de recuperación.

## Disponibilidad de archivos y recuperación específica del proveedor

Empiece por el adaptador seleccionado en `backend/platform/files`.
`GNOSI_FILES_PROVIDER` selecciona explícitamente un proveedor reconocido;
en caso contrario, la detección utiliza `VAULT_HOST_PATH`.
`LocalProvider` no realiza ninguna hidratación. El nombre de un proveedor
o una interfaz compartida no acreditan el comportamiento de todos los
clientes de nube en todos los sistemas operativos.

En almacenamiento File Provider de macOS, `EDEADLK` o `EAGAIN` pueden
indicar archivos no disponibles que solo están en la nube. Estos errores,
por sí solos, no demuestran un fallo del proveedor ni del analizador Markdown:
compruebe la ruta exacta, los indicadores del archivo, los bloques descargados
y el estado del cliente. Reintente el ámbito afectado más pequeño con intentos
limitados y secuenciales; no convierta una exploración de recuperación parcial
en un índice completo ni sustituya contenido ilegible por archivos vacíos.
Mantener los directorios críticos descargados localmente puede evitar que
el problema se repita.

El adaptador actual de archivos bajo demanda utiliza `open` por defecto en
macOS nativo y delega las lecturas en una aplicación gráfica mediante
LaunchServices; las lecturas directas desde un proceso launchd pueden no
activar la descarga. El modo daemon llama a un servicio auxiliar del host
configurado, con los valores predeterminados
`http://127.0.0.1:5009/warmup` en nativo o
`http://host.docker.internal:5009/warmup` desde Docker. Ese servicio debe
estar realmente configurado para el entorno elegido; el puerto 5009 no es
un requisito general de arranque ni una prueba de que la hidratación funcione
con cualquier nube.

Solo el adaptador de OneDrive activa el reinicio del cliente OneDrive después
de un intento `open` fallido. `ONEDRIVE_AUTO_RESTART=0` desactiva esa acción;
el intervalo mínimo predeterminado entre reinicios es de 300 segundos.
Trate los reinicios del cliente y la configuración de los servicios auxiliares
del host como cambios operativos separados. No aplique las instrucciones de
recuperación de OneDrive a otros proveedores.

## Configuración opcional del host macOS

Los 15 scripts históricos del runtime del host (instaladores, watchdogs y
herramientas del host), junto con los lanzadores obsoletos `run_brain.sh` y
`run_prod.sh`, se han retirado del repositorio público. Las operaciones del host
pertenecen al repositorio privado `WorkspaceTools`. Ejecute `pnpm check:runtime`
tras preparar los cambios revisados: CI rechaza scripts retirados, enlaces
simbólicos y estado local en el índice Git. Las instalaciones existentes
pueden escribir registros en `~/Library/Logs/Gnosi`; revise su configuración real. Son
facilidades opcionales del host, no el contrato de arranque portable. Las
definiciones de servicios específicas de cada máquina, las rutas privadas y
el historial de incidentes pertenecen al repositorio privado `WorkspaceTools`,
no a los requisitos públicos.

Esta limpieza del checkout no modifica, migra ni desinstala los servicios
instalados del host. Los wrappers portables anteriores no instalan ni eliminan
servicios existentes del host. El instalador histórico `install_native_startup.sh`
detiene los procesos que escuchan en 5002/5173 y recarga LaunchAgents.
No ejecute los instaladores o watchdogs conservados como diagnóstico; revise
la configuración real instalada y los procedimientos privados.

Si una instalación aún utiliza una copia conservada de `native_watchdog.sh`, revise
`~/.gnosi_native_watchdog.log` para detectar bucles de reinicio. El margen
de arranque (`GNOSI_NATIVE_STARTUP_GRACE`) y el intervalo mínimo entre
reinicios (`GNOSI_NATIVE_WATCHDOG_COOLDOWN`) son de 600 segundos por defecto.
Deje tiempo suficiente para un arranque en frío o una recarga y mantenga el
intervalo al menos tan largo como el tiempo de arranque medido. Una señal
reciente de actividad del clon puede aplazar el reinicio. El script también
mata procesos multiprocessing coincidentes e invoca launchd: la selección
de procesos es amplia; no lo ejecute como diagnóstico genérico ni lo instale
sin revisar las otras cargas Python del host.

## Despliegue Docker opcional

Docker es un destino de autoalojamiento compatible y opcional. El archivo base
`docker-compose.yml` no necesita ningún directorio de vault del host ni rutas
propias del mantenedor:

| Contenido persistente | Volumen con nombre | Ruta en el contenedor |
| --- | --- | --- |
| Bases de datos y credenciales por dispositivo | `gnosi_local_data` (clave conservada) | `/data`, mediante `GNOSI_DATA_DIR` |
| Vaults | `gnosi_vaults` (volumen nuevo) | `/vaults`, mediante `GNOSI_VAULTS_ROOT`; activo predeterminado `/vaults/default` |

Los vaults existentes del host no se copian automáticamente al volumen nuevo.
Conserve el nombre del proyecto Compose al actualizar: determina la identidad
de los volúmenes con nombre. Cambiarlo puede seleccionar volúmenes vacíos
mientras los datos anteriores siguen existiendo. Haga copias de seguridad de
las bases de datos, credenciales y vaults antes de cualquier cambio. Nunca
utilice `docker compose down -v` ni una purga generalizada de volúmenes para
reparar dependencias.

Los puertos publicados son `127.0.0.1:5002` y `127.0.0.1:5173` por defecto.
`GNOSI_BIND_ADDRESS`, `GNOSI_BACKEND_PORT` y `GNOSI_FRONTEND_PORT` configuran
la publicación en el host; los puertos internos siguen siendo 5002/5173 y el
frontend actúa como proxy hacia `backend:5002`. Compose fuerza HTTP en el
frontend. Revise la autenticación, TLS y el acceso de red antes de cambiar la
dirección de escucha para exponer el servicio.

Proporcione un `GNOSI_JWT_SECRET` privado y robusto mediante el shell o el
`.env` local para la interpolación de Compose. Un `env_file` del servicio no
satisface, por sí solo, la expresión obligatoria. Compose establece
explícitamente `GNOSI_REQUIRE_AUTH=1`; no desactive la autenticación para
superar una prueba básica.

Compose lee un `env_file` compartido opcional seleccionado mediante
`GNOSI_SHARED_ENV_FILE` (alternativa `.env.shared.disabled`) y después el
`.env` opcional; este último prevalece en las claves repetidas. Las entradas
explícitas de `environment` del servicio prevalecen sobre ambos archivos.
Son reglas del entorno del contenedor: las variables arbitrarias del shell
del host no se transmiten automáticamente. Compose lee los archivos en el
host, sin montarlos ni incluirlos en las imágenes, y vacía
`GNOSI_SHARED_ENV_FILE` dentro del backend para no volver a cargar una ruta
del host. No exige implícitamente ningún `.env_shared` de los directorios padre.

El conjunto incluye el translation-server de Zotero internamente en 1969,
sin publicarlo en el host. `GNOSI_TRANSLATION_IMAGE` selecciona su imagen;
`TRANSLATION_SERVER_URL` toma `http://translation-server:1969` solo si no
está definida y conserva un valor vacío explícito. La traducción es opcional
para Gnosi, pero este archivo Compose declara el servicio auxiliar sin un
perfil opcional.

Para utilizar directorios existentes del host, añada explícitamente
`compose.vaults.yml`:

```sh
docker compose -f docker-compose.yml -f compose.vaults.yml up -d --build
```

Antes de esa orden, proporcione `VAULT_HOST_PATH` (vault activo existente)
y `VAULTS_ROOT_HOST_PATH` (directorio padre existente) a la interpolación de
Compose. Ambas rutas son obligatorias; los dos montajes utilizan
`create_host_path: false` para rechazar directorios inexistentes. Prefiera
rutas absolutas; las relativas se resuelven desde el directorio del Compose
base. La sobrescritura sustituye el volumen de `/vaults` según el destino en
el contenedor, añade el montaje activo en `/vault` y establece
`DIGITAL_BRAIN_VAULT_PATH=/vault`. Conserva `gnosi_local_data:/data` y
transmite las dos rutas del host seleccionadas para traducir las acciones
sobre archivos. No copia datos ni configura servicios auxiliares del host.

El conjunto base no monta código fuente, dependencias del host, directorio
personal, árbol privado `.antigravity`, directorio de secretos ni socket
Docker. La sobrescritura de vaults añade solo los dos directorios
seleccionados. El CLI Docker de la imagen del backend no da acceso al motor
del host sin un socket o un endpoint configurado por separado. El código y las
dependencias pertenecen a las imágenes: no hay recarga del código del host ni
volúmenes anónimos de `node_modules` que renovar. Reconstruya las imágenes si
cambian el código o los archivos de bloqueo; conserve los volúmenes persistentes.

`Dockerfile.frontend` utiliza Node 22.22.2, pnpm 11.19.0 y
`--frozen-lockfile`, y sirve Vite en el puerto estricto 5173. El backend exporta
`uv.lock` con `--frozen`, instala el wheel fijado de Torch solo para CPU y
después los requisitos exportados; uvicorn se ejecuta sin `--reload`.
La disponibilidad del wheel, las compilaciones y el arranque requieren
validación por plataforma. Los tests estáticos de código y contratos no
sustituyen la fusión real de Compose, las compilaciones en el motor, las pruebas
básicas de los contenedores ni la aceptación por plataforma.

## Aceptación autenticada y límites de la QA

La aceptación nativa debe probar el registro real, la creación de un workspace
y del primer vault, el inicio de sesión, `/api/auth/me`, las cookies HttpOnly
y la preparación de autenticación de Playwright, con arranque y parada limpios.
En el navegador hay que crear y editar una página desechable, recargarla y
reabrirla para verificar la persistencia del título y del cuerpo, revisar la
consola y comprobar el cierre de sesión. Superar la fixture y el flujo de
navegador no acredita toda la suite E2E, la matriz Docker/Electron ni una publicación.

La preparación E2E exige `GNOSI_TEST_EMAIL` y `GNOSI_TEST_PASSWORD` explícitos
de una cuenta de prueba desechable ya creada antes de acceder a la red.
Inicia sesión y la verifica con `/api/auth/me`; no registra cuentas ni inventa
una identidad de administrador. `GNOSI_TEST_WORKSPACE_ID` debe corresponder
a una pertenencia verificada; omítalo solo si hay exactamente una.
`GNOSI_TEST_VAULT_ID` es opcional y no concede permisos. Mantenga privado el
estado de sesión, preferiblemente en un `GNOSI_TEST_STORAGE_STATE` temporal,
y no active trazas, capturas, vídeo ni registros de diagnóstico de la
preparación que puedan contener credenciales.

`backend/tests/test_vault_creation_membership.py` cubre la creación del
primer vault con pertenencia autenticada owner/admin/editor, rechaza
peticiones sin autenticar, de solo lectura o de otros workspaces, y comprueba
el confinamiento de rutas y el listado de organización sin registrar el vault
personal. Esta cobertura de regresión no sustituye la validación real de la
aplicación y del navegador. El responsable de integración mantiene las
comprobaciones completas de navegador, CI, SOP y aceptación por plataforma.

Desde la raíz del repositorio, `corepack pnpm test:e2e:contracts` ejecuta los
contratos de autenticación, JSON y rutas de API sin red, y después comprueba
estrictamente los tipos de todos los archivos TypeScript E2E activos y de apoyo:
pruebas funcionales, anónimas, de accesibilidad y visuales. El alias específico
`typecheck:auth` sigue disponible. No inicia la aplicación ni sustituye la
aceptación real de inicio de sesión y navegador; las pruebas JavaScript archivadas
quedan fuera de esta comprobación.

## Empaquetado Electron opcional

Electron utiliza el valor heredado de `GNOSI_DATA_DIR`, después
`GNOSI_LOCAL_DATA` y después `LOCAL_DATA_DIR`; si no hay ninguno, pasa su
perfil `userData` al backend incluido. No presuponga que ese perfil coincide
con el directorio predeterminado de Python nativo en todos los sistemas
operativos. Conserve el perfil y también los datos del backend configurados
por separado antes de actualizar.

El workspace fija la versión de Electron y desactiva la descarga automática
del binario. `corepack pnpm --filter @gnosi/desktop install:runtime` es el
paso explícito de instalación del binario para ejecutar Electron localmente.
Compile el frontend antes de empaquetar. `desktop/build-python.sh` requiere
Python 3.11 y uv, crea un entorno temporal y utiliza
`uv sync --frozen --no-default-groups --group desktop` con el archivo de
bloqueo del repositorio. Comprueba los límites de los recursos, ejecuta
PyInstaller, verifica el paquete y ejecuta la prueba básica del backend
empaquetado. Actualmente no se fija pip 25.3; diagnostique los errores de
proxy o del índice de paquetes en el runner afectado en vez de recuperar
aquella solución histórica.

| Destino declarado en el workflow de publicación | Artefactos configurados |
| --- | --- |
| macOS arm64 | DMG y ZIP |
| macOS x64 | DMG y ZIP |
| Linux arm64 | AppImage y DEB |
| Windows x64 | Instalador NSIS |

Son destinos configurados, no resultados de aceptación. La arquitectura del
backend Python empaquetado debe coincidir con el destino Electron.
Los jobs de publicación actuales no cubren Linux x64 ni Windows arm64.
Los contratos estáticos o una compilación del frontend no acreditan una
instalación limpia, el primer arranque, la actualización, la reversión, la
firma ni la conservación de datos reales en ningún destino. Exija pruebas
reales de cada plataforma antes de publicar; la validación de Docker es
una comprobación separada.

## Mapa de síntomas habituales

| Síntoma | Área probable | Siguiente evidencia |
| --- | --- | --- |
| Frontend en blanco | Error JavaScript, fragmento antiguo, inicialización de la autenticación | Consola del navegador, registro de Vite, compilación de producción. |
| La salud responde, pero el vault falla | Ruta del vault, permisos, disponibilidad de archivos | Configuración autorizada, registros del vault, ruta exacta que falla. |
| La configuración se revierte | Destino de params incorrecto, escritura fallida, migración | Contexto del vault activo y origen de los parámetros. |
| Una integración aparece desconectada | Credencial local ausente o selección de cuenta obsoleta | Estado de la cuenta con secretos ocultos y almacenamiento de secretos configurado. |
| El agente no tiene herramientas | Conexión MCP, validación del catálogo, asignación de skills | Registros de descubrimiento y endpoints de skills autorizados. |
| El correo deja de actualizarse | Proceso de la cuenta o autenticación del proveedor | Estado del proceso de cada cuenta y sincronización incremental. |
| El escritorio muestra una versión antigua | Renderer/backend antiguo o manifests incoherentes | Checkout/paquete realmente en ejecución y versiones de los paquetes. |

## Documentación y aprendizaje de los incidentes

Utilice el workflow pre-PR de documentación descrito en
[Mantenimiento de la documentación](../testing/documentation-maintenance.md).
Revise manualmente los cuatro idiomas; actualice de forma determinista solo
los catálogos generados. El responsable de integración ejecuta las
comprobaciones pre-PR, las compilaciones estrictas de los cuatro portales y
la QA en el navegador cuando los workers hayan terminado. Mantenga
`site/engineering` y los subdirectorios de idiomas fuera del control de versiones.

El workflow de Pages está configurado para publicar los cambios de
documentación de `main` en el
[portal de ingeniería](https://gnosi.temenosismael.org/engineering/).
Si falla, revise la validación de las referencias generadas, la trazabilidad
y las compilaciones estrictas de los idiomas antes del artefacto Pages.
Compruebe la fuente real de publicación de Pages y los permisos del entorno
`github-pages`; el código del workflow no demuestra que el despliegue haya funcionado.

Registre las causas de los incidentes, los intentos fallidos y la recuperación
verificada. Mantenga los detalles privados de las máquinas y las directivas
de desarrollo en `WorkspaceTools`; publique solo lecciones portables con
pruebas de código y tests. Corrija la implementación y añada pruebas de
regresión específicas cuando proceda. Una recuperación realizada solo en
el terminal, sin verificación ni documentación, no completa una reparación operativa.
