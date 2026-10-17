---
status: partial
last_verified: 2026-10-17
source_paths:
  - backend/domains/mail
  - frontend/src/features/mail
  - backend/services/microsoft_mail_service.py
tests:
  - backend/tests/test_mail_move_identity.py
  - backend/tests/test_mail_cache_scope.py
  - backend/tests/test_mail_archive_listing.py
  - backend/tests/test_mail_archive_identity.py
  - backend/tests/test_mail_connection_lifecycle.py
  - backend/tests/test_mail_conversation_truthfulness.py
  - backend/tests/test_mail_ordered_header_listing.py
  - backend/tests/test_mail_detail_responsiveness.py
  - backend/tests/test_mail_read_negative_contract.py
  - frontend/src/features/mail/components/MailViewer.loading.test.tsx
  - tests/e2e/tests/disposable/mail-archive-pagination.spec.ts
  - tests/e2e/tests/disposable/mail-reader-responsiveness.spec.ts
---

# Referencia de Apple Mail y cobertura de Gnosi

Esta investigación utiliza Apple Mail 16.0 instalado, compilación
3901.100.1.1.12, como referencia de comportamiento para mejorar el módulo de
correo de Gnosi. El SHA-256 del ejecutable es
`9e1d4526c45462d3facdfe47e133c42d97ead0fd97229dfc6ef5a0eab2e44aec`.
El código de implementación y los recursos de Apple no se incorporan a Gnosi.

## Evidencias y límites

REA ha decodificado los 107 documentos de interfaz compilados con una unión
exacta de rutas y hashes: 2.057 controles con etiqueta o acción, 595 conexiones
de acción definidas, 359 selectores distintos y 112 declaraciones de atajos.
Setenta tablas de localización en inglés y la definición de scripting aportan
declaraciones adicionales. Son observaciones estáticas de las interfaces
distribuidas, no mediciones de ejecución ni de rendimiento.

El registro de la interfaz del paquete original es
`ev_2d60c93b3784f4bfb6d28a5cc15692cd0fb15675c27a1cfc6668e48f34bd6941`.
El límite de 64 documentos del decodificador ha exigido una segunda pasada por
43 recursos idénticos byte a byte en un contenedor de análisis distinto y no
ejecutable, registrada como
`ev_fd593629b7968addfc22971fb12419e41ea7d64c12a65cff3ecea039ee8b0a05`.
Las dos pasadas no tienen rutas de documentos originales superpuestas ni
ausentes. El contenedor temporal se ha eliminado tras exportar las evidencias.

`PreferencesWindow.loctable` declara un mapeo específico del buzón de archivo,
y las preferencias compiladas conectan su selector. `ViewerPreferences.loctable`
declara mensajes relacionados, el orden del más reciente al más antiguo y el
comportamiento de lectura. `Mail.sdef` declara la caché de todos los mensajes
IMAP con o sin adjuntos. Estas declaraciones, por sí solas, no establecen el
comportamiento en ejecución. Las observaciones del código nativo que siguen
ofrecen una referencia más específica, todavía estática. Los servicios privados
de los proveedores y el comportamiento de los frameworks del sistema requieren
evidencias separadas. La cobertura de la interfaz no implica una reproducción
funcional completa ni compatibilidad.

## Carga de conversaciones en el código nativo

REA/Ghidra ha inspeccionado el ejecutable distribuido sin iniciar Mail ni leer
mensajes personales. La exportación completa de evidencias nativas contiene
17 registros; su SHA-256 es
`129707b63e9075725b31b680fb955e2ebbc60ea8a7c0c2ee9442932ca07ff412`.
Las direcciones canónicas y los identificadores de evidencia identifican los
procedimientos observados:

| Procedimiento | Observación estática | Evidencia REA |
| --- | --- | --- |
| `ConversationPrefetcher::initWithMessageListContentController:messagesTableView:` (`0x10008214c`) | Crea un `NSCache` llamado `ConversationPre-FetchCache` con un límite de 50 entradas y observa el desplazamiento. | `ev_fa7824691df165d433ae2ae6f0a8122afb53b8f7fd241172423490e3715cab0b` |
| `_prefetchVisibleConversations:` (`0x100082520`) | Resuelve las filas visibles de la tabla, utiliza los identificadores de conversación como claves de la caché e inicia la carga asíncrona de los miembros de las conversaciones ausentes. | `ev_2cc61803626bfcdcef5c971285210d249c1017f7d628b444ef26cdd9e268f011` |
| `_armTimerWithDelay:` (`0x1000823a8`) | Reinicia un temporizador pendiente; el retardo configurado es de 0,5 segundos y la tolerancia es la mitad del retardo. | `ev_70f9eed5ec18bb84493c275d867d41892580cf18d0baa9dffb452e9fc5d48de7` |
| Bloque de finalización de la precarga (`0x1000828f8`) | Comprueba que la entrada de la caché sigue existiendo y prepara como máximo siete miembros ordenados en torno a la posición inicial de lectura. | `ev_8f1d539fba64e142c477c3d076f362edef762d0484d118dbeaeb04ec15116773` |
| Bloque de preparación de los miembros (`0x1000829d0`) | Llama a `asyncLoadAllowingRemoteFetch:reloadBanners:completionHandler:` con los argumentos `false, true, nil`. | `ev_f24b1a6a24c5954202253a8128275fe78b4c58ad551bb642c4a7f461bdb7dbfd` |
| Bloque de expulsión de la caché (`0x100082ad4`) | Se ejecuta en el hilo principal y llama a `cancelLoad` para los miembros de la conversación. | `ev_a40b73b4d199efd1d2fcef64f7149bb5b6a1c4e1ebf7866712f832ba26e378fe` |
| `Conversation::asyncLoadConversationMembers` (`0x100077afc`) | Reutiliza los miembros cargados, hace seguimiento de los callbacks de finalización y los mensajes iniciales, y programa un tiempo límite de recuperación rápida de 0,25 segundos. | `ev_26327235dd05d4b42ab1697e8632e1bc9b26a71d35ce36c90857b5522506a57a` |
| `Conversation::_quickFetchTimeout` (`0x100077fbc`) | Publica los mensajes iniciales disponibles e invoca los callbacks en espera. | `ev_b89bc7b39845cf75858696637d657cd325dd9e8d08f1de0103ac8784e47e545c` |
| `ConversationMember::cancelLoad` (`0x10007c8c8`) | Cancela el generador de documentos y vacía el estado de carga. | `ev_73a8b31cd6c3cbb7ba0b6b9e78e715eee9630c23af9bb03d7964716191b09ccd` |

Estas observaciones respaldan la preparación asíncrona, la reutilización
acotada, la disponibilidad parcial de conversaciones y la cancelación como
referencias de diseño. No miden la latencia real. En particular, la llamada de
precarga observada desactiva `allowingRemoteFetch`; afirmar que descarga
anticipadamente los cuerpos remotos de los mensajes iría más allá de las
evidencias. No se han trazado la implementación MailUI llamada, el almacenamiento
duradero de mensajes, la planificación de conexiones con los proveedores ni la
semántica completa sin conexión. La conexión IMAP separada para los cuerpos y
la caché del lector de 16 entradas/4 MiB/cinco minutos de Gnosi son decisiones
de implementación independientes, no valores recuperados de Apple.

## Cobertura funcional

«Existente» describe el código fuente de Gnosi inspeccionado, no la equivalencia
con todas las operaciones de Apple. «Parcial» identifica una carencia concreta
pendiente del producto. El trabajo previsto no queda aceptado por superar las
regresiones del archivo o del lector.

| Ámbito de Apple Mail | Implementación de Gnosi y trabajo pendiente |
| --- | --- |
| Buzones, favoritos, apertura rápida y pestañas | Navegación unificada y por cuenta existente; se conserva el descubrimiento de carpetas personalizadas. El árbol completo de carpetas de cada cuenta, los favoritos y la apertura rápida de buzones siguen siendo parciales. |
| Archivar, mover, copiar y eliminar | Se han corregido las listas de Archivo/Todo el correo y el tratamiento de las etiquetas de archivo; hay acciones existentes de movimiento y papelera. La copia y el ciclo de vida completo de los buzones personalizados siguen siendo parciales. |
| Conversaciones y mensajes relacionados | Conversaciones de Gmail desplegables existentes; se han corregido la reutilización de los cuerpos y la cancelación. La reconstrucción genérica de IMAP a partir de References/In-Reply-To sigue siendo parcial. |
| Lector, cabeceras, fuente y apariencia | Lector existente de HTML saneado y texto, vista previa y temas. Las herramientas completas de fuente original y cabeceras y la apariencia de cada mensaje siguen siendo parciales. |
| Estado de lectura, marcas y prioridad | Acciones existentes de lectura y estrella; las operaciones en segundo plano dejan disponible el bucle de eventos. Las marcas de colores, las prioridades completas y los controles de estado de todos los mensajes siguen siendo parciales. |
| Búsqueda, ordenación y filtros | Se han corregido la búsqueda de texto completa en el proveedor y la paginación; hay una interfaz existente de ordenación y filtros. La composición avanzada de consultas en el servidor y el conjunto completo de metadatos de adjuntos siguen siendo parciales. |
| Buzones inteligentes y búsquedas guardadas | Vistas guardadas persistentes existentes con filtros AND/OR. Los criterios aún operan sobre las filas cargadas y no son un motor completo de consultas en el servidor. |
| Categorías y bandeja de entrada prioritaria | Categorías existentes. La categorización persistente de remitentes y las prioridades sensibles al tiempo siguen siendo parciales. |
| Compositor, destinatarios, alias y grupos | Editor, Para/Cc/Cco, identidades, autocompletado y alias existentes. Los controles completos de grupos y cabeceras de direcciones siguen siendo parciales. |
| Borradores, entrega, envío programado y deshacer | Borradores y entrega inmediata existentes. Aún hay que implementar una bandeja de salida duradera sin conexión, la programación y deshacer el envío. |
| Respuestas, reenvío y redirección | Respuesta, respuesta a todos y reenvío existentes con conservación de las imágenes CID citadas. La redirección y el reenvío como mensaje adjunto siguen siendo parciales. |
| Adjuntos y vistas previas | Descargas, vista previa de PDF, CID e imágenes remotas con restricciones existentes. Las acciones completas sobre adjuntos, el flujo de redimensionamiento de imágenes y un equivalente de Mail Drop siguen siendo parciales. |
| Texto enriquecido, fuentes y ortografía | Editor de texto enriquecido existente. El conjunto completo de conversiones entre texto plano y enriquecido por mensaje y de controles de ortografía y tipografía sigue siendo parcial. |
| Firmas | Firmas de identidad existentes. La paridad en la gestión de firmas sigue pendiente de verificación. |
| Sincronización, reconstrucción y cuota de buzones | Sincronización IMAP/IDLE y actualización explícita existentes. La reconciliación y reconstrucción completas, la cuota y la interfaz de mantenimiento de cuentas siguen siendo parciales. |
| Importación, exportación e impresión | Hay copias locales en Markdown/HTML. La importación y exportación de buzones, el intercambio EML/mbox, la impresión de correo y la exportación a PDF siguen siendo parciales. |
| Reglas de correo entrante y acciones | Las vistas guardadas configuran controles de visualización. Aún hay que implementar un evaluador persistente de reglas de correo entrante y las acciones de las reglas. |
| Cuentas, SMTP, TLS y autenticación | Google IMAP OAuth, IMAP/SMTP manual y Microsoft Graph existentes. No se reproducen POP ni todo el comportamiento de cuentas específico de Exchange. |
| Almacenamiento sin conexión y diagnóstico | Copias locales y cachés acotadas de listas y cuerpos existentes. Un buzón duradero completo sin conexión y un diagnóstico al estilo de Connection Doctor siguen siendo parciales. |
| Privacidad del contenido remoto | Entorno aislado, restricciones de URL/IP/tipo/tamaño/plazo y recuperación explícita de imágenes existentes. No es un relé de privacidad anonimizador. |
| Firma y cifrado | Hay protección TLS y de credenciales. No se reproducen la firma y el cifrado S/MIME ni el ciclo de vida de los certificados. |
| Correo no deseado, bloqueo, silencio y baja | Acciones existentes de correo no deseado. Los flujos persistentes de bloqueo, silencio y baja siguen siendo parciales. |
| Recordatorios, seguimiento y notificaciones | Posposición y extracción al calendario y los contactos de Gnosi existentes. El seguimiento completo y los controles de notificaciones y concentración específicos del correo siguen siendo parciales. |
| Extensiones e integración con el sistema | Integraciones y herramientas del agente de Gnosi existentes. No se reproducen las extensiones Apple MailKit ni los contratos de los servicios nativos. |
| Respuesta inteligente, vistas previas de enlaces y direcciones privadas | Asistencia opcional existente de IA para borradores y análisis. El comportamiento de direcciones privadas y vistas previas de enlaces ofrecido por los proveedores sigue siendo parcial. |
| Programación de ausencias | Aún no reproducida en el módulo de correo inspeccionado. |
| Accesibilidad y scripting | Infraestructura compartida de teclado y accesibilidad y API del agente existentes. El conjunto completo de atajos de Mail, objetos de scripting y comportamientos de los servicios de macOS sigue siendo parcial. |

## Límites de reproducción y validación

El defecto del archivo se ha reproducido sin credenciales: un servidor IMAP
ficticio con mensajes de Recibidos y archivados devolvía solo los de Recibidos
con `folder=all`. Un escenario separado ha reproducido notas locales archivadas
clasificadas como eliminadas. Los escenarios del lector han reproducido una
petición duplicada del cuerpo para una copia de Todo el correo de Gmail y el
reinicio de peticiones tras sustituciones inocuas del resumen o del callback.

La cobertura de regresión comprueba las conexiones independientes de los
cuerpos, la disponibilidad del bucle de eventos, los plazos de lectura y errores
del proveedor recuperables, la paginación completa entre varias carpetas, el
descubrimiento de buzones entre comillas o literales, el escapado de la búsqueda
y UTF-8, los metadatos de archivo de cada cuenta, los identificadores RFC
originales, la conservación de etiquetas, la identidad de los cuerpos, los
resultados obsoletos y el reintento.
Escenarios de regresión adicionales cubren la invalidación de credenciales
durante el inicio de sesión, el tratamiento separado de errores de transporte,
todas las carpetas de archivo, la ordenación por fecha de mensajes importados,
las lecturas incompletas de cabeceras nativas y la reutilización y el reinicio
de la caché de lotes con 2.001 mensajes. Un escenario separado de fallo de
conversación verifica HTTP 503 para los errores de transporte o de miembros
parciales y la lectura local de identificadores RFC guardados sin órdenes
remotas de UID. Una lista agregada en frío aún necesita todas las pequeñas
cabeceras coincidentes antes de la ordenación global; no es un índice duradero
completo de metadatos sin conexión.
Las pruebas de navegador de un solo uso ejercitan la paginación de Todo el
correo con 121 mensajes y de Archivo con 61 mensajes, con geometría real de
desplazamiento y búsqueda en los cuerpos por el proveedor. Estos resultados
validan esos escenarios, no los demás ámbitos funcionales de la tabla.
Una regresión adicional con dos cuentas reproduce cómo una cuenta no disponible
bloquea la paginación de la cuenta sana y cómo un reintento explícito descarta
las páginas de la cuenta sana. La paginación y el reintento aislados por cuenta son
necesarios para el buzón unificado.

## Secuencia de integración

La referencia describe un programa de producto considerable. Mantenga separada
la aceptación de cada grupo funcional para que las regresiones del lector no
puedan sustituir la compatibilidad completa con Mail:

1. Establecer lecturas ágiles, reintentos que reflejen el estado real,
   Archivo/Todo el correo completos y búsqueda en el proveedor. El candidato
   actual aborda esta base.
2. Añadir el árbol de buzones de cada cuenta y su ciclo de vida, la
   reconstrucción genérica de conversaciones IMAP, las herramientas de mensaje
   original y la reconciliación duradera sin conexión. Verificar la identidad
   entre cuentas y entre carpetas con escenarios de servidor sintéticos.
3. Añadir colas duraderas de entrega, envío programado y deshacer el envío,
   reglas de correo entrante y búsquedas guardadas avanzadas. Verificar la
   recuperación tras reiniciar y el comportamiento de proveedores fallidos
   antes de exponer estos controles.
4. Completar los grupos de compatibilidad individuales, incluida la importación,
   exportación e impresión, marcas más variadas, controles de remitentes,
   protocolos de cuentas, cifrado e integración con el sistema, con aceptación
   específica para cada proveedor y plataforma compatibles.

Cambiar la aplicación instalada requiere, además, un código fuente reconciliado
que contenga todos los commits registrados en el manifiesto de sus componentes,
el nuevo trabajo de correo y los demás cambios concurrentes aceptados. Superar
una comprobación en el worktree del código fuente, por sí solo, no establece
la aceptación de la versión instalada ni publicada.
