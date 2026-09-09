---
status: partial
last_verified: 2026-09-09
source_paths:
  - backend/app/errors.py
  - backend/app/lifespan.py
  - frontend/src/shared/api/useCalendarData.ts
  - frontend/src/features/calendar/page/useCalendarLocalSources.ts
  - frontend/src/features/calendar/page/CalendarPageWorkspace.tsx
  - backend/services/auth_service.py
  - backend/services/auth_public_surface.py
  - backend/config/directory_preparation.py
  - backend/services/active_vault_middleware.py
  - backend/domains/graph/cache_inputs.py
  - backend/domains/calendar/google.py
  - backend/domains/calendar/timing.py
  - backend/utils/request_profile.py
  - backend/services/meeting_reminders.py
  - backend/domains/media/roots.py
  - backend/domains/media/scan_cache.py
  - backend/domains/media/index_refresh.py
  - backend/domains/media/query.py
  - backend/domains/vault/media/routes.py
  - frontend/src/shared/api/media-browser.ts
  - frontend/src/features/media/browser/useMediaCollection.ts
  - frontend/src/features/media/browser/MediaGallery.tsx
  - frontend/scripts/native-preview.ts
  - frontend/vite.config.js
  - scripts/runtime/run_native_frontend.sh
  - frontend/src/shared/graph/viewer/useGraphViewerRenderer.ts
  - frontend/src/features/graph/page/useGraphPageController.ts
  - backend/app/factory.py
  - backend/domains/graph/nodes.py
  - backend/domains/graph/projection.py
  - backend/domains/vault/files/serving.py
  - frontend/src/shared/graph/viewer/graphViewerPhysics.ts
  - frontend/src/features/media/browser/useThumbnailVisibility.ts
  - backend/api/planning_routes.py
  - backend/api/vault_graph_routes.py
  - backend/domains/mail/routes/messages.py
  - backend/platform/files/on_demand.py
  - frontend/src/app/startup.ts
  - frontend/src/app/App.tsx
  - frontend/src/shared/plugins/usePlugins.ts
  - frontend/src/features/settings/global-settings/GlobalSettingsView.tsx
  - docs/engineering/operations/navigation-latency-observations-2026-09-08.json
tests:
  - backend/tests/test_app_async_boundaries.py
  - frontend/src/shared/api/useCalendarData.test.tsx
  - frontend/src/features/calendar/page/useCalendarSources.cache.test.tsx
  - frontend/src/features/calendar/page/CalendarPageWorkspace.test.tsx
  - backend/tests/test_auth_policy_singleflight.py
  - backend/tests/test_health_vault_independence.py
  - backend/tests/test_active_vault_async_singleflight.py
  - backend/tests/test_vault_identity_directory_reads.py
  - backend/tests/test_directory_preparation_cache.py
  - backend/tests/test_graph_input_revalidation.py
  - backend/tests/test_calendar_pending_credentials.py
  - backend/domains/calendar/tests/test_timing.py
  - backend/tests/test_request_profile.py
  - backend/tests/test_graph_request_timing.py
  - backend/tests/test_graph_response_compression.py
  - backend/tests/test_meeting_reminder_local_reads.py
  - backend/tests/test_media_tree_reads.py
  - backend/tests/test_media_persisted_entry_reads.py
  - backend/tests/test_media_index_refresh.py
  - backend/tests/test_component_read_responsiveness.py
  - frontend/src/shared/api/media-browser.test.ts
  - frontend/src/features/media/browser/useMediaCollection.test.tsx
  - frontend/src/features/media/browser/MediaCenter.test.tsx
  - frontend/tests/native-preview.test.ts
  - frontend/tests/vite-config.test.ts
  - frontend/src/app/startup.test.ts
  - frontend/src/app/App.pluginRecovery.test.tsx
  - frontend/src/app/App.loginPluginRecovery.test.tsx
  - frontend/tests/preview-asset-cache.test.ts
  - pipeline/tests/test_native_runtime_wrappers.py
  - frontend/src/features/graph/page/useGraphPageController.timeline.test.tsx
  - backend/tests/test_route_preparation.py
  - backend/tests/test_graph_request_timing.py
  - backend/tests/test_image_metadata_scheduling.py
  - frontend/src/shared/graph/viewer/graphViewerPhysics.test.ts
  - frontend/src/features/media/browser/Thumb.visibility.test.tsx
  - backend/tests/test_planning_storage_recovery.py
  - backend/tests/test_graph_response_compression.py
  - backend/tests/test_image_download_recovery.py
  - frontend/src/features/settings/global-settings/settingsController.test.tsx
  - frontend/src/features/media/browser/Thumb.recovery.test.tsx
---

# Revisión de carga del 8 de septiembre de 2026

El objetivo de cargar todas las pantallas con datos en 0,5 s **todavía no se ha alcanzado**.
Se ha reanudado la comprobación con el Mac desbloqueado, el backend nativo y el navegador
integrado. HTTPS funciona con verificación del certificado local; HTTP devuelve 307
hacia HTTPS en el mismo puerto 5173.

## Fase del 9 de septiembre: cola inicial reducida, carga completa todavía lenta

El objetivo actual sigue siendo mostrar los datos necesarios de cada pantalla
en 0,5 s, incluida la primera apertura. **El estado sigue siendo parcial: no se ha
demostrado una mejora global suficiente.** Las correcciones están activas,
validadas y la limpieza de la auditoría está terminada. Las últimas aperturas
directas han costado 22,128 s en el grafo y 16,081 s en el calendario; en caliente,
7,447 s en el grafo y 5,392 s hasta los datos actualizados del calendario. Los 398 ms
hasta ver datos ya cargados del calendario no equivalen a datos actualizados.
La lectura inicial de 63,577 s y las series del 8 de septiembre se conservan
como histórico, sin atribuir causalidad a comparaciones no controladas.

La medición anterior con la caché del navegador vacía tenía 121 recursos compilados;
115 habían comenzado antes del envío de las API iniciales. Salud y espacios
comenzaban a los 1.709 ms, pero `requestStart` llegaba a los 6.553 ms: 4.843 ms de
cola, con DNS, conexión y TLS a cero. Esto acredita espera anterior al servicio,
pero no demuestra por sí solo un límite concreto de streams HTTP/2.

Ahora están activos dos cambios: se concede un turno al navegador para que las peticiones
iniciales se envíen antes de cargar las rutas y el shell, sin esperar sus
respuestas; y se agrupan explícitamente 51 iconos pequeños del shell. Se conserva
la caché inmutable de los recursos compilados. La comparación de los manifiestos
muestra:

| Grafo estático compilado | Antes | Después |
| --- | ---: | ---: |
| Entrada y bootstrap: chunks | 84 | 36 |
| Entrada y bootstrap: bytes | 538.828 | 529.350 |
| Con Calendario: chunks | 112 | 64 |
| Con Calendario: bytes | 963.474 | 952.874 |
| Ciclos de importación en todo el manifiesto | 0 | 0 |
| Entradas dinámicas individuales de iconos | 1.546 | 1.546 |

El catálogo dinámico y los editores pesados no se han adelantado al arranque.
Activity y Heart, que ya se importaban estáticamente, ahora ocupan dos chunks de
329 y 353 B fuera del grupo: esto explica los 36 chunks en lugar de los 34 esperados.
Han pasado 67 pruebas, las comprobaciones de tipos y ESLint, y la compilación
completa de 55,83 s de esta activación.

La prueba en frío en el puerto 5187 registra colas de 13/12 ms y solo nueve recursos
anteriores al envío inicial, pero la API de espacios devuelve 401: **queda excluida
de las mediciones funcionales del calendario**. La primera activación en `localhost`
también devuelve 401 y muestra recuperación de configuración, con colas de 3/3 ms;
tampoco es una carga funcional completada. La lectura con acceso a datos en
`127.0.0.1:5173` tiene colas iniciales de 57/56 ms, 73 recursos compilados de los que
29 se reutilizan, pero el servidor necesita 47,181 s para los calendarios y
51,897 s para los eventos. La mejora del envío y de la fragmentación es
verificable; esta serie no permite afirmar que toda la pantalla sea más
rápida. La activación del frontend había costado 66,1 s, una duración separada de
la navegación. Se ha retirado la instancia temporal 5187.
No se ha verificado el método de autenticación de este acceso a datos.

Un perfil nativo **posterior** de 15 s aporta 1.346 muestras por hilo, contadas
de manera exclusiva, sin sumar padres e hijos. El hilo principal pasa un
55,35% de las muestras esperando eventos y un 35,59% en contención del GIL;
un trabajador combina runtime Python y lectura de archivos. Dos hilos esperan
lecturas SSL durante toda la ventana, pero no están identificadas las peticiones
correspondientes. Las 21 lecturas de salud devuelven 200, con mediana de 175 ms y
rango de 10–779 ms; el proceso ocupa 406,1 MB, con pico de 472,1 MB según el
perfil. **Este perfil no explica causalmente los 51,897 s anteriores:** no
se atribuyen al GIL, al sistema operativo ni a estos sockets sin más pruebas.

La recuperación de una cookie de sesión inválida ya está activada. Han pasado las
18 pruebas aisladas, tipos y ESLint; la compilación Vite ha costado 1 min 9 s,
conserva cero ciclos de importación, y la activación ha tardado 52,0 s. Este caso
adicional no se ha ejercitado con una sesión real inválida en el navegador: no se
presenta como la solución del bloqueo actual ni como una mejora de latencia
medida.

La clasificación temporal de las respuestas 401 en `localhost` confirma
`authentication_required` en `/api/vaults` y `/api/vault/plugins`, mientras
`/api/auth/me` informa `anonymous`. **No se ha identificado una sesión caducada.**
No se ha hecho logout ni se han leído credenciales. El caso actual es acceso anónimo
a datos que exigen autenticación. La corrección `authenticationRequired` de
`usePlugins` y App ya está codificada para mostrar Login cuando el catálogo de
complementos exija autenticación, aunque la instantánea de salud indique
lo contrario. Han pasado las 17 pruebas iniciales, la comprobación focalizada de
tipos, ESLint de los cuatro archivos revisados y la compilación de 67 s con los
límites de tamaño correctos. Esta compilación tiene 531.032 B estáticos de arranque
y 954.556 B con Calendario, conserva 36/64 chunks, cero ciclos y 1.546 entradas
dinámicas de iconos. Una prueba de integración adicional de App confirma que iniciar
sesión en el mismo espacio recarga los complementos y abandona Login. Esta
prueba y su ESLint han pasado. El frontend se ha activado en 74,2 s
con TLS verificado. En `https://localhost:5173/@vault/calendar`, el navegador
muestra Login y ya no muestra el error de configuración; no hay ningún calendario
cargado ni instrumentación temporal presente. Esto confirma la recuperación de
la pantalla de acceso, no una carga funcional del calendario. No se ha hecho ningún
inicio o cierre de sesión real ni se han leído credenciales.
Antes de la instrumentación de tiempos descrita a continuación, el recuento del
turno era de **96 pruebas únicas superadas**; las baterías parciales se solapan
y no deben sumarse como si fueran casos diferentes. La batería de calendario
posterior se registra por separado, sin inferir un nuevo total único.

Se ha instalado py-spy 0.4.2 para obtener nombres de funciones Python. La captura
requiere privilegios: `sudo -n` confirma que hace falta contraseña. El diálogo de
macOS para una captura de 15 s, sin variables locales, ha expirado a los 120 s
sin autorización. **No se ha realizado ni guardado ninguna captura** (`saved=false`), ni
se han leído contraseñas. No queda ningún resultado de esta captura pendiente
de analizar ni se extrae ninguna conclusión causal.

El diagnóstico continúa sin depender de esta autorización administrativa:
la instrumentación optativa de `Server-Timing` está implementada en las rutas
de calendarios y eventos y se activa con `X-Gnosi-Calendar-Timing: 1`.
Solo expone duraciones, para distinguir espera en cola, resolución de credenciales
y HTTP; no valores de credenciales ni contenido del calendario. Propaga solo
el contexto `CalendarTiming`, sin alterar el contexto de espacio o autenticación
ni los resultados de las consultas. Los tiempos son inclusivos y pueden ser
concurrentes: **no deben sumarse** para reconstruir el total. `cal_total`
excluye el middleware y la validación de la respuesta, por lo que tampoco
equivale a toda la duración HTTP.

Han pasado 35 pruebas de calendario: 9 nuevas y 26 existentes. Las 9 nuevas
han vuelto a pasar después de limitar la propagación del contexto; esta
repetición no añade casos únicos. También han pasado Ruff de 7 archivos, mypy de
6 archivos de código y la comprobación de espacios del diff seleccionado. El backend
se ha activado en 178,8 s; este arranque se registra separado de la carga
de la interfaz. La lectura posterior del calendario en la dirección de loopback,
con acceso a datos y la copia temporal del frontend instrumentada, ha terminado
con todas las respuestas HTTP 200, un calendario, dos eventos y ningún error.
Los datos visibles y actualizados han llegado a los **10.557 ms**; la petición
de eventos ha terminado a los 10.445 ms. Salud y espacios han costado 976 y
1.178 ms, con 4 ms de cola. Se han cargado 73 recursos compilados, 25 desde
caché, con 322.304 B transferidos.

| Petición | Duración HTTP | Espera del servidor | Cola del navegador |
| --- | ---: | ---: | ---: |
| Calendarios | 6.037 ms | 5.991 ms | 44 ms |
| Eventos | 7.244 ms | 7.193 ms | 45 ms |

| Fase `Server-Timing` | Calendarios (ms) | Eventos (ms) |
| --- | ---: | ---: |
| `cal_total` | 5.303,319 | 6.492,143 |
| Cola del worker | 9,221 | 46,336 |
| Integraciones | 2,905 | 142,198 |
| Lectura de calendarios/eventos | 2.215,899 | 6.327,889 |
| Filtrado de calendarios ocultos en la base de datos | — | 5,467 |
| Credenciales | 824,473 | 692,416 |
| Servicio (`cal_service`, fase inclusiva) | 1.406,349 | 1.210,476 |
| HTTP del proveedor | 744,555 | 1.048,494 |

Estas fases inclusivas y concurrentes no son una partición del total. La
medición muestra tramos locales que todavía no quedan explicados; tampoco permite
atribuir la diferencia entre la espera del servidor y `cal_total`. No se ha
reproducido la espera anterior de 47–52 s y no se demuestra una mejora integral
atribuible a esta instrumentación, que es diagnóstica. La causa de los picos
sigue abierta.

El muestreo Python dentro del proceso está implementado en
`backend/utils/request_profile.py`, con puntos de entrada en el calendario y en el grafo.
En el grafo se activa con `X-Gnosi-Graph-Profile: 1`; en los eventos del calendario,
con `X-Gnosi-Calendar-Profile: 1` y también `X-Gnosi-Calendar-Timing: 1`.
Hay un único muestreador simultáneo, limitado a 15 s a 20 Hz, que observa el
hilo principal y los workers registrados explícitamente. Solo agrega rutas de
código normalizadas, nombres de función y números de línea: no lee variables
locales o globales, argumentos, nombres de hilos ni contenido del usuario. No incluye
trazado del correo y no requiere permisos administrativos.

El archivo `/tmp/gnosi-request-profile-<id>.json`, con permisos `0600`, contiene
como máximo 256 pilas de hasta 32 frames, más el PID y el inicio monotónico.
Se guarda automáticamente al terminar los 15 s aunque la petición siga
pendiente; la espera de parada está limitada a 250 ms. Si el archivo ya está
disponible cuando termina la ruta, la respuesta indica su identificador en
`X-Gnosi-Request-Profile-Id`.

La nueva batería ha pasado **35 pruebas**: 6 del muestreador, 9 de tiempos de
calendario, 6 de peticiones del grafo y 14 de compresión. También han pasado Ruff
de 6 archivos y mypy de 4. Esta batería se solapa con las anteriores y no
se añade entera al recuento de pruebas únicas. La última activación del backend
ha terminado en 199,3 s, separados del tiempo de carga de la interfaz, y la
copia temporal del frontend de auditoría está preparada. El instrumento también se ha
corregido para incluir las peticiones anticipadas que comienzan antes del
clic y terminan después.

En la verificación real de los complementos se han visto 39 controles, todos
habilitados: controles a los 185 ms y datos a los 710 ms. El catálogo ha tardado
489 ms y los complementos instalados 504 ms, con HTTP 200. En el grafo todavía
estaba el indicador de carga a los 29.395 ms; una lectura posterior del DOM
muestra 9 elementos `canvas`, ningún indicador de carga ni error. No se
capturó el instante final: esta comprobación confirma el resultado visual,
pero **no permite dar un tiempo exacto de carga del grafo**.

En una nueva lectura con el muestreador ya activado, el primer resultado visible
del grafo ha llegado a los **19.949 ms**, con 9 elementos `canvas`, sin errores
ni indicador de carga. `/api/graph` ha tardado 16.513 ms, con 16.363 ms
de espera del servidor y 109 ms de cola en el navegador. Es una medición diferente
de la comprobación anterior sin instante final.

| Fase del grafo | Duración inclusiva (ms) |
| --- | ---: |
| `graph` | 15.288,924 |
| `node_cache_load` | 6.254,548 |
| `revalidate` | 3.526,171 |
| `input_sidecars` | 2.399,317 |
| `input_contacts` | 1.287,776 |
| `pages` | 1.406,984 |
| `edges` | 1.698,292 |
| `verify_inputs` | 1.939,740 |
| `json` | 442,212 |
| `gzip` | 486,480 |

La captura `/tmp/gnosi-request-profile-ox2798gk.json`, del proceso 64601,
se ha completado sin permisos administrativos: 39 muestras dentro de una ventana
máxima de 15 s, 33 pilas agregadas y ninguna descartada. Los 50 ms son
el intervalo nominal; la frecuencia real no ha sido constante. En 37 de las
39 observaciones del hilo principal aparece el runner de uvloop, con ejecución
interna en C que esta captura no resuelve: **no permite distinguir reposo de
trabajo en C**. En los workers hay 6 observaciones de lectura/`stat` de
`managed_metadata`, 4 de lectura SQL y 2 de descodificación de la caché JSON.
Estos recuentos no son duraciones ni pueden multiplicarse por 50 ms para
atribuir tiempo. Las fases de la tabla también son inclusivas y no deben
sumarse como una partición del total.

La captura posterior del calendario
`/tmp/gnosi-request-profile-876xneks.json`, del mismo proceso 64601, contiene
34 muestras, 19 pilas agregadas y ninguna descartada. Las 34 observaciones
del hilo principal vuelven a mostrar el runner en C, sin distinguir reposo de
trabajo nativo. En los workers se han observado esperas del coordinador de tareas
(31), del bloqueo de la caché de calendarios (12), de la resolución pendiente
de credenciales (5) y de autodetección de caché antigua de Google dentro de
`_retrieve_discovery_doc` (5). Son observaciones potencialmente solapadas,
no segundos ni partes aditivas del total.

En esta lectura, la interfaz del calendario ha llegado a los **16.653 ms**.
Calendarios ha costado 10.523 ms, con 88 ms de cola y 10.431 ms de espera del
servidor; eventos, 11.637 ms, con 96 ms de cola y 11.539 ms de espera.

| Fase `Server-Timing` | Calendarios (ms) | Eventos (ms) |
| --- | ---: | ---: |
| `cal_total` | 7.426,349 | 8.582,591 |
| Cola del worker | 96,196 | 2,795 |
| Integraciones | 98,037 | 209,282 |
| Lectura de calendarios/eventos | 7.308,173 | 8.252,931 |
| Filtrado de calendarios ocultos en la base de datos | — | 124,246 |
| Credenciales | 1.763,370 | 1.791,605 |
| Servicio (`cal_service`, fase inclusiva) | 4.415,920 | 4.029,862 |
| HTTP del proveedor | 2.604,519 | 967,321 |

Estas fases siguen siendo inclusivas. Esta captura no permite atribuir la diferencia respecto de la
duración HTTP, y los tiempos entre
lecturas siguen variando.

Se han implementado dos correcciones acotadas: descodificar la caché JSON con
`pydantic_core`, con alternativa de la biblioteca estándar, y evitar
expulsiones repetidas de la caché de metadatos durante pasadas K2/N3 cuando hay
más de 512 sidecars, manteniendo la capacidad de 512. El número de sidecars
actual **no está confirmado**. Una prueba sintética del descodificador muestra
aproximadamente un 40% menos de CPU, con tiempo real variable; no demuestra que
los 6,25 s de `node_cache_load` sean tiempo de parseo. Una tercera corrección
hace que `build` del cliente Google utilice `cache_discovery=False` y
`static_discovery=True`. El código local de `discovery.py` confirma que
la autodetección de la caché precedía a la lectura del documento incluido en el paquete;
este camino aparece en la captura. Esto justifica eliminar aquella consulta
innecesaria, pero no atribuye toda la espera observada a esta función.

La batería de 80 pruebas ha dado inicialmente 75 resultados correctos y 5
fallos de fixtures (4 del context manager de escaneo y 1 del parámetro de un
mock). Se han corregido las fixtures y la repetición de los dos archivos afectados
ha superado sus 35 casos, incluidos los 5 que habían fallado: el resultado
final es de **80 casos únicos correctos**, no 110. También han pasado Ruff de
7 archivos, mypy de 3 y la comprobación del diff. El código de las tres correcciones
está estable y validado y la activación final del backend ha terminado en 185,3 s,
separados de la duración de carga de las páginas.

Las primeras aperturas directas con las tres correcciones activas se han
medido solo con `Server-Timing`, sin muestreo de pilas. Los recursos
compilados ya estaban en la caché del navegador: 64 de 64 en el grafo y 73 de 73 en el
calendario, con cero bytes transferidos en estos recursos. Por tanto, no son
mediciones con la caché de recursos del navegador vacía.

| Apertura directa final | Grafo | Calendario |
| --- | ---: | ---: |
| Primer resultado visible | 22.128 ms | 16.081 ms |
| Datos actualizados | — | 16.081 ms |
| Final de las peticiones necesarias | — | 15.882 ms |
| Salud | 1.310 ms | 133 ms |
| Espacios | 2.894 ms | 534 ms |
| Cola inicial de salud/espacios | 2 ms | 2 ms |

El grafo ha terminado sin errores ni indicador de carga. Su petición ha
devuelto HTTP 200 en 13.856 ms, con 13.746 ms de espera del servidor y 3 ms
de cola. La carga de la caché de nodos ha costado 338,287 ms: lectura
16,732 ms, parseo 220,779 ms y hash 3,579 ms. La observación anterior de
6.254,548 ms tenía condiciones diferentes y muestreo activado: **esta
comparación no demuestra una mejora causal de la carga total**.

| Fase final del grafo | Duración inclusiva (ms) |
| --- | ---: |
| `graph` | 11.136,317 |
| `revalidate` | 4.772,679 |
| `input_sidecars` | 1.158,005 |
| `input_contacts` | 1.427,903 |
| `input_suggestions` | 146,737 |
| `pages` | 1.011,945 |
| `edges` | 1.208,925 |
| `project` | 1.849,321 |
| `verify_inputs` | 1.459,192 |
| `json` | 1.235,445 |
| `gzip` | 378,968 |

En el calendario, el listado ha costado 13.387 ms, con 8 ms de cola y 13.377 ms
de espera del servidor. Eventos ha costado 14.252 ms, con 24 ms de cola
y 14.227 ms de espera del servidor.

| Fase final `Server-Timing` | Calendarios (ms) | Eventos (ms) |
| --- | ---: | ---: |
| `cal_total` | 10.494,416 | 11.513,481 |
| Cola del worker | 0,899 | 87,681 |
| Integraciones | 227,858 | 177,671 |
| Lectura de calendarios/eventos | 9.827,250 | 11.247,108 |
| Filtrado de calendarios ocultos en la base de datos | — | 118,618 |
| Credenciales | 394,340 | 443,186 |
| Servicio (`cal_service`, fase inclusiva) | 5.402,739 | 5.660,345 |
| HTTP del proveedor | 4.009,729 | 899,131 |

Las fases son inclusivas y no deben sumarse. `cal_service` incluye la capa
de acceso, la importación de discovery antes de las credenciales anidadas y
la construcción del cliente; **no es una medición exclusiva de `build`**. No
se atribuyen los aproximadamente 5,5 s enteros a construir el cliente.
Estas lecturas mantienen esperas relevantes en el servidor y no demuestran
una mejora global ni el objetivo de 0,5 s.

En la navegación final con datos ya cargados, el grafo ha sido visible a los
**7.447 ms**, con 9 elementos `canvas`, sin errores ni indicador de carga.
La API ha devuelto HTTP 200 en 6.410 ms, con 8 ms de cola y 6.319 ms de espera
del servidor.

| Fase del grafo en caliente | Duración inclusiva (ms) |
| --- | ---: |
| `graph` | 4.305,445 |
| `revalidate` | 4.162,823 |
| `input_sidecars` | 1.075,912 |
| `input_contacts` | 943,582 |
| `input_suggestions` | 50,621 |
| `json` | 1,938 |
| `gzip` | 0,063 |

El calendario en caliente ha mostrado los dos eventos a los **398 ms**, pero
los datos actualizados han llegado a los **5.392 ms**, con final de las peticiones
necesarias a los 5.372 ms. Calendarios ha costado 4.963 ms y eventos
5.048 ms; todas las API han devuelto HTTP 200 y no había errores. Esta
diferencia entre visibilidad y actualización se mantiene explícita.

La vista final se ha dejado en el calendario mensual de la dirección accesible
`127.0.0.1`, sin consulta de auditoría: 24 eventos, un mes, ninguna alerta
ni indicador de estado, sin Login ni instrumentación. La comprobación anterior
de `localhost` mostraba correctamente Login. No se han realizado acciones
de autenticación. Se ha restaurado el HTML de la copia nativa, se ha retirado el
script temporal de tiempos y se han eliminado solo las dos capturas creadas,
`ox2798gk` y `876xneks`; los artefactos temporales de trabajo y ejecución han
quedado limpios.

La comprobación final del transporte confirma HTTPS en `localhost` con HTTP 200,
verificación TLS correcta (`verify=0`), HTML `no-cache` y ninguna instrumentación.
HTTP devuelve 307 hacia `https://localhost:5173/`. Un recurso compilado devuelve
200 con `public, max-age=31536000, immutable`. El uso de swap observado era de
18.739,81 MiB (18,30 GiB): es contexto del sistema, **no prueba causal** de los
tiempos de carga. Una lectura posterior de `vm_stat` durante 5,02 s, con
páginas de 16 KiB, confirma swap activo: entradas de 85,73 MiB/s, salidas
de 81,97 MiB/s, compresión de 277,09 MiB/s y descompresión de 318,46 MiB/s.
Acredita actividad en aquel intervalo, sin atribuirle toda la latencia
de los endpoints; no se ha detenido ninguna otra aplicación. Se ha identificado la posibilidad de reutilizar texto
inmutable del esquema, pero no se ha implementado ni acreditado como coste
principal; no es un bloqueo de autorización.

### Cierre de esta fase: verificación completada, objetivo parcial

- Recuperación de sesión inválida: pruebas, tipos, ESLint, compilación y activación
  verificados; caso real de sesión inválida no ejercitado.
- Indicación de autenticación del servidor en App: compilación, límites de tamaño,
  tipos, 17 pruebas iniciales, una prueba de integración, activación y pantalla Login
  en el navegador verificados; ESLint de la nueva prueba también verificado.
- Instrumentación optativa de tiempos del calendario: implementación, pruebas,
  Ruff, mypy, activación y medición real con acceso a datos verificados.
- Muestreo Python optativo dentro del proceso: implementación, 35 pruebas de la
  batería, Ruff, mypy, activación y capturas del grafo y calendario verificados.
  Los tramos locales no explicados siguen abiertos.
- Correcciones de descodificación JSON, admisión en la caché de metadatos y
  descubrimiento estático de Google: implementadas, 80 pruebas únicas, Ruff,
  mypy, diff y activación verificados. Primeras aperturas directas medidas
  sin muestreo y navegaciones en caliente verificadas.
- Transporte HTTPS, redirección HTTP y caché inmutable de recursos verificados.
- Limpieza final de los elementos temporales de auditoría y restauración de la vista
  mensual completadas. La latencia general sigue por encima de 0,5 s;
  el estado del objetivo sigue siendo parcial.

## Corrección de las esperas observadas en la dirección habitual

El servicio habitual de `https://localhost:5173` sirve ahora una copia independiente
de la compilación, con la misma API y el mismo certificado. Las herramientas de
transformación de desarrollo ya no intervienen en cada navegación. El modo
de desarrollo sigue disponible de manera explícita. La instantánea incluye
los archivos enlazados, conserva los recursos durante otras compilaciones y
se elimina al detener el proceso que la posee.

En esta pasada se han eliminado otros trabajos repetidos:

- La resolución simultánea de una identidad de espacio espera una misma tarea
  asíncrona; los seguidores no ocupan hilos bloqueados. Comprobar una carpeta
  existente ya no intenta crearla de nuevo.
- La ruta pública de salud no resuelve el espacio indicado por cookie, cabecera o
  consulta: responde con la instantánea global de arranque. Solo se excluye esta
  ruta GET exacta; el resto conserva la resolución y los controles de acceso.
- La autodetección de la política de acceso comparte la lectura en curso. Los
  seguidores HTTP esperan en el bucle asíncrono; la caducidad sigue siendo de cinco
  segundos desde el inicio. Un reset retira la generación anterior y las variables
  explícitas se vuelven a comprobar antes de retornar. Las sesiones DB explícitas
  mantienen la comprobación actualizada y un error sigue exigiendo autenticación.
- La preparación de directorios de configuración reutiliza durante 30 segundos
  comprobaciones correctas, con un límite de 256 rutas; los errores y los cambios de selección
  conservan los reintentos. Las lecturas directas de rutas mantienen la reparación.
- El grafo revalida las fuentes a los 30 segundos y conserva la respuesta codificada
  cuando no han cambiado. La caché persistente de nodos verifica la revisión semántica
  y el resumen del JSON real. Solo las lecturas completas pueden certificarla.
  Los metadatos laterales pequeños y correctos se reutilizan después de comprobar
  su identidad y fechas; los errores no se retienen.
- El navegador pide el índice global solo cuando los filtros de campos lo necesitan,
  con consultas separadas por espacio. Sigma recibe la proyección y los filtros antes
  de indexarla; la fecha inicial ya no reinicia inmediatamente la física del grafo.
- Fotos valida el conjunto completo de 57.150 entradas persistidas y prepara rutas
  solo para los elementos seleccionados. Los filtros y las ordenaciones siguen recorriendo
  todos los datos cuando es necesario. El árbol comparte lecturas simultáneas y limita
  globalmente a cuatro las exploraciones de directorios, sin retener resultados
  completados de una petición a otra.
- Google Calendar comparte solo la lectura de credenciales que todavía está
  en curso para la misma cuenta y revisión. Cada consumidor construye su
  cliente. Leer la ruta local de los recordatorios ya no carga la configuración
  del espacio ni prepara directorios.

- El calendario conserva una instantánea completa de las fuentes locales por espacio
  y la revalida en cada apertura. Los eventos ya disponibles se muestran
  mientras llega la actualización, identificada con un indicador de actividad.
  Una respuesta parcial no sustituye a la última instantánea completa; los errores
  siguen visibles con reintento. La primera respuesta parcial puede mostrar
  notas útiles. Las consultas, los recordatorios y las invalidaciones tardías
  quedan separados por espacio, sin ampliar los 30 segundos de frescura externa.

Las 36 pruebas finales del calendario cubren el remontaje real de FullCalendar
con cuatro respuestas aplazadas, datos envejecidos del mismo rango, errores parciales,
cambios de espacio y mutaciones tardías. Han pasado después de sustituir una API de
cancelación ausente en jsdom por un controlador con limpieza de listener y temporizador.

Validación de esta pasada: 35 pruebas de calendario/recordatorios/identidad,
29 de Fotos y 32 del grafo en la interfaz. Las dos pruebas de línea temporal
se han repetido después del último ajuste de sus esperas. También han pasado
las baterías de persistencia/revalidación del grafo, las 124 pruebas de los scripts
de arranque, las 18 de instantánea nativa y las 21 de configuración de Vite.
La comprobación completa de tipos de la interfaz, ESLint, Mypy de los módulos
modificados y la compilación con los controles de contrato y tamaño son correctos.
El tamaño estático inicial sigue en 538.828 B. La última batería añade
116 comprobaciones de política de acceso, salud y encaminamiento; Mypy de los tres
módulos implicados también es correcto.

### Comprobación del calendario con continuidad de datos

| Componente | Visible con datos disponibles | Actualización completa |
| --- | --- | --- |
| Calendario, tres reaperturas | 0,306 / 0,210 / 0,212 s | 0,658 / 0,639 / 1,744 s |
| Grafo completo | 1,618 s | 1,618 s |
| Complementos instalados | 0,179 s | 0,421 s |
| Planificación, 67 controles y 834 opciones | 0,843 s | 0,843 s |
| Fotos con índice vigente, 50 elementos y tres imágenes visibles | 0,525 s | 0,525 s |

Las reaperturas del calendario han mostrado los eventos mientras se actualizaban
las fuentes, con dos eventos en la vista diaria y 24 en la mensual. La primera
apertura del documento ha necesitado 8,084 s y queda separada de estas mediciones.
Unos 1,6 s de las dos peticiones iniciales transcurren antes de `requestStart`;
no se cuentan como tiempo de servicio del backend ni se da por probada su causa.
La medición del formulario exige todas las opciones: tener los controles vacíos a los
0,193 s no es carga completa.

La prueba ha detectado otro límite concreto en Fotos: el índice anterior caducaba
alrededor de las 21:57, después de 24 horas. La misma clave de índice ha necesitado
113,6 s para reindexar las 57.150 entradas, terminando a las 22:04:03. La validación de
las filas es correcta y no hay cambio de clave; el bloqueo proviene del escaneo
síncrono cuando vence el plazo. La primera visita de Fotos queda registrada como
incompleta en el navegador; la muestra de 0,525 s es posterior a la reindexación.

La serie conserva el pico completo de 22,384 s del grafo: varias peticiones de
configuración y datos esperaron unos 21 s. Otro intento de grafo se abandonó
antes de recibir la API y queda identificado como incompleto. Durante la revisión, los
datos del grafo pasaron de 2.509 nodos / 7.250 aristas a 3.237 / 7.244, con un
resumen diferente y reconstrucción verificada; esta petición de 11,321 s no es una
medición de reutilización sobre datos inmutables. La revalidación anterior sin
cambios había costado 1,756 s. No se ha inspeccionado el origen concreto del cambio de
datos ni se atribuyen causalmente los picos a una única observación de memoria.

La cuenta de correo sigue fuera del alcance. Las series de las secciones siguientes
son históricas y no describen todas esta última activación.

### Corrección de la caducidad diaria de Fotos

La ruta de Fotos devuelve ahora el último índice completo cuando vence el plazo de
24 horas y encarga la actualización a dos trabajadores, con un máximo de ocho
tareas en curso o pendientes. Las peticiones de la misma clave comparten la
tarea. La primera exploración de una biblioteca sin índice todavía debe terminar
antes de mostrar sus datos.

La interfaz identifica la actualización, conserva las fotos ante un error
y permite reintentar después del plazo indicado. Comprueba el resultado cada cinco
segundos, como máximo 60 veces. Cambiar de espacio, carpeta o filtro cancela las
lecturas de la selección anterior. Si el índice cambia durante la paginación, recupera
el conjunto ya cargado y lo sustituye completo: no mezcla versiones. Un cursor
de posición independiente de los elementos devueltos permite avanzar aunque algunos
archivos hayan desaparecido.

Una exploración parcial no se publica como índice completo. La persistencia es
atómica y las invalidaciones impiden que una tarea antigua vuelva a publicar.
Si falla la escritura de caché, una exploración completa sigue disponible en
memoria. Los índices históricos conservan el formato y pasan validación estructural;
el formato antiguo no permite demostrar retrospectivamente que una exploración no
fuera parcial.

Validación final de esta corrección: **70 pruebas de servidor y 45 de la
interfaz**, Mypy de cinco módulos, tipos de los archivos afectados y dependencias,
y ESLint correctos. Las dos pruebas de cabeceras y cursor se han repetido después
del último ajuste de tipos. La compilación final ha pasado en 50,72 s, con los
controles de contrato, idiomas y tamaño; el tamaño estático inicial sigue en
538.828 B. La caducidad, las exploraciones lentas, los errores y las invalidaciones
se han probado con datos aislados. No se ha alterado ni hecho caducar expresamente
el índice real para repetir el escaneo de 113,6 s.

La corrección está activada en el servidor nativo y en la interfaz compilada con
HTTPS verificado. La consulta HTTP real devuelve 50 elementos de 57.150, estado
`fresh`, revisión presente y cursor 50, en 0,702 s. La comprobación visible ha
mostrado las 50 tarjetas y las tres imágenes visibles cargadas, sin errores.

| Comprobación final después de la activación | Visible con datos | Actualización completa |
| --- | --- | --- |
| Fotos, primera apertura del documento | 29,128 s | 29,128 s |
| Calendario, primera visita de esta sesión | 19,976 s | 19,976 s |
| Fotos, reapertura | 1,982 s | 1,982 s |
| Calendario, reapertura | 0,484 s | 6,160 s |

Esta pasada confirma la funcionalidad pero **no resuelve los picos generales
de latencia**. La primera petición de salud ha incluido 3,712 s antes de
`requestStart` y 8,332 s hasta el primer byte; el catálogo de espacios ha tardado
11,570 s desde `requestStart` hasta el primer byte. Las lecturas de Fotos no comienzan
hasta los 20,734 s. Las fuentes locales del primer calendario han necesitado 5–7 s
y las lecturas externas 16–18 s. Las mediciones lentas se conservan y no se
sustituyen por las reaperturas más rápidas. El calendario reabierto sí muestra
los datos anteriores durante la actualización, tal como se pretendía.

Una comprobación posterior de solo lectura ha devuelto seis respuestas de salud
200: 104–361 ms directamente y 189–857 ms a través del frontal, con 55–708 ms de
negociación TLS. No ha reproducido la espera de ocho segundos. El Mac mostraba
19,18 GiB de swap, 60–64 MiB de memoria libre y 7,1–7,5 GiB en el compresor.
Entre dos lecturas han aumentado 5,58 GiB las entradas de swap y 4,98 GiB las
salidas; son diferencias entre muestras, no tasas por segundo. La presión de
memoria es compatible con pausas globales, pero no demuestra la causa de los picos
ni identifica otra corrección concreta del código.

Se ha retirado la instrumentación temporal y se ha restaurado el documento compilado.
HTTPS devuelve 200 con verificación del certificado correcta; HTTP devuelve 307
hacia HTTPS conservando la ruta y la consulta. El documento final no contiene el
cliente de desarrollo ni el script de medición; el navegador no conserva
el atributo de la auditoría después de recargar la dirección limpia.

## Continuación: bloqueos del servidor y recargas

Una captura nativa de 30 segundos durante la carga del calendario ha recogido
51 respuestas de salud correctas, con mediana de 32 ms y máximo de 853 ms. El hilo
principal estaba esperando eventos de red en 1.674 de 2.644 muestras;
también había esperas por el GIL. La captura no ha reproducido la pausa larga
anterior. Los frames anidados de las pilas no son tiempos independientes que se
puedan sumar.

Se han corregido dos bloqueos demostrables con pruebas sintéticas: la notificación
síncrona de un error podía retener el hilo principal mientras escribía archivos,
SQLite o llamaba a la notificación nativa; el inicio diferido del planificador también
hacía I/O en él. Ahora ambas operaciones se ejecutan en un trabajador. La
cancelación del inicio espera a que el trabajador termine antes de detener el
planificador, para evitar un inicio posterior a la parada. Se conservan el contexto
del espacio y la respuesta 500 sin contenido privado. Han pasado 14 pruebas y
Mypy de los dos módulos. Los cambios ya están activados; no se presentan como causa
probada del pico anterior.

La recarga del calendario con la versión anterior ha realizado **121 consultas de
recursos compilados**, todas con transferencia indicada por el navegador: 36.300 B
de transferencia agregada y 1.488.184 B de contenido descodificado. El recurso
inicial devolvía `Cache-Control: no-cache`. El calendario ha mostrado dos
eventos a los 10,838 s, con la última lectura necesaria a los 10,613 s.

La compilación incluye ahora el manifiesto de Vite y el servidor reconoce exactamente
sus recursos con hash. Solo estos archivos públicos pueden usar caché
inmutable en GET/HEAD y respuestas 200, 206 o 304. HTML, API, recursos inexistentes,
otros métodos y reescrituras hacia HTML quedan excluidos. Un cambio de contenido
produce una URL diferente. Una instantánea antigua sin manifiesto conserva la
política anterior. Han pasado 45 pruebas, incluida una integración con Vite real,
la comprobación de tipos de los archivos afectados y ESLint.

La versión está activada con HTTPS verificado. La compilación completa ha pasado
en 13,15 s; el cambio final de la guarda de cabeceras solo afecta al middleware
que se carga al arrancar preview. Después de este ajuste se han repetido las
45 pruebas, incluidas dos compilaciones mínimas reales, tipos y ESLint.

| Documento del calendario | Con datos y actualización completa | Recursos compilados reutilizados | Transferencia de estos recursos |
| --- | --- | --- | --- |
| Antes de la nueva política | 10,838 s | 0 de 121 | 36.300 B |
| Primera recepción de las nuevas cabeceras | 4,852 s | 0 de 121 | 497.910 B |
| Recarga posterior | 1,178 s | 121 de 121 | 0 B |
| Segunda recarga posterior | 1,218 s | 121 de 121 | 0 B |

Las tres visitas finales muestran dos eventos y ningún error. La reutilización
de los 121 recursos sin transferencia está comprobada directamente. La duración
total también incluye los datos: la API de eventos pasa de 2,365 s a 0,199 y
0,224 s en las dos recargas, con datos ya en caché. No se atribuye toda la
mejora de la página a la nueva política, ni se da por resuelto el pico histórico
de 29 s o garantizado el objetivo general de 0,5 s.

Se ha retirado la instrumentación. La dirección habitual queda abierta con 24
eventos en la vista mensual, sin errores ni actualizaciones pendientes.
HTTPS y la redirección se han vuelto a verificar; el documento HTML conserva
`no-cache` y los recursos compilados la política inmutable.

## Mejoras adicionales: arranque, grafo y fotos

Las secciones siguientes son históricas; la última comprobación de los picos restantes
se recoge en «Continuación: bloqueos del servidor y recargas».

La cuenta de correo queda **fuera del alcance**, tal como ha pedido el usuario.
Las mejoras siguientes están implementadas y validadas; el límite general de 0,5 s
sigue pendiente.

- El arranque prepara las rutas sin generar anticipadamente la documentación de
  la API. En una prueba con la app real y datos temporales, preparar las rutas ha costado
  10,187 s; generar después el esquema ha añadido 16,635 s. Este segundo trabajo ya no
  retrasa la disponibilidad del servicio. Las 452 rutas y el contenido del esquema
  coinciden exactamente con el contrato publicado. Se mantienen permisos,
  validación de peticiones/respuestas y compatibilidad con encaminadores antiguos.
- El grafo reutiliza el esquema de las páginas sin tabla y calcula cada color de
  grupo una vez. La física construye directamente los datos D3, sin una copia
  adicional de Graphology. El benchmark sintético de preparación pasa de 28,38 a
  5,01 ms con 1.000 nodos y de 73,34 a 14,33 ms con 5.000 nodos (5,1–5,7 veces
  más rápido). Esto mide preparación, no la carga completa de la pantalla.
- Las fotos comprueban contención, tipo y metadatos fuera del bucle principal,
  bajo el límite de concurrencia existente. FileResponse reutiliza la misma
  lectura de metadatos. La galería mantiene todos los elementos, comparte un observador
  con margen de 160 px y evita el retraso de animación acumulado. Las fuentes originales,
  la recuperación de errores y las comprobaciones de contención se conservan.

La primera API del grafo observada antes de los cambios ha costado 27,820 s; después
de reiniciar, 10,475 s, con los mismos 2.509 nodos y 656.492 bytes comprimidos.
Las lecturas inmediatamente repetidas han costado 186 y 26 ms. Es una observación
con carga variable, **no una comparación causal controlada**. La instrumentación
optativa `X-Gnosi-Graph-Timing: 1` devuelve solo tiempos y recuentos agregados.
Ha separado 4,700 s de carga de caché, 2,163 s de páginas, 1,414 s de JSON y
0,530 s de compresión en aquella primera petición. La misma caché (2,97 MB,
1.884 entradas) se ha leído posteriormente en 2 ms e interpretado en 72 ms; esta
lectura en caliente no explica toda la espera inicial.

### Pasada visible de la nueva compilación

| Comprobación | Tiempo hasta el contenido completo |
| --- | --- |
| Grafo, tres navegaciones con otros comprobadores activos | 17,679 / 7,962 / 11,581 s |
| Grafo, después de terminar los otros comprobadores | 8,149 s |
| Fotos visibles, tres navegaciones | 6,677 / 0,985 / 0,588 s |
| Fotos y árbol de carpetas completos | 6,677 / 1,671 / 0,736 s |
| Documento completo de calendario, vista diaria | 16,595 / 4,627 s |

La vista utilizada mide 596 × 784 px: contiene tres fotos visibles y una tarjeta
no fotográfica, con 50 elementos totales. Las cinco peticiones de imagen por navegación
incluyen las fuentes próximas al límite visible. No es comparable directamente con
las 19 fotos visibles de la pasada anterior. Se ha abierto y cerrado una foto
inicialmente fuera de pantalla; después del desplazamiento había 15 imágenes
cargadas, sin errores ni recuperaciones pendientes. El calendario diario ha mostrado
sus dos eventos; al seleccionar el mes, los 24 eventos completos.
Un grafo reutilizado antes de recibir la respuesta nueva no se ha contado como datos
actualizados.

El Mac ha llegado a 19,8 GB de memoria de intercambio ocupada. Las primeras mediciones
coincidían con comprobadores de otras tareas; la última del grafo ya no, pero
seguían activas otras aplicaciones. Por tanto, la primera carga **todavía no
es estable** y esta pasada no acredita una mejora general de los tiempos visibles.

Validación: 70 pruebas backend diferentes y 52 frontend; comprobación completa de
tipos frontend, Mypy de los siete módulos modificados, ESLint y compilación con límites
de tamaño correctos. La batería final de compatibilidad y ciclo de vida incluye
10 pruebas, ya contadas dentro de las 70 del backend. El tamaño estático inicial se
mantiene en 538.828 B.

La documentación valida 31 páginas revisadas y nueve generadas; `diff --check` es
correcto. Se ha detenido y eliminado la previsualización temporal. Gnosi queda en
HTTPS 5173 (certificado verificado), con HTTP→HTTPS 307 y el calendario mensual
con 24 eventos, sin alertas ni carga pendiente. La página habitual no
contiene instrumentación temporal.

## Resultado anterior de los cinco puntos

| Punto | Cambio y evidencia final | Límite pendiente |
| --- | --- | --- |
| 1. Planificación y Fotos | Historial disponible sin errores; 19 de 19 fotos visibles cargadas, incluida una recuperación 503→200. | No se ha comprobado cada archivo fuera de la pantalla. |
| 2. Esperas de datos | Grafo comprimido y lecturas compartidas; selectores compactos; correo y paginación publican cada cuenta disponible y conservan errores explícitos. | Una cuenta de correo agota la conexión; no se ha recuperado su disponibilidad. |
| 3. Primera carga | Preparación solapada, peticiones compartidas y recuperación explícita después del timeout del catálogo. | El arranque sigue siendo variable; una apertura completa de tabla ha necesitado 5,20 s para datos y controles. |
| 4. Cobertura funcional | 19 apartados de ajustes, dos tablas, página y tablero personalizado, tablero principal, editores de complementos y detalles de artículo, correo y cuaderno. | Es cobertura representativa, no cada registro, vista o complemento desactivado. |
| 5. Aceptación repetida | Tres cargas completas de calendario, grafo y lector, con mínimo/mediana/máximo separados de las observaciones iniciales. | No se cumple el límite general de 0,5 s. |

## Mediciones de la compilación final

| Componente | Muestras completas | Mínimo | Mediana | Máximo |
| --- | ---: | ---: | ---: | ---: |
| Calendario | 3 | 0,685 s | 0,806 s | 3,525 s |
| Grafo | 3 | 2,289 s | 2,429 s | 6,004 s |
| Lector | 3 | 0,907 s | 1,133 s | 1,225 s |

Se ha excluido un intento de calendario abandonado antes de recibir los eventos.
No se han convertido estas muestras pequeñas en percentiles. En estas mediciones
no había pruebas ni compiladores de esta revisión en marcha; seguían activas
otras aplicaciones y había presión de memoria. No son una comparación controlada
con la primera serie.

Observaciones adicionales: Planificación 0,425 s; catálogo de complementos 0,293 s;
configuración de Planificación verificada a 1,54 s con siete desplegables habilitados
y 834 opciones; fotos visibles 5,688 s; dos tablas con 12 y 19 filas a 5,195 s
(apertura completa) y 1,952 s (navegación), respectivamente. Estas dos últimas
mediciones acreditan datos y controles, no todas las miniaturas.

El correo ha mostrado los mensajes de las cuentas disponibles a 3,195 s y 1,479 s
en dos navegaciones; sus recuentos estaban disponibles a 3,274 s y 3,196 s.
La cuenta restante ha quedado explícitamente no disponible aproximadamente a los
21–22 s, con 503 en recuentos y error de proveedor en listado. Se han conservado
los 20 mensajes visibles de las otras cuentas. Estas son mediciones de
**disponibilidad parcial**, no cargas completas de todas las cuentas.

Un artículo ha mostrado el cuerpo a los 0,223 s. El detalle de un cuaderno existente ha
mostrado contenido y 68 controles a los 2,494 s; el catálogo contiene dos cuadernos.
Se ha abierto un correo ya leído: respuesta de detalle 0,780 s y cuerpo renderizado
en iframe, sin atribuirle un tiempo de navegación completo porque este clic
no reiniciaba el contador temporal. El tablero principal ha mostrado contenido
y 56 controles a los 1,928 s. «Configurar» de Automatizaciones ha abierto IA →
Automatizaciones con siete controles, sin pantalla vacía.

La comprobación completa de tipos frontend, la compilación final y los límites
de tamaño han pasado. La compilación ha validado API, cuatro idiomas, notas de versión
y 14 casos de configuración Vite. Tamaño estático inicial: 538.828 B; correo:
727.009 B. Las últimas regresiones han pasado: cinco de complementos, cinco de
configuración de Planificación, 16 de listado/paginación del correo y 27 backend
de disponibilidad/independencia de listado. Las otras baterías se detallan más abajo.
La documentación valida 31 páginas revisadas y nueve generadas.

Se ha retirado la instrumentación y detenido la previsualización temporal del puerto
5174. La aplicación habitual ha quedado abierta en HTTPS en el puerto 5173 con el calendario,
24 eventos visibles y sin carga pendiente ni alertas.

## Observaciones anteriores

Las secciones siguientes documentan el punto de partida y las comprobaciones intermedias.
Las incidencias que se describen no sustituyen al resultado final anterior.

## Cómo se ha medido

Se han observado navegaciones reales, las respuestas de red y los cambios del contenido
renderizado. La instrumentación temporal solo registra recuentos y tiempos.
Una pantalla vacía, un esqueleto, datos antiguos en memoria o un formulario pendiente
de recibir valores no acreditan una carga completa. Los anunciadores accesibles
vacíos tampoco se han contado como indicadores de carga bloqueada.

La columna compilada corresponde a una previsualización local temporal en el puerto 5174,
con el mismo backend. Son observaciones de la sesión, no percentiles ni una comparación
controlada con cachés equivalentes. Los datos y preferencias locales del navegador
pueden variar entre puertos. No había pruebas ni compilaciones de esta revisión ejecutándose durante las mediciones; en la segunda serie sí había comprobaciones de otra tarea y presión de memoria, indicadas explícitamente más abajo.

## Resultados observados

| Pantalla o acción | Desarrollo, 5173 | Compilada, 5174 | Qué acredita la medición |
| --- | ---: | ---: | --- |
| Calendario, recarga repetida | 3,09 s | 2,23 s | Dos eventos visibles y carga terminada. |
| Calendario, primera carga observada | 34,58 s | 7,02 s | Muestra la variabilidad inicial; no son arranques en condiciones equivalentes. |
| Configuración general | ≥2,12 s | ≥0,88 s | Última respuesta necesaria; el primer formulario aparece antes. |
| Catálogo de complementos | 0,83 s | 0,44 s | Catálogo y complementos instalados cargados. Solo esta observación compilada entra en 0,5 s. |
| Configuración del complemento de planificación | 4,17 s | 0,77 s | Siete desplegables habilitados, con 834 opciones. |
| Correo | 6,25 s | 5,91 s | Lista actualizada; las últimas etiquetas terminan a 6,30 s y 6,79 s respectivamente. |
| Grafo | 5,99 s | 6,40 s | Renderizador presente sin indicador de carga; dibujo verificado visualmente en la sesión nativa. |
| Tablero de control | ≥1,83 s | No repetido | Últimas lecturas; el contenido inicial aparece a 1,39 s. |
| Catálogo de Conocimiento | ≥2,33 s | ≥1,10 s | Incluye la lectura de configuración de Wiki. |
| Una tabla existente | No muestreada | 3,53 s | Contenido con 12 filas; lecturas adicionales hasta 9,88 s. No acredita todas las tablas. |
| Lector | No repetido | 4,22 s | Lista de artículos renderizada. No se han abierto cuerpos de artículos. |
| Cuadernos | No repetido | 0,91 s | Pantalla con los datos del catálogo. |
| Búsqueda bibliográfica | No repetido | ≥2,15 s | Lectura de búsquedas guardadas; no se ha ejecutado una búsqueda externa. |
| Social | No repetido | 4,83 s | Las dos listas cargadas; imágenes observadas hasta 5,14 s. |
| Contactos | No repetido | 0,63 s | Lista renderizada; imágenes y alternativas hasta 1,02 s. Acceso verificado con el teclado. |
| Planificación principal | No repetido | Error | Aparece una alerta hacia los 13,09 s; las lecturas del historial devuelven 500. |
| Fotos | Incidencia | No repetido | Nueve elementos terminan mostrando «No descargado» después de reintentos con 503. |

Las peticiones repetidas a una misma ruta no demuestran por sí solas una duplicación:
por ejemplo, el correo puede consultar cuentas diferentes. No se han conservado los
parámetros privados para interpretar estas peticiones como si fueran idénticas.
Tampoco se han contado las imágenes fuera de pantalla con carga diferida como errores.

## Los cinco puntos de partida

1. **Resolver las incidencias funcionales.** Las lecturas de líneas base y registros
   de trabajo fallan en `PlanningStore.history`, al leer el historial, con
   `OSError: [Errno 11] Resource deadlock avoided`. Hay que tratar la disponibilidad
   del archivo sin sustituir el historial por datos vacíos. En Fotos, hay que verificar
   y completar la materialización de los archivos pendientes: los registros confirman
   peticiones de descarga y respuestas 503, pero no que las descargas terminen.
2. **Reducir las esperas de datos.** En la sesión compilada, las lecturas remotas del
   correo duran aproximadamente 3,6–4,8 s; la petición del grafo, 4,85 s; los artículos
   del lector, 3,42 s. Los ajustes todavía esperan las lecturas de configuración,
   y el formulario de planificación supera 0,5 s pese a la respuesta más pequeña.
3. **Estabilizar la primera carga.** El calendario repetido es más rápido que la
   primera carga observada. Hay que separar inicialización, lectura del catálogo,
   respuesta de los servicios externos y tiempo de renderizado antes de atribuirlo todo
   al navegador o a la presión de memoria del Mac.
4. **Completar la cobertura funcional.** Faltan páginas individuales representativas,
   más tablas y vistas, tableros personalizados, los otros apartados de configuración
   y editores de complementos, detalles de cuadernos/artículos/correos y variantes de
   navegación compacta con ratón. Los desplegables de datos y el acceso a Contactos
   han funcionado con el teclado; los intentos con puntero requieren una comprobación
   específica antes de concluir si hay un problema de la aplicación o de la automatización.
5. **Repetir la aceptación después de los cambios.** Medir cargas iniciales y repetidas
   con datos actuales y controles utilizables, y obtener distribuciones de tiempos.
   Una observación de 0,44 s del catálogo de complementos no permite dar por alcanzado
   el objetivo general.

## Cambios previos y validación

La carga local y externa del calendario ya se solapa. La configuración de
planificación ya solicita referencias de página con identificador y título: para los
793 registros medidos, la respuesta conjunta pasa de 1.130.202 a 67.381 bytes
(94,04 % menos), conservando los identificadores, los títulos y el filtrado.
Las mediciones de la interfaz anteriores muestran que la reducción de tamaño no garantiza
el presupuesto de tiempo de toda la pantalla.

La validación previa del cambio del calendario incluye 17 pruebas de componente,
comprobación de tipos, lint y compilación con los límites de tamaño. Esta revisión
añade comprobaciones del navegador; no presenta aquellas pruebas como sustituto
de la aceptación de rendimiento ni como una suite completa de toda la aplicación.

## Segunda intervención: los cinco puntos

Se han repartido en tres revisiones independientes la recuperación de Planificación,
la disponibilidad de Fotos y las lecturas de grafo/correo. La integración añade
la revisión de navegación, configuración, arranque y validación conjunta.

### Correcciones incorporadas

- Planificación conserva el error explícito cuando un archivo existente no se puede
  leer; no lo sustituye por un historial vacío. Las lecturas temporalmente
  pendientes piden recuperación al proveedor y se reintentan con un límite. Las
  consultas y los datos provisionales quedan separados por vault. La selección
  real del proyecto precede a las lecturas de calendario y líneas base.
- Fotos distingue una descarga pendiente de un fallo confirmado. La miniatura
  recupera los bytes sin una segunda descarga, cancela al salir y permite
  reintentar los errores confirmados. La disponibilidad se comprueba con lectura
  real, no con el número de bloques asignados al archivo.
- El grafo comparte reconstrucciones concurrentes del mismo vault, evita
  releer el registro en aciertos de caché y comprime fuera del bucle
  principal del servidor. El correo separa la conexión de recuentos de carpetas
  de la lista de mensajes y solo solicita las cabeceras utilizadas.
- Los ajustes cargan tablas y bases de datos a la vez, manteniendo el resultado
  disponible si la otra lectura falla. El Lector reutiliza el formateador de
  fechas de la lista. El arranque solapa salud del servidor y preparación de ruta.
- Se ha corregido una capa que tapaba los accesos rápidos con el ratón en modo
  compacto. «Configurar» de Automatizaciones abre ahora IA → Automatizaciones, en
  lugar de seleccionar un apartado inexistente y dejar los ajustes vacíos.
- El servicio nativo evita una reinstalación automática de dependencias al
  reiniciarse si otra tarea ha cambiado los manifiestos del proyecto.

### Cobertura adicional

En el navegador se han abierto los 19 apartados disponibles de ajustes, sin alertas
de carga. Notas diarias ha mostrado dos desplegables con 18 opciones; captura
web, cuatro con 55 opciones; Wiki, 45 controles con 238 opciones. No se han cambiado
valores ni activado complementos. Genogramas e Importar Notion estaban desactivados
en el catálogo; esta revisión no los activa para simular una cobertura real.
La comprobación con ratón de Contactos ha confirmado el acceso después de corregir
la capa superpuesta. Las comprobaciones de contenido de los otros componentes y
las mediciones finales se documentan a continuación una vez terminadas.

Las pruebas adicionales incluyen 43 casos de ciclo de vida y navegación de páginas,
tablas y vistas incrustadas con renderizadores reales; 23 de configuración, incluido
el clic real de Automatizaciones sin escrituras; 20 de arranque y agrupación de
peticiones; 12 de Lector; 17 de Fotos; y 12 de Planificación, incluido el cambio de
vault con respuestas pendientes. Las 14 pruebas de compresión cubren también el
rechazo 406 cuando el cliente no acepta ninguna codificación disponible. Las pruebas
backend de recuperación y correo/grafo constan en los resultados de los tres trabajos.
Ruff y Mypy han pasado sobre los diez archivos backend integrados.

La primera comprobación completa de tipos frontend ha pasado. Una repetición
posterior ha detectado dos errores en el trabajo concurrente de genogramas; se ha
coordinado la integración con aquel trabajo y se registra por separado la
compilación final. Ningún resultado anterior acredita automáticamente el estado de
archivos modificados después.

### Compilación y arranque observado

La compilación anterior a las últimas correcciones de correo y complementos ha pasado, incluidos contrato API, frontera API, cuatro
idiomas, notas de versión, 14 pruebas de configuración Vite y límites de tamaño.
Tamaños sin comprimir: entrada 21.521 B; petición inicial 83.336 B; conjunto
estático inicial 538.770 B; correo 724.853 B; calendario 960.269 B; fragmento
más grande 1.375.866 B. No se han incrementado los límites para superar esta
validación.

Los dos servicios nativos se han reiniciado. Han terminado respondiendo 200; HTTPS
verifica correctamente el certificado y HTTP devuelve 307 a HTTPS. El arranque del
backend ha tardado varios minutos mientras había comprobadores de otras tareas
activos. Una muestra de un segundo ha encontrado un worker en Pydantic y recogida de
memoria, coherente con preparación de OpenAPI. No acredita que esta fase explique
toda la espera; no se han cambiado globalmente los parámetros de memoria a partir
de esta única muestra.

Para evitar cambios de archivos durante la prueba, se ha servido una copia temporal
independiente de la compilación. Las primeras observaciones de la segunda intervención
se han hecho con carga concurrente y no constituyen una comparación controlada
con las cifras anteriores. En esta situación incluso salud del backend y
HTML nativo han tardado 5,44 s y 4,25 s. No se pueden atribuir estas esperas
solo a los proveedores externos.

Planificación ha recuperado las dos lecturas del historial: 503 pendiente seguido de
200, sin alerta final. Fotos ha llegado a mostrar 16 imágenes visibles
correctas, dos pendientes y un fallo visible. Esto es recuperación parcial,
no confirmación de que todos los archivos hayan terminado de descargarse.

### Distribución de las observaciones bajo carga concurrente

Se han separado las recargas completas de las navegaciones del menú. El tiempo
llega hasta el primer fotograma con contenido después de las respuestas
necesarias; excluye recordatorios periódicos que llegan cuando la pantalla ya es
utilizable. Son muestras pequeñas de una sesión con presión de recursos, no p 95
ni estimaciones de una máquina en reposo.

| Componente | Muestras de navegación | Mínimo | Mediana | Máximo | Estado |
| --- | ---: | ---: | ---: | ---: | --- |
| Calendario | 3 | 2,734 s | 3,626 s | 18,118 s | 24 eventos, sin alertas. |
| Lector | 3 | 8,458 s | 9,348 s | 9,769 s | 500 artículos renderizados. |
| Planificación | 2 | 0,677 s | — | 5,665 s | Historial recuperado, sin alertas. |
| Grafo | 2 completas | 5,620 s | — | 17,650 s | Nueve superficies de dibujo, sin carga pendiente. Otra muestra solo acredita respuesta API a los 45,95 s. |
| Correo | 3, antes de la corrección final | — | — | — | No acreditan frescura: se ha detectado fallback silencioso y un recuento 500. |

Las recargas completas separadas han dado 14,898 s para el calendario y 18,359 s
para Planificación, esta última incluyendo recuperación 503→200 del historial.
Estos resultados **no acreditan una mejora general ni el límite de 0,5 s**.
Se han guardado las observaciones sin contenido privado en
[navigation-latency-observations-2026-09-08.json](navigation-latency-observations-2026-09-08.json).

### Incidencias adicionales descubiertas durante la cobertura

Una página favorita y un tablero personalizado se han abierto con editor y contenido,
sin error ni indicador de carga pendiente. El intento posterior de abrir una
tabla ha quedado bloqueado durante el arranque: no se ha registrado error JavaScript;
la recarga ha recibido salud a los 28,3 s y catálogo de vaults a los 47,6 s, y después
las lecturas de autenticación/complementos han agotado los 10 s. El código ignoraba
`loadError` del catálogo y seguía mostrando solo «Cargando» indefinidamente.
Se ha añadido una recuperación explícita en los dos puntos que mantienen cerradas las
funciones hasta conocer el estado de los complementos. Este caso de tabla no se
cuenta como una validación funcional satisfactoria.

La revisión del correo ha confirmado que un fallo IMAP podía convertirse en
lista vacía 200 y quedar guardado en la caché. También se esperaban todos los recuentos
antes de publicar los que ya habían respondido. La corrección conserva errores
explícitos, evita guardar el fallo en caché, publica las cuentas disponibles e identifica
las pendientes o no disponibles sin convertirlas en cero. El límite exterior
es 30 s; los GET de Microsoft tienen, además, límite de conexión de 20 s. Las duraciones
observadas de unos 25 s no se interpretan como un timeout configurado exactamente de 25 s.

Esta última corrección del correo tiene 38 pruebas backend y 7 frontend superadas.
La validación de documentación ya pasa:31 páginas revisadas y 9 generadas. La
validación conjunta final y la comprobación de recuperación del catálogo se registran
después; no se reutilizan las capturas antiguas como si verificasen estos
últimos cambios.

### Cierre de las regresiones detectadas

La recuperación del catálogo tiene cinco pruebas superadas: timeout, clic real de reintento,
rechazo, respeto de la autenticación, y cambio de vault con lecturas o mutaciones
pendientes. Las respuestas y las reversiones del vault anterior ya no se aplican
al vault actual. El controlador de configuración de Planificación tiene cinco casos
superados: las lecturas de tablas y referencias se cancelan y se vuelven a realizar
al cambiar de vault, incluso con identificadores de tabla iguales.

Los recuentos de correo comparten solo lecturas de la misma generación:
una invalidación por acción del usuario impide reutilizar y publicar el resultado
anterior. Las 27 pruebas conjuntas de disponibilidad e independencia de listado
han pasado, así como Ruff y Mypy de los dos archivos de esta última corrección.
La paginación publica cada cuenta cuando responde y conserva cursor, mensajes y
selección si falla otra cuenta; el reintento consulta solo las páginas
fallidas. Las 16 pruebas de listado, acciones y datos pasan, incluidos los dos
casos nuevos de error HTTP y de proveedor.

El servidor nativo se ha reiniciado con estos cambios. La comprobación ha obtenido
200 en salud y HTTPS con verificación de certificado correcta, y 307 de HTTP a HTTPS.
La memoria de intercambio ocupada del Mac era aproximadamente 18,3 GiB; las mediciones
posteriores no representan una máquina en reposo. No se han detenido las aplicaciones
ni las máquinas virtuales del usuario.
