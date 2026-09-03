---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/server.py
  - backend/app/lifespan.py
  - backend/config/app_config.py
  - backend/config/env_config.py
  - backend/config/paths_config.py
  - backend/domains/configuration/api/settings.py
  - backend/domains/configuration/plugin_state.py
  - backend/mcp/http_client.py
  - backend/services/data_dir_migration.py
  - backend/utils/cache.py
  - backend/api/system_routes.py
  - frontend/src/app
  - frontend/src/shared
  - frontend/src/generated
  - frontend/feature-public-entries.json
tests:
  - frontend/src/app/composition.contract.test.ts
  - frontend/src/app/shellPages.test.tsx
  - backend/tests/test_app_lifespan.py
  - backend/tests/test_app_config_resolution.py
  - backend/tests/test_app_config_language.py
  - backend/tests/test_config_language_locale.py
  - backend/tests/test_host_helper_url.py
  - backend/tests/test_data_dir_migration.py
  - backend/tests/test_system_filesystem_routes.py
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Base de la plataforma y entorno de ejecución

## Responsabilidad

La base de la plataforma integra todos los dominios en un proceso, resuelve la configuración y las rutas portátiles, gestiona el arranque y el apagado, aplica middleware compartido y expone el shell principal del frontend. Debe seguir siendo utilizable aunque no estén presentes las integraciones opcionales.

El directorio `app` del frontend gestiona el arranque, los proveedores, la
composición de rutas y la pantalla de inicio de carga inmediata. Las pantallas
opcionales de cada dominio se importan a través de módulos públicos de features
con cargas diferidas independientes. Los contratos de composición conservan las
32 rutas, los wrappers de permisos, el orden de proveedores y los veinte imports
diferidos.

## Composición del backend

`backend/server.py` construye la instancia FastAPI, el middleware, los manejadores de excepciones, el montaje estático del lector, el ciclo de vida y los routers. El orden de los routers es explícito porque el contexto del workspace y los prefijos amplios pueden solaparse. El [catálogo API](../generated/api-catalog.md) generado registra cada montaje y ruta estáticos.
El registro de composición importa directamente cada router canónico de dominio;
las fachadas API heredadas se mantienen solo para imports de compatibilidad.
Las anotaciones de las rutas deben conservar la representación OpenAPI congelada,
por lo que los handlers sin un modelo de respuesta explícito mantienen su contrato
de respuesta inferido.

El arranque del ciclo de vida realiza estas clases de trabajo:

El módulo de ciclo de vida mantiene el gestor de contexto público `lifespan`
como orquestador lineal. Funciones acotadas gestionan la reconciliación de plugins,
el arranque del agente, la precarga de índices, la reparación de tablas, los workers
de correo y el apagado con límites, conservando el orden documentado y el aislamiento
de fallos.

La reconciliación temprana de plugins es independiente del transporte: puede leer
el estado normalizado de cada vault, persistido atómicamente, antes de importar
módulos de rutas HTTP. Así, la construcción del agente no depende del orden de
inicialización de la fachada del vault, y el arranque normal converge en el mismo
almacén de estado compartido por el proceso.

1. Comprobar que un despliegue expuesto no utiliza un secreto JWT público de desarrollo.
2. Iniciar el planificador y el mantenimiento de la retención de confirmaciones.
3. Reconciliar las contribuciones de plugins antes de construir las capacidades del agente.
4. Conectar los clientes MCP, descubrir herramientas y compilar el grafo del agente predeterminado.
5. Precargar de forma síncrona los índices persistidos del vault imprescindibles
   para las peticiones. Iniciar la carga de la caché global de nombres de archivo
   de CloudStorage y su recorrido en un único worker gestionado en segundo plano,
   con estado `preparing`, `ready` o `error`.
6. Cargar las cachés derivadas antes de que cualquier guardado pueda truncarlas.
7. Iniciar los workers IMAP IDLE de cada cuenta.

Los fallos de arranque de la IA o de integraciones opcionales se registran y se aíslan. Los fallos de seguridad o de inicialización de datos esenciales no se ocultan presentando el sistema como operativo.

Las cachés compartidas dentro del proceso utilizan una única implementación
TTL/LRU acotada y protegida mediante bloqueo, y aceptan factorías de valores
explícitamente tipadas y sin argumentos. El transporte HTTP de MCP con streaming
restringe cada payload SSE decodificado a un objeto JSON antes de devolverlo al
cliente JSON-RPC; los eventos malformados o que no sean objetos nunca entran en
el entorno de ejecución tipado.

## Combinación de configuración

`load_params()` combina el YAML versionado de la aplicación con la configuración del usuario actual o del vault activo. Los diccionarios se fusionan recursivamente. El archivo `.gnosi/params.yaml` del vault activo pasa a ser el destino de persistencia de los ajustes de ese vault. Después, la resolución de rutas aplica los valores explícitos del entorno de despliegue.

La configuración de IA que requiere credenciales almacena referencias. Una credencial de entorno heredada puede crear un proveedor una vez, pero una marca persistida de desconexión impide que reaparezca tras eliminarlo deliberadamente.

La frontera de escritura de Configuración valida agentes gestionados y
estrategias de modelo, guarda contraseñas y claves fuera del YAML, trata el mapa
de proveedores como estado deseado para conservar eliminaciones, escribe de
forma atómica e invalida agentes compilados solo tras un cambio de IA.

La migración de datos locales es una máquina de estados con diario. La
verificación del origen, el movimiento atómico en el mismo volumen, el staging
entre volúmenes, la verificación del destino y el rollback automático son fases
separadas. Cada base SQLite pasa un checkpoint y una comprobación de integridad, y las copias
se comparan con un inventario con hash antes de sustituir una estructura vacía.

Las rutas del sistema separan la orquestación HTTP de los helpers acotados de
navegación y búsqueda. La búsqueda prioriza el vault activo y las carpetas
habituales, incluida la raíz neutral `Library/CloudStorage` que usan OneDrive,
Google Drive, Dropbox, Box y otros proveedores de archivos de macOS. Las rutas
locales y Docker se mapean sin incorporar ningún proveedor al modelo de datos.

## Shell del frontend

`app/App.tsx` espera a que termine el arranque de autenticación antes de seleccionar la página pública compartida, el inicio de sesión o el shell de la aplicación. Las páginas pesadas se cargan de forma diferida. El shell global gestiona la navegación y las interacciones disponibles en toda la aplicación; las páginas de las rutas gestionan el contenido del dominio. Por diseño, `/s/:token` se renderiza fuera del shell autenticado.

## Invariantes

- El puerto `5002` es el contrato del backend; el `5173`, el del frontend.
- El código de la aplicación utiliza el árbol autoritativo `Gnosi/`.
- Las cadenas visibles del frontend utilizan todos los catálogos de idioma.
- La generación de documentación no debe importar módulos del entorno de ejecución.
- Las órdenes operativas puntuales residen en `scripts/`; los paquetes de producción
  no contienen sincronizadores provisionales, sondas que modifiquen datos ni scripts
  de reparación con rutas de máquina fijas.
- Un vault no disponible se representa explícitamente; una ruta temporal segura puede
  evitar fallos durante la importación, pero no debe presentarse como contenido configurado.
- La precarga de cachés derivadas no puede retrasar la primera respuesta útil cuando
  existe una instantánea segura en disco.

## Diagnóstico de fallo

Compruebe qué proceso está atendiendo el servicio, `/api/health`, `/api/config` y `/api/vault/pages`, en ese orden. Una respuesta de salud correcta junto con una petición al vault vacía o fallida indica problemas de configuración o del proveedor de archivos, no un servidor detenido. Consulte el [manual de operaciones](../operations/runbook.md).
