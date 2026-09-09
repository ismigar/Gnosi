---
status: implemented
last_verified: 2026-09-09
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
  - frontend/src/app/App.tsx
  - frontend/src/shared/plugins/usePlugins.ts
  - backend/app/health_contracts.py
  - backend/domains/calendar/timing.py
  - backend/utils/request_profile.py
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
  - frontend/src/app/App.pluginRecovery.test.tsx
  - frontend/src/app/App.loginPluginRecovery.test.tsx
  - backend/domains/calendar/tests/test_timing.py
  - backend/tests/test_request_profile.py
  - backend/tests/test_graph_request_timing.py
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

La comprobación de disponibilidad del navegador utiliza la misma instantánea
global del proceso que las sondas nativas: una cookie, cabecera o consulta del
vault activo no activa su resolución en la ruta exacta `GET /api/health`.
Las demás rutas y métodos mantienen el enrutamiento habitual. La autodetección
de la política de autenticación comparte solo lecturas pendientes; los seguidores
HTTP esperan una tarea en vez de ocupar workers bloqueados. El TTL existente
de cinco segundos sigue comenzando con la lectura original; un restablecimiento
retira la generación pendiente, las variables explícitas del entorno se mantienen
actualizadas, las sesiones explícitas de base de datos evitan la reutilización
y los errores siguen exigiendo autenticación.

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
backend (valores predeterminados: `127.0.0.1` y `5002`). Vite carga sus dotenv;
el wrapper no exporta un `VITE_FRONTEND_PORT` predeterminado que los oculte.
Ambos wrappers validan los puertos proporcionados entre 1 y 65535, transmiten
los argumentos y propagan los códigos de salida. El frontend conserva las
etiquetas explícitas del checkout y avisa si ya se ha integrado y ha quedado
por detrás de `origin/main`.

Para el uso nativo habitual, compile una vez y sirva la aplicación compilada:

```sh
corepack pnpm --dir frontend run build
GNOSI_NATIVE_FRONTEND_MODE=preview bash scripts/runtime/run_native_frontend.sh
```

Preview utiliza el mismo puerto estricto, certificados HTTPS, redirección de
HTTP a HTTPS y proxy del backend. Sirve una copia aislada de `frontend/dist`,
por lo que una compilación posterior no puede eliminar recursos de la aplicación
en ejecución. Al detenerse elimina solo la copia de ese proceso. Vuelva a compilar
y reinicie para aplicar cambios de código; el valor predeterminado
`GNOSI_NATIVE_FRONTEND_MODE=dev` mantiene las actualizaciones del código en directo.
La ausencia de una compilación o un modo inválido producen un error explícito.
Un LaunchAgent gestionado puede seleccionar preview con esa variable de entorno;
recargue la tarea después de cambiar su entorno almacenado.

Las compilaciones incluyen un manifiesto Vite. Preview lo utiliza para identificar
los recursos públicos exactos con hash de contenido y servirlos con caché inmutable
del navegador en respuestas GET/HEAD correctas, incluida la validación 304.
HTML, respuestas API, recursos inexistentes, archivos públicos no enumerados y
otros métodos mantienen su política de caché. Cambiar el contenido cambia su
URL compilada; la entrada HTML sigue revalidándose para descubrir la compilación
actual. Las compilaciones antiguas sin manifiesto mantienen la política original
de Vite. Esto elimina revalidaciones repetidas después de que el navegador reciba
las nuevas cabeceras; no elimina la latencia de la primera descarga ni de las API.

El arranque deja pasar las peticiones de enrutamiento y salud por su middleware
asíncrono antes de programar las descargas de la ruta y la interfaz principal.
Cede un turno al navegador sin esperar ninguna respuesta; la representación sigue
respetando la preparación del enrutamiento y del idioma. La compilación agrupa
solo los 51 iconos de la interfaz principal revisados explícitamente. Los demás
iconos y las rutas pesadas siguen siendo diferidos, y las dependencias compartidas
de los iconos mantienen su ubicación automática. Después de cambiar el grupo,
revise el grafo de importaciones compiladas para detectar ciclos nuevos o
dependencias iniciales inesperadas, además de los límites de bytes.

Una cookie de sesión inválida puede rechazar peticiones de vault aunque se permita
el acceso anónimo local. `/auth/me` distingue ese caso de un 401 anónimo habitual.
La interfaz ofrece una acción explícita de recuperación de la cookie inválida:
llama al endpoint existente de cierre de sesión, borra los metadatos locales de
identidad solo si tiene éxito y recarga la aplicación. Si falla el cierre, la
recuperación sigue disponible. Esto no cambia la política de autenticación ni
el acceso a páginas compartidas públicas.

Un 401 explícito de una ruta protegida con `Authentication required` es un caso
diferente: cuando `/api/auth/me` informa de un usuario anónimo, muestre Login en
vez de diagnosticar una cookie caducada o pedir el cierre de sesión. La respuesta
del servidor al catálogo de complementos prevalece sobre una instantánea anterior
de salud que indique autenticación desactivada. La corrección
`authenticationRequired` de `usePlugins` y App tiene 17 pruebas focalizadas,
una comprobación focalizada de tipos, lint de los archivos existentes y una
compilación correctos. Una prueba adicional de integración de App verifica que
iniciar sesión en el mismo vault recarga los complementos y abandona Login;
su lint también pasa. La activación con TLS de confianza y la pantalla real de
Login están verificadas; no se ha iniciado ni cerrado ninguna sesión real ni
se han leído credenciales. Consulte el trabajo de tiempos del calendario en la
[auditoría de latencia de navegación](navigation-latency-audit-2026-09-08.md).

El perfilado Python con privilegios no es la única vía de diagnóstico. La
instrumentación opcional de duraciones del calendario mediante
`X-Gnosi-Calendar-Timing: 1` y `Server-Timing` está implementada y activada en
las rutas de calendarios y eventos. Informa de tiempos de cola, resolución de
credenciales y HTTP sin exponer credenciales ni contenido del calendario. Solo
se propaga el contexto `CalendarTiming`; los contextos de vault y autenticación
y los resultados de las consultas no cambian. Los tiempos son inclusivos y
pueden ser concurrentes, por lo que no deben sumarse para reconstruir el total.
`cal_total` excluye middleware y validación de respuesta y no es la duración HTTP
completa. `cal_service` incluye el acceso a la capa de servicio, las importaciones
de discovery anteriores a las credenciales anidadas y la construcción del cliente;
no es tiempo puro de `build`. Han pasado la batería de 35 pruebas del calendario,
la repetición de sus 9 pruebas nuevas, Ruff y mypy. La verificación real con acceso
a datos devolvió HTTP 200 con un calendario y dos eventos visibles después de
10.557 s. No se reprodujo la espera anterior de 47–52 s en el servidor; quedan
intervalos locales sin explicar, y este cambio de diagnóstico no demuestra una
mejora global atribuible de latencia. Esta vía no requiere autorización administrativa.

Hay un muestreador Python dentro del proceso para peticiones del grafo con
`X-Gnosi-Graph-Profile: 1`, y para peticiones de eventos del calendario con
`X-Gnosi-Calendar-Profile: 1` y `X-Gnosi-Calendar-Timing: 1` a la vez. Permite un
muestreador simultáneo, durante un máximo de 15 s a 20 Hz, que observa el hilo
principal y los workers registrados explícitamente. Solo registra nombres
normalizados de archivos de código, nombres de función y números de línea,
sin variables locales, globales, argumentos, nombres de hilos, datos del usuario
ni trazado del correo. La salida agregada se limita a 256 pilas de 32 frames e
incluye el identificador del proceso y el instante de inicio monotónico. El archivo
con modo `0600` `/tmp/gnosi-request-profile-<id>.json` se guarda al llegar al
límite de 15 s aunque la petición siga pendiente. La parada espera como máximo
250 ms; la respuesta incluye `X-Gnosi-Request-Profile-Id` cuando la persistencia
ya ha terminado. No se necesita autorización administrativa. Han pasado la
batería de 35 pruebas del muestreador, calendario y grafo, Ruff, mypy y la activación
del backend. Las capturas del grafo y del calendario se completaron sin privilegios
administrativos. La captura del grafo tenía 39 observaciones dentro de una ventana
máxima de 15 s, 33 pilas agregadas y ninguna descartada. El intervalo nominal de
50 ms no fue constante en la práctica: no multiplique los recuentos por ese
intervalo para obtener duraciones. Un frame del runner de uvloop no distingue
inactividad de trabajo nativo en C. La captura posterior del calendario tenía
34 observaciones, 19 pilas y ninguna descartada; los frames de espera de workers
y de caché de discovery son observaciones, no duraciones aditivas. Estos límites
describen la recogida de diagnóstico, no una corrección de latencia. Las correcciones
de decodificación JSON, admisión limitada en la caché de metadatos y discovery
estático de Google están implementadas y validadas: han pasado 80 casos de prueba
únicos, Ruff, mypy y la comprobación del diff. La activación del backend terminó
en 185.3 s. Las aperturas directas posteriores, solo con tiempos y recursos
compilados en caché, mostraron el grafo después de 22.128 s y datos frescos del
calendario después de 16.081 s. Estas medidas no demuestran una mejora global
de latencia ni el objetivo de 0.5 s. La navegación final en caliente mostró
datos del grafo después de 7.447 s y datos frescos del calendario después de
5.392 s; los datos ya cargados del calendario eran visibles a los 398 ms.
Mantenga separados los tiempos de visibilidad y de datos frescos. La verificación
y la limpieza están completas, mientras que el objetivo de latencia sigue parcial.
Se restauró el HTML de la copia nativa, se eliminaron el script de tiempos y
las dos capturas, y el calendario accesible de loopback volvió a la vista mensual
sin consulta de auditoría. HTTPS devolvió 200 con verificación TLS correcta y
HTML `no-cache`; HTTP redirigió con 307 a HTTPS, y los recursos compilados mantuvieron
un año de caché inmutable.

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

El frontend nativo gestionado establece `pnpm_config_verify_deps_before_run=warn`
por defecto y conserva cualquier valor explícito. Reiniciar un servicio no debe
activar una reinstalación implícita de dependencias cuando otra tarea cambia los
manifiestos del workspace. Instale y sincronice las dependencias explícitamente
antes de reiniciar el servidor afectado; el aviso no demuestra que las dependencias
instaladas coincidan con el archivo de bloqueo.

Para HTTPS local de confianza, instale `mkcert` y ejecute
`bash scripts/runtime/setup-https-dev.sh`; después reinicie el frontend.
La configuración instala una autoridad de certificación local en el almacén de
confianza de la máquina y genera certificados ignorados en `frontend/certs/`.
Con esos certificados, `https://localhost:5173` sirve la aplicación y HTTP
redirige a la misma ruta y consulta mediante HTTPS. Los archivos de certificado
por sí solos no bastan si el navegador no confía en la autoridad local.

El desarrollo nativo utiliza notificaciones del sistema de archivos. Establezca
`CHOKIDAR_USEPOLLING=true` solo para sistemas de archivos o montajes bind de
contenedores que necesiten sondeo. Vite prepara la interfaz principal, Conocimiento
y el Centro de control al arrancar; las demás pantallas siguen siendo diferidas
y se precargan cuando existe intención de navegar a ellas.

El idioma inicial y el formato de registros utilizan `/api/config/interface`,
una respuesta pequeña de preferencias visuales limitada al vault y con el mismo
control de permisos que la configuración. No lee el estado de las credenciales;
`/api/config` sigue siendo la respuesta completa de configuración, incluidos los
indicadores de credenciales. Los editores y el Centro de control leen
`/api/config/editor`, que conserva los campos editables y extensiones, normaliza
referencias de proveedores y valores predeterminados, y excluye credenciales en
texto plano e indicadores de disponibilidad de solo lectura sin consultar almacenes
de credenciales. Guardar la configuración invalida las cachés correspondientes del
frontend. Las lecturas de editores comparten solo peticiones solapadas por vault;
las posteriores se revalidan inmediatamente. Configuración carga sus documentos
editables una vez por apertura del modal, incluso cuando el modo de desarrollo
repite los efectos de montaje. Cerrar y volver a abrir sigue pidiendo documentos
frescos de configuración, integración e identidad. Los selectores de campos y
registros reutilizan un comparador de configuración regional por ordenación.
La configuración de Planificación conserva las tablas, proyectos y tareas ordenados
hasta que cambian sus datos o la configuración regional, por lo que editar campos
no relacionados no vuelve a ordenar cientos de opciones.

El enrutamiento del vault resuelve las consultas iniciales SQLite y de carpetas
en la nube en workers. Las peticiones concurrentes de la misma identidad comparten
una consulta; los cambios de vault invalidan la caché de identidad de 60 segundos,
incluidas las consultas en curso. El contexto del vault activo se establece en
la tarea de petición después de consultar, antes de llamar al endpoint. Los lectores
HTTP solapados esperan una tarea compartida en vez de ocupar workers mientras otro
resuelve la misma identidad. Desconectar un lector no puede cancelar la consulta
que necesitan otras peticiones.

Los lectores de configuración reutilizan preparaciones correctas de directorios
durante un máximo de 30 segundos, con un límite de 256 rutas. YAML, selección de
vault y lecturas de archivos mantienen las comprobaciones habituales de frescura
y permisos. Las preparaciones fallidas se reintentan, y las llamadas directas a
`get_paths()` siguen comprobando y reparando inmediatamente. Si se elimina un
directorio preparado, una lectura de configuración puede aplazar su recreación
hasta que expire ese intervalo.

Las lecturas de cuentas de correo resuelven credenciales solo para la cuenta
seleccionada o las cuentas habilitadas durante la sincronización, excluyendo
integraciones ajenas. Las lecturas de carpetas de correo, los recordatorios del
calendario y la construcción del grafo se ejecutan en workers, incluida la carga
de configuración y registro. Configuración carga datos auxiliares de modelos,
calendario, lector y redes sociales al abrir la sección que los utiliza. El grafo
muestra inmediatamente los datos disponibles, sin un retraso mínimo de carga,
y reutiliza la ruta resuelta de configuración del vault al leer metadatos
gestionados de cada nodo. Si existe un índice de páginas, el descubrimiento del
grafo utiliza sus rutas y fechas de modificación, evitando un segundo recorrido
del sistema de archivos de la nube. Los nodos sin cambios conservan los enlaces
completos del cuerpo en caché; los nodos cambiados se vuelven a analizar. Un índice
antiguo ausente o ajeno provoca el recorrido del sistema de archivos. La frescura
del índice sigue el observador y la actualización en segundo plano existentes.
La caché en disco de nodos analizados se escribe solo después de que cambie un
nodo. La persistencia codifica una instantánea y utiliza el escritor atómico en
vez de millones de pequeñas escrituras JSON. Los lectores iniciales concurrentes
esperan una carga completa; los cambios que llegan durante un guardado permanecen
pendientes y los guardados fallidos se reintentan en la siguiente reconstrucción.
Las cachés persistentes de nodos del grafo se particionan por ruta de vault bajo
`LOCAL_CACHE/graph_nodes/`. Un vault sin caché propia lee una vez sus entradas del
antiguo `graph_node_cache.json` y escribe su partición; el archivo antiguo queda
intacto para los demás vaults. El estado cargado y pendiente de guardar se controla
por separado por vault, de modo que abrir uno no exige decodificar todas las
entradas antiguas de los demás.
Un archivo adyacente de metadatos vincula los nodos analizados con su clasificación,
colores y sidecars gestionados mediante un resumen del JSON real de los nodos.
Las cachés antiguas o los marcadores que no coinciden requieren una regeneración.
Los marcadores se publican solo después de una construcción completa y un guardado
correctos; las lecturas fallidas o parciales siguen siendo reintentables.
El visor del grafo permite a Sigma representar por lotes las actualizaciones de
topología, visibilidad y posición sin forzar una segunda reindexación completa
por paso de distribución. Los cambios al pasar el cursor siguen invalidando
su estado visual. La proyección inicial y los filtros de visibilidad se aplican
antes de construir Sigma, de modo que su primer índice recibe la topología
preparada. La línea temporal utiliza su límite inicial efectivo antes de
confirmarlo en el estado, evitando una segunda simulación D3 inicial para los
mismos datos y filtros; los cambios posteriores siguen actualizando la distribución.
El minimapa agrupa los eventos del grafo, la cámara y el renderizador en un dibujo
por frame, dibuja los círculos de nodos por lotes, cambia de tamaño solo cuando
es necesario y cancela el trabajo en cola al sustituirse o desmontarse. Los ajustes
aplazados de cámara también se cancelan al cerrar o cambiar su vista del grafo.
Los recuentos de filtros de campos reutilizan el grafo de filtrado ya normalizado
y recorren sus nodos una vez para todos los campos configurados. Los metadatos
se normalizan una sola vez por nodo; el recuento conserva la clasificación de
tablas, la búsqueda de campos sin distinguir mayúsculas, los valores repetidos
y el orden estable cuando los recuentos coinciden.
La página obtiene el índice global de títulos solo si lo necesitan los filtros
de campos configurados. Estos filtros conservan la prioridad de títulos del índice
canónico. Las consultas de grafo, tablas, configuración e índice se limitan al
vault activo; las vistas de grafo incrustadas comparten la consulta del grafo
y la invalidación por prefijo.
Cada lote del grafo en el backend también resuelve una vez los nombres y alias
de campos de relación de una tabla, incluidas las tablas sin relaciones. Esta
caché pertenece solo al lote; la siguiente construcción lee el esquema actual
del registro, y los metadatos de página en caché nunca se modifican al convertir
wikilinks de relación en identificadores.
La API del grafo conserva un cuerpo JSON validado para la instantánea actual,
comprobando el objeto actual del servicio antes de reutilizarlo. Las reconstrucciones
e invalidaciones sustituyen ese objeto, nunca se retienen grafos parciales y una
validación fallida no puede publicar un cuerpo. La codificación se ejecuta en
el worker de la petición; las cabeceras de respuesta y tareas en segundo plano
siguen siendo independientes para cada petición.

Las lecturas de raíces, árbol, álbumes, vistas y páginas multimedia también se
ejecutan en workers para que la latencia de carpetas de la nube no bloquee otras
peticiones. Una página multimedia resuelve cada vault/raíz una vez dentro de la
petición; ese ámbito se descarta tanto si tiene éxito como si falla. Las lecturas
concurrentes del mismo árbol multimedia confinado comparten solo el trabajo
pendiente. Los listados de directorios padre e hijo comparten un límite global
de cuatro escaneos, conservando los filtros de carpetas y la ordenación estable.
No hay TTL para el árbol: las peticiones posteriores leen los directorios actuales
y las fallas no se retienen para una petición posterior.
Los índices multimedia persistidos conservan cadenas de ruta validadas y fechas
de modificación en una secuencia inmutable. La paginación predeterminada construye
objetos `Path` solo para la página seleccionada, no para cada archivo indexado.
La carga sigue validando el índice completo; los filtros y la ordenación
personalizada siguen inspeccionando cada entrada aplicable. El formato JSON y
el intervalo de frescura de 24 horas mantienen la compatibilidad. Cuando ese
intervalo expira, la API del navegador devuelve la instantánea almacenada mientras
un máximo de dos workers la actualizan; la cola conjunta de trabajo en curso
y pendiente se limita a ocho tareas. Las peticiones del mismo índice comparten
ese trabajo. Un primer índice sin datos almacenados utilizables sigue esperando
su escaneo inicial.

`GET /api/vault/media` informa de `X-Gnosi-Media-Index` (`fresh`, `refreshing`
o `failed`), un `X-Gnosi-Media-Index-Revision` opaco y `X-Gnosi-Media-Next-Offset`.
El cuerpo mantiene su contrato. Los archivos eliminados desde la instantánea se
omiten de los elementos, pero las posiciones y el total permanecen estables;
los consumidores avanzan con la cabecera del siguiente desplazamiento, incluidas
las ventanas vacías. Las actualizaciones fallidas conservan la instantánea
almacenada y devuelven una espera `Retry-After` de hasta 30 segundos. La galería
consulta una actualización cada cinco segundos, hasta 60 veces, y después ofrece
un reintento manual. Conserva las fotos cargadas y sustituye todo su prefijo
cargado solo tras comprobar revisiones coincidentes entre páginas. Los cambios
de raíz, álbum, filtros o vault y los desmontajes cancelan peticiones y temporizadores.

Los escaneos parciales no pueden sustituir un índice completo. La invalidación
retira la generación de publicación y la persistencia sustituye atómicamente
un archivo temporal codificado. Un índice leído por completo sigue siendo
utilizable en memoria si falla la escritura de su caché. Los consumidores Python
antiguos conservan lecturas bloqueantes y los resultados parciales disponibles,
pero no publican escaneos parciales. El formato JSON histórico no puede certificar
retrospectivamente que un índice antiguo estuviera completo; su estructura se
valida al cargarlo. Una caché que no puede escribirse no sobrevive a un reinicio
del proceso.

La configuración social resuelve solo su propia sección de integración,
conservando listas explícitamente vacías y valores predeterminados sin abrir
credenciales no relacionadas.

Las notificaciones de errores no controlados se ejecutan en un worker para que
su E/S de bases de datos, archivos y notificaciones nativas no bloquee otras
peticiones HTTP. El arranque diferido del planificador también se ejecuta en un
worker. La cancelación espera a que termine su arranque en curso antes de que
el cierre llame a stop, evitando que un planificador se inicie después de haberse
detenido. Estos límites conservan los ContextVars de la petición y la respuesta
500 segura existente.

La configuración de complementos carga los complementos instalados y los permisos
independientemente del mercado. El catálogo y los datos de confianza se cargan
al abrir su sección, y una lectura pendiente de confianza no oculta un catálogo
disponible. Las lecturas fallidas muestran una acción de reintento antes de permitir
editar la configuración. El backend reutiliza el estado decodificado de complementos
solo si coinciden las fechas de modificación y cambio, el tamaño y el inode del
archivo; guardarlo lo invalida, y cada documento devuelto es una copia independiente
limitada a su ruta de archivo.

La entrada del navegador inicia el enrutamiento del vault y la descarga de la
pantalla solicitada antes de cargar React DOM y la interfaz principal. Comparte
la lectura pendiente de enrutamiento con esa interfaz, que sigue esperando el
enrutamiento y el idioma antes de representarse. La entrada establece la cookie
del vault activo antes de cualquier petición inicial. La lectura de enrutamiento
comienza antes de las importaciones especulativas de pantallas y tiene una prioridad
alta de petición; la programación del navegador debe medirse en el host de destino.
Los límites de compilación acotan por separado el código necesario para iniciar
esas peticiones y conservan el arranque dinámico requerido en el presupuesto
completo. El catálogo de vaults lee el modo y el almacenamiento predeterminado
de una instantánea de configuración por petición; las posteriores siguen leyendo
la configuración actual.

Los selectores de planificación de proyectos solicitan todos los identificadores
y títulos de página al endpoint `references` de la tabla. Utiliza el mismo filtro
de plantilla y carga de títulos que la respuesta completa, pero no transfiere
metadatos sin utilizar. Las lecturas concurrentes comparten solo un vault, tabla
y filtro idénticos; las posteriores se revalidan inmediatamente. Un editor de
configuración abierto cancela sus lecturas de tablas y referencias al cambiar
de vault y no muestra resultados del anterior, aunque coincidan los identificadores
de tabla. En el conjunto local de 748 tareas y 45 proyectos, las dos respuestas
decodificadas sumaban 67,381 bytes en lugar de 1,130,202 bytes (94.04% menos),
con los mismos identificadores y títulos ordenados. Las peticiones de referencias
medidas tardaron 118 ms y 22 ms; esto no establece el tiempo hasta que se puede
utilizar el formulario completo de configuración.

El calendario monta la cuadrícula mientras se cargan las notas locales y las
preferencias, para que el intervalo visible real de FullCalendar pueda iniciar
concurrentemente las lecturas de eventos externos. La cuadrícula se oculta y
queda inerte solo en la primera lectura local sin datos utilizables. Las fuentes
locales completas residen en una consulta limitada al vault y se revalidan en
cada apertura (`staleTime: 0`). Volver a abrir muestra esa instantánea y los eventos
completos del mismo intervalo mientras un indicador de actividad identifica las
actualizaciones pendientes; el intervalo de frescura de eventos externos sigue
siendo de 30 segundos. Una actualización parcial no puede sobrescribir la última
instantánea local completa. Un primer resultado parcial aún puede mostrar notas
útiles, con un error explícito y reintento. Las listas, intervalos, consultas de
recordatorios e invalidaciones por mutación del calendario se limitan al vault;
los datos provisionales del intervalo anterior nunca atraviesan vaults. La
visibilidad guardada se aplica antes de seleccionar calendarios que llegan pronto.
Actualizar las notas conserva la instancia de la cuadrícula, el periodo seleccionado
y la vista. Las pruebas con respuesta aplazada ejercitan el remontaje real de
FullCalendar con un resultado envejecido del mismo intervalo; el contenido visible
en caché y los datos recién actualizados deben medirse por separado en el navegador
del host.

Configuración ya no importa el registro completo de componentes Lucide. El selector
de iconos de agentes carga nombres buscables al abrirse y representa solo los iconos
solicitados, incluidos los alias numerados guardados. La compilación comprueba las
importaciones estáticas transitivas de Configuración, no solo el tamaño de su
archivo de entrada, para evitar miles de pequeñas descargas de iconos. El guardado
automático establece su base solo después de que se carguen todos los documentos
editables; abrir o cerrar una sesión de configuración que carga lentamente no debe
activar escrituras. La misma respuesta de configuración proporciona los parámetros
saneados de proveedores de IA. La carga no obtiene una segunda vez todo el catálogo
de proveedores y modelos solo para conseguir esos campos; se conservan las
referencias de credenciales, indicadores de disponibilidad y extensiones de
proveedores. Los editores de configuración se cargan con la sección seleccionada
y los diálogos secundarios solo al abrirlos. La lista de complementos instalados
también aplaza cada editor integrado hasta que se abre su configuración. Los
indicadores de carga permanecen dentro del contenido seleccionado para que la
navegación de Configuración y el botón de cierre sigan disponibles.

La bandeja de correo carga su lector y redactor solo al abrir un mensaje o borrador.
Su panel de detalle vacío es independiente del editor de texto enriquecido y de
las herramientas de calendario; la bandeja y una acción de cierre permanecen
disponibles mientras se carga cualquiera de los módulos. Los formularios de
eventos, herramientas de disponibilidad y búsqueda global también se cargan al
abrirse, sin cambiar el guardado automático de borradores, la visibilidad de
eventos ni el manejo de recurrencias. Las vistas previas de títulos aplazan la
tarjeta de página y el renderizador Markdown hasta pasar el cursor sobre un título
o abrirlo desde el teclado. La entrada del puntero inicia la carga del módulo
durante el retardo existente; salir sigue cancelando la apertura y la navegación
permanece utilizable. Los límites de compilación cubren los grafos completos de
importaciones estáticas del correo y el calendario, incluido el código compartido
de arranque, para que una entrada de ruta pequeña no oculte un editor cargado
anticipadamente.

Las suscripciones push del correo esperan de forma asíncrona; las pestañas inactivas
ya no ocupan el conjunto compartido de workers entre eventos. Las notificaciones
originadas en hilos conservan los filtros de cuenta, la ordenación limitada y
la limpieza al cancelar o desconectar. Las consultas de vistas y etiquetas locales
del correo utilizan la ejecución síncrona en workers de FastAPI, conservando el
contexto del vault activo y dejando disponible el bucle de peticiones. Las
importaciones iniciales del proveedor híbrido también se ejecutan en workers
y se omiten en lecturas de mensajes almacenados en caché.

Las actualizaciones de integraciones conservan las referencias al almacén seguro
y resuelven solo las credenciales cambiadas. Las lecturas de configuración que
solo obtienen referencias no esperan detrás de un lector que desbloquea credenciales.
La sincronización IMAP resuelve la cuenta seleccionada desde cualquiera de las
dos secciones admitidas, en lugar de desbloquear todas las cuentas de correo.
El enrutamiento al proveedor de calendario lee metadatos de cuentas sin desbloquear
credenciales. Los clientes Google y CalDAV resuelven solo las identidades
coincidentes de calendario/correo; Google también filtra por proveedor y autenticación
OAuth antes de acceder al almacén seguro. La prioridad de calendario sobre correo
y las lecturas frescas de credenciales no cambian. Las lecturas concurrentes de
credenciales de Google Calendar comparten solo el trabajo aún pendiente para el
mismo correo, documento de configuración e instantánea de revisión/referencias.
Las lecturas completas o fallidas se eliminan inmediatamente; las llamadas
posteriores vuelven a resolver credenciales. Cada consumidor recibe datos de
credenciales independientes y construye su propio cliente. Las rutas de estado
de recordatorios de reuniones utilizan directamente `resolve_data_dir()`, sin
cargar parámetros del vault ni crear directorios durante la resolución de rutas.
El escritor atómico prepara el directorio padre local cuando debe guardarse el estado.

La configuración reutiliza YAML decodificado de archivos sin cambios, comprobando
el dispositivo, inode, tamaño, fechas de modificación/cambio y permisos en cada
lectura. Los lectores concurrentes comparten una lectura inicial del mismo archivo;
los vaults no relacionados mantienen lecturas independientes y todos los consumidores
reciben documentos independientes. Las lecturas fallidas o inestables no se
reutilizan. La caché conserva como máximo 16 documentos de hasta 1 MiB cada uno.
El entorno y la selección del vault activo se mantienen actualizados. El
descubrimiento de rutas reutiliza solo la ubicación del checkout del módulo y
comprueba los directorios existentes antes de intentar crearlos; los directorios
eliminados y los selectores de datos/vault cambiados mantienen el comportamiento
normal de reparación.

La disponibilidad de credenciales resuelve los alias de entorno de proveedores
a partir de la instantánea actual del catálogo, metadatos locales descargados
o metadatos incluidos en el paquete. No actualiza models.dev, no consulta Ollama
ni espera una actualización en curso del catálogo de modelos. Las lecturas
explícitas del catálogo siguen actualizándose normalmente. Los índices locales
de alias son limitados y se releen después de sustituir o modificar archivos;
la resolución de secretos y los indicadores saneados `has_api_key` conservan su
prioridad. Las comprobaciones concurrentes de credenciales comparten la
decodificación inicial de cada archivo de catálogo sin cambios. Los archivos
diferentes y las sustituciones avanzan independientemente; las lecturas fallidas
se liberan y reintentan en la consulta siguiente sin retener una entrada fallida
en caché.

La navegación de Configuración y los editores de complementos integrados utilizan
transiciones de React para mantener disponibles los controles actuales mientras
se carga otro editor. Las lecturas concurrentes de tablas y páginas de tabla
comparten una petición por vault, tabla y filtro, incluidos los remontajes de
desarrollo; las lecturas posteriores siempre se revalidan, y cerrar un consumidor
no puede abortar otro.

Las lecturas de páginas de tabla preparan nombres actuales de campos, identificadores
inmutables y alias una vez por lote. Las filas cuyas claves no necesitan cambiar
de nombre se copian sin contabilizar colisiones. Se conservan la prioridad de
nombre/identificador/alias, el orden original de claves, los metadatos locales
opacos y la validación HTTP de metadatos. Los mapas preparados permanecen dentro
de una lectura de tabla; las consultas posteriores los reconstruyen para que
los cambios de nombre y esquemas de distintos vaults sean independientes.

El grafo solicita solo su propio documento de configuración en `/api/config/graph`.
La lectura hereda el control de permisos de configuración y el contexto del vault,
pero nunca inspecciona credenciales de proveedores de IA ni de contraseña del
sistema. El documento completo de Configuración conserva el comportamiento
saneado del estado de credenciales. Las actualizaciones de preferencias del grafo
siguen leyendo la configuración actual después de los cambios.
Tras la proyección, la construcción del grafo limpia el almacenamiento temporal
de adyacencia y atributos de NetworkX, incluso con resultados parciales o fallos.
De lo contrario, sus vistas en caché pueden retener ese almacenamiento hasta una
recogida cíclica global del proceso; la respuesta proyectada y la caché de nodos
analizados conservan sus datos independientemente. Los grafos de vault incrustados
utilizan sus opciones explícitas de vista y no obtienen un documento global de
configuración sin utilizar al montarse, cambiar la configuración o reintentar
resultados parciales.

La entrada de Configuración, la navegación entre secciones y los botones de
configuración de complementos integrados preparan el módulo del editor seleccionado
cuando existe intención mediante el puntero, foco del teclado o toque. Los mismos
cargadores de importaciones sirven a React.lazy; la preparación nunca monta una
sección, lee documentos editables ni guarda configuración. Las descargas
especulativas fallidas se ignoran para que abrir la sección siga controlando la
carga y los errores habituales. Mida el tiempo desde el clic hasta los controles
poblados y habilitados por separado de la preparación del módulo y del primer
frame del modal; adelantar una descarga antes del clic no demuestra que la carga
de datos cumpla el objetivo de latencia de navegación.

Antes de aceptar peticiones, el arranque visita en un worker los contextos de
validación de rutas incluidas de FastAPI sin generar el esquema público opcional
de la API ni ejecutar dependencias de los endpoints. Esto evita construir rutas
de forma diferida en la primera petición del navegador, dejando la generación
y caché del esquema en su vía habitual bajo demanda. El arranque de integraciones
sigue aplazado hasta que termine la preparación de rutas; la autenticación y
la validación de parámetros siguen ejecutándose en cada petición aplicable.

Las revisiones de esquema de vault `vault_0005`–`vault_0006` añaden índices del
Lector para fecha de publicación, estado de lectura y fuente. Esto evita escanear
cuerpos de artículos y ordenar toda la tabla antes de aplicar el límite del
listado. El ejecutor habitual de migraciones respalda la base de datos y verifica
el esquema, integridad y recuentos de filas; se conservan el contenido de los
artículos y los campos de respuesta del listado. Un índice de cobertura de
inventario evita que la agregación de fuentes y recuentos abra cuerpos de artículos.
Las pruebas del plan de consultas cubren las cuatro variantes del listado y la
agregación de inventario. La interfaz del Lector solicita `include_content=false`
para su lista de artículos, conservando metadatos, filtros y orden mientras
excluye los cuerpos almacenados de la consulta SQL y de la carga HTTP. Abrir un
artículo obtiene su cuerpo completo por separado; una selección nueva cancela
la petición anterior y los fallos ofrecen reintento. La API predeterminada del
listado y los enlaces directos a artículos mantienen el contrato de contenido completo.

Planificación trata un archivo de estado/historial existente pero ilegible, o
un documento de estado corrupto, como no disponible, nunca como un plan nuevo
vacío. Las líneas individuales malformadas del historial siguen el comportamiento
existente de omisión. Los errores temporales del proveedor devuelven 503 con
`planning_storage_pending` y `Retry-After`; las consultas de lectura reintentan
dentro de una ventana limitada, mientras que las mutaciones nunca se repiten
automáticamente. Las claves de consulta de Planificación incluyen el vault activo,
y los datos provisionales del proyecto anterior solo se reutilizan dentro de
ese vault. El proyecto seleccionado se resuelve a partir de referencias compactas
de páginas antes de cargar su programación y líneas base.

Las respuestas de imagen distinguen las descargas del proveedor aún pendientes
de los fallos confirmados mediante `X-Gnosi-File-Availability`. La miniatura
reintenta solo después de un error real de imagen, respeta la espera de reintento,
cancela al desmontarse y reutiliza los bytes de la respuesta correcta. Las descargas
fallidas muestran un reintento manual tras una espera corta. Una petición de
preparación o un bloque de archivo asignado no demuestra disponibilidad: el
proveedor comprueba la legibilidad en un worker. Completar la descarga de la nube
sigue dependiendo del proveedor de archivos y debe verificarse con archivos reales.

Un timeout del catálogo de complementos mantiene cerrados los controles de acceso
a funciones y muestra una acción explícita de reintento en la interfaz principal
y en el control de la ruta de complementos. Una lectura fallida del catálogo no
demuestra que se hayan desactivado los complementos; no sustituya su estado no
disponible por un catálogo vacío correcto. Las lecturas y respuestas pendientes
de activación/configuración se limitan al vault activo; un éxito o una reversión
tardíos de un vault anterior no pueden sustituir el estado actual.

Las reconstrucciones del grafo se agrupan por vault; los aciertos de caché evitan
reconstruir el registro. Tras 30 segundos, el servicio revalida rutas y fechas de
modificación indexadas, datos del registro, columnas de contactos, propuestas
pendientes, configuración y sidecars gestionados. Una instantánea completa sin
cambios conserva su objeto de grafo y cuerpos codificados. Las lecturas pequeñas
y correctas de sidecars reutilizan una LRU de como máximo 512 documentos de 64 KiB
cada uno, tras comprobar dispositivo, inode, modo, fechas, tamaño y asignación.
Nunca se retienen lecturas fallidas o inestables; los documentos devueltos son
copias independientes. Una instantánea cambiada se reconstruye a partir de las
entradas capturadas y se comprueba otra vez antes de publicarla. Las entradas no
fiables no pueden renovar una respuesta correcta. Las lecturas de sidecars son
estrictas y se limitan al vault de la petición; los cambios semánticos también
actualizan los nodos analizados de ese vault. Sin índice canónico, la reconstrucción
periódica habitual sigue siendo la alternativa.
La compresión JSON del grafo se ejecuta en un worker y reutiliza bytes de la misma
instantánea inmutable, conservando la invalidación y el manejo de resultados
parciales. Los recuentos de carpetas de correo utilizan una conexión separada y
de vida corta para que su escaneo no serialice el listado de mensajes en la misma
conexión. El listado de cabeceras obtiene solo los campos que consume; las
credenciales se resuelven de manera fresca al utilizar el proveedor. Configuración
carga tablas y bases de datos concurrentemente y conserva cualquier resultado
correcto si el otro falla. El arranque solapa la lectura de salud con la preparación
de ruta, compartiendo su petición pendiente con el control de autenticación y
la barra lateral.

Las lecturas de mensajes conservan su campo de error explícito cuando el proveedor
no puede conectarse, seleccionar o buscar en la carpeta, u obtener cabeceras.
Esas respuestas nunca sustituyen una caché válida de listado ni renuevan su
frescura. Los recuentos devuelven 503 reintentable si fallan o superan el límite
global de lectura de 30 segundos; una lectura compartida puede terminar en segundo
plano para otro consumidor. Los GET de listado y recuento de Microsoft también
utilizan un timeout de red de 20 segundos, de modo que el worker subyacente está
limitado. La interfaz publica los recuentos correctos de las cuentas a medida
que llegan e identifica las cuentas pendientes o no disponibles y los recuentos
anteriores conservados. Un listado visible o una respuesta de mensajes HTTP200
por sí solos no demuestran una lectura fresca correcta de todas las cuentas.
Invalidar recuentos también retira las identidades de lecturas en curso, evitando
que un worker antiguo publique o renueve un recuento anterior a la mutación.
La paginación publica cada página de cuenta independientemente. Las páginas
fallidas conservan su cursor y mensajes visibles, y la acción de reintento pide
solo esas páginas.

Mida tanto las primeras lecturas como las repetidas, y distinga las respuestas
API completas del contenido representado utilizable. Un listado en caliente
por debajo de 500 ms no establece un presupuesto de navegación de 500 ms: los
escaneos iniciales de la nube, catálogos externos, miniaturas y representación
del navegador aún requieren medidas separadas.

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
