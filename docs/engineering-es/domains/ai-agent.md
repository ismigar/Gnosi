---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/domains/configuration/llm_wiki.py
  - backend/domains/llm_wiki
  - backend/services/llm_wiki_lint.py
  - backend/services/llm_wiki_pdf_annotations.py
  - backend/domains/agent
  - backend/domains/configuration/agent
  - backend/domains/configuration/ai
  - backend/agent
  - backend/agent/memory.py
  - backend/api/agent_routes.py
  - backend/api/agent_skills_routes.py
  - backend/api/ai_routes.py
  - backend/api/tools_routes.py
  - backend/services/artificial_analysis.py
  - frontend/src/components/AgentChat.jsx
  - frontend/src/components/AI
tests:
  - backend/tests/test_llm_wiki_extraction_domains.py
  - backend/tests/test_llm_wiki_lint.py
  - backend/tests/test_llm_wiki_pdf_annotations.py
  - backend/tests/test_llm_wiki_processing_domain_contract.py
  - backend/tests/test_llm_wiki_configuration_domain_contract.py
  - backend/tests/test_artificial_analysis.py
  - backend/tests/test_agent_chat_safety.py
  - backend/tests/test_pr6_agent_remaining_contract.py
  - backend/tests/test_agent_skill_runtime.py
  - backend/tests/test_generated_tool_validator.py
  - backend/tests/test_ai_model_registry_api.py
  - backend/tests/test_ai_content_routes.py
  - backend/tests/test_provider_delete.py
  - backend/tests/test_mcp_tool_routing_cache.py
  - backend/tests/test_agent_action_confirmations.py
  - backend/tests/test_agent_legacy_memory.py
  - tests/e2e/tests/e2e/ai-chat.spec.ts
---

# Agentes de IA, modelos, herramientas y habilidades

## Modelo de capacidad

Gnosi separa modelos, agentes, habilidades y herramientas:

- Modelo: una ruta del proveedor con capacidades, límites, metadatos de costo, fiabilidad,
y credenciales.
- Agente: instrucciones, selección de modelos, política de memoria/punto de verificación y asignación
habilidades.
- Habilidad: un paquete de capacidades documentado que aporta instrucciones y
limita las herramientas compatibles.
- Herramienta: operación callable clasificada por efecto y origen.
- Fuente contextual: Vault, tabla, archivo o material externo seleccionado por el usuario añadido
a una conversación con contención explícita y comportamiento de tamaño.

El feed de Artificial Analysis es una frontera tipada del servidor. Mantiene
privadas las credenciales, valida todas las páginas, completa solo metadatos
ausentes, conserva métricas verificadas de la caché y recurre a una copia
antigua o a models.dev con procedencia explícita cuando el servicio falla.

## Flujo de inicio y solicitud

```mermaid
sequenceDiagram
    participant Start as App lifespan
    participant MCP as MCP clients
    participant Catalog as Skill and tool catalog
    participant Graph as LangGraph workflow
    participant Chat as Chat endpoint
    participant Model as Selected model
    Start->>MCP: Connect and discover tools
    Start->>Catalog: Reconcile built-in, user, generated, and plugin entries
    Catalog->>Graph: Build allowed capability set
    Chat->>Graph: Message, agent, session, attachments, context
    Graph->>Model: Route prompt/tool cycle
    Graph->>Catalog: Validate tool effect and confirmation
    Graph-->>Chat: Ordered events and final response
```

Las importaciones históricas de Agent siguen disponibles mediante fachadas de
compatibilidad estrechas, mientras que el paquete de dominio gestiona el
contexto, las herramientas propias, la evidencia y las citas, el estado del
flujo, las confirmaciones, las sesiones y las rutas. El catálogo y la gobernanza
de agentes siguen el mismo patrón en el dominio de configuración, sin cambiar
el orden de las rutas ni los identificadores de operación.

El router de modelo resuelve combinaciones de proveedores/modelos, límites de contexto, soporte de herramientas, límites de gasto y política de reserva. Las credenciales se obtienen de la migración de entornos de almacenamiento secreto local o soportado, no expuesta a la interfaz. Las razones de fallo se registran por separado de las respuestas orientadas al usuario para que los operadores puedan distinguir el tiempo de espera, el rechazo del proveedor, las credenciales inválidas, el desbordamiento de contexto y la incompatibilidad de la herramienta.

El cliente MCP por stdio valida los límites de objetos JSON-RPC, tipa
explícitamente las peticiones asíncronas pendientes y dirige las herramientas
mediante una caché que solo se actualiza cuando falla una búsqueda. Los catálogos
malformados fallan localmente sin propagar valores no validados al runtime.

La configuración de IA mantiene credenciales, marcas de desconexión, registro
de modelos, presupuesto y uso en una fachada de compatibilidad estrictamente
tipada. La generación y corrección del editor viven en el dominio de
configuración AI, mientras que la carga YAML validada y las respuestas legacy
explícitas preservan exactamente los contratos HTTP y OpenAPI existentes.

## Gobernanza de los instrumentos

Los descriptores de herramientas declaran efectos leed/write/external/destructive. Las herramientas generadas pasan la validación basada en AST y se ejecutan en un entorno restringido. El validador bloquea capacidades peligrosas como escrituras de archivos sin restricciones, acceso al entorno, traversal de dunder dinámico e importaciones inseguras.

Las acciones que requieren confirmación crean registros pendientes duraderos. La confirmación vincula al usuario, la sesión, la herramienta, los argumentos, el efecto y la caducidad; aceptar una acción rancio o alterado no autoriza una invocación diferente. El mantenimiento expira y elimina los registros independientemente del tráfico de chat.

## Habilidades y complementos

Las habilidades de ejecución incorporadas viven en `pipeline/skills/`. Los paquetes de usuario y plugin se validan en un catálogo mientras se preserva el origen, activación, compatibilidad y campos gestionados contra usuarios. La reconciliación de plugins es idempotente: desactivar un plugin suspende su contribución administrada sin eliminar las sobreposiciones de usuario.

La fachada legacy de memoria Chroma sigue siendo perezosa y estrictamente
tipada para compatibilidad de importación. Importarla solo crea el directorio
configurado y no carga modelos de embeddings. Sin embeddings, las lecturas son
vacías y las escrituras fallan explícitamente; la memoria personal canónica
sigue en el servicio SQLite gobernado y acotado del dominio Agent.

## Contexto y memoria

El estado de conversación está visionado por agente y sesión. El pedido de mensajes de interfaz de usuario utiliza identificadores estables en lugar de solo la hora de llegada. Los adjuntos y fuentes de contexto validan rutas, tamaño, tipo de archivo y ámbito de trabajo/vault.

La navegación del Vault aporta contexto de página, tabla y vista activa solo para
el turno actual. El servidor amplía un dashboard con una única vista incrustada a
la vista canónica de la tabla, reaplica sus filtros y ordenación y expone una
consulta exacta y acotada con recuento y paginación. Las lecturas exactas de
página y tabla son llamadas de herramienta creadas por el servidor; después de
un resultado completo, la síntesis se ejecuta sin herramientas para que un
modelo insistente no repita la llamada hasta el límite de recursión del grafo.

Los demás turnos de solo lectura tienen un presupuesto independiente de tres
resultados: si el modelo continúa solicitando herramientas, la siguiente
invocación de Cerebro recibe las evidencias acumuladas sin herramientas
vinculadas y debe sintetizar la respuesta. Así, el límite de recursión del
grafo sigue siendo una red de seguridad final y no un control normal del flujo.

El chat mide cada respuesta desde el envío de la petición hasta el final del
flujo. Un contador en vivo de segundos enteros se sustituye por el tiempo
transcurrido guardado en la respuesta completada. Cada mensaje visible también
permite rebobinar la conversación: tras confirmarlo, el servidor recorta el
checkpoint canónico del ámbito en el límite completo del turno y devuelve su
proyección pública. El rebobinado solo cambia la memoria de conversación;
nunca se presenta como si hubiera revertido confirmaciones completadas o
efectos externos.

Los registros editables de modelos se hidratan desde el catálogo canónico antes
de llegar a Configuración o al enrutamiento de ejecución. Las actualizaciones
parciales de presupuesto y configuración se fusionan con las capacidades, la
ventana de contexto, el coste y la calidad existentes. Los cambios de proveedor
o modelo invalidan los grafos en memoria para que el soporte de herramientas y
las credenciales surtan efecto en el turno siguiente. La cabecera del chat
muestra el modelo seleccionado, el número exacto de herramientas y motivos
accionables para cualquier degradación.

## Configuración de LLM Wiki

`backend/domains/configuration/llm_wiki.py` valida la tabla Brain, las fuentes,
las dimensiones categóricas, los campos de archivo/URL, los valores fijos y las
relaciones antes de modificar el esquema. Después crea roles y relaciones
canónicos, revalida los campos de índice, guarda atómicamente y actualiza las
páginas del sistema.
`backend/domains/configuration/llm_wiki_schema.py` gestiona por separado la
reparación idempotente de los campos Brain y la consolidación de una relación
canónica por fuente, incluidos alias, metadatos de página y vistas contextuales.
`backend/domains/configuration/llm_wiki_records.py` normaliza las notas
gestionadas existentes, las etiquetas de fuente y los títulos localizados de índices.
La extracción se divide entre `backend/domains/llm_wiki/documents.py`, con los
adaptadores tipados de documentos y multimedia, y `origins.py`, que conserva la
identidad, la deduplicación y los fragmentos deterministas. El servicio histórico
permanece como fachada compacta de compatibilidad.
El procesamiento se divide además en `planning.py` para prompts, análisis y
planes fundamentados, `dimensions.py` para el mapeo fijo/de fuente/por IA,
`ingestion.py` para el flujo bloqueante, y `writing.py` para la persistencia
idempotente de notas de lectura.
`index_rendering.py` gestiona las páginas de índice de recurso, dimensión y
general, mientras `search_index.py` gestiona los índices reconstruibles JSON,
FTS5 y vectoriales. `backend/services/llm_wiki.py` y `llm_wiki_indices.py`
siguen siendo fachadas de compatibilidad con resolución tardía para conservar
importaciones y puntos de sustitución de plugins y pruebas.

El lint determinista del Brain separa comprobaciones acotadas de notas
huérfanas, revisiones antiguas, referencias ausentes, claves duplicadas, citas
rotas, reprocesamiento y deriva de índices. Mantiene el formato del informe sin
necesitar un proveedor de modelos.

Las citas PDF fundamentadas tienen una frontera de persistencia determinista.
La geometría se resuelve reutilizando un documento por adjunto, los resaltados
gestionados se actualizan en una transacción, se conservan las anotaciones
manuales y solo se eliminan entradas obsoletas gestionadas por Gnosi.

## Fallo y invariantes de seguridad

- Fallo del proveedor no se dirige silenciosamente a un más caro o menos privado
modelo fuera de la política configurada.
- Una herramienta no disponible para el modelo/skill seleccionado no puede ser invocada por nombre
Solo.
- Los efectos destructivos o externos requieren su política declarada.
- El código generado no puede acceder a secretos ni al estado ilimitado del sistema de archivos.
- Un servidor MCP fallido no elimina servidores saludables del catálogo.
- El resultado parcial del modelo no se presenta como una acción confirmada completa.
- Los mensajes de agente permanecen aislados por agente y sesión a través de las recargas.

## Enfoque de verificación

Ejecute enrutamiento de modelos, eliminación de proveedores, fiabilidad, tiempos de espera, reintento y resiliencia MCP, catálogo de habilidades/tiempo de ejecución/API, validación de herramientas generadas, contención de contexto, carrera de confirmación/expiración, pedidos de chat y flujos de chat del navegador.
