---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/domains/reader
  - backend/domains/literature
  - backend/domains/literature/review_logic.py
  - backend/domains/literature/connectors
  - backend/api/reader.py
  - backend/models/reader.py
  - backend/models/pdf_annotation.py
  - backend/api/vault_routes.py
  - backend/domains/vault/citations/exporting.py
  - backend/domains/vault/citations/normalizers
  - backend/api/literature_routes.py
  - backend/services/literature_models.py
  - backend/services/academic_connectors.py
  - backend/services/lookup_normalizers.py
  - backend/services/literature_service.py
  - backend/services/literature_review_service.py
  - backend/services/literature_import_service.py
  - backend/services/literature_ai_service.py
  - backend/services/references_io.py
  - backend/services/import_dedup.py
  - backend/services/audio_summarizer.py
  - frontend/src/features/reader
  - frontend/src/features/literature
  - frontend/src/features/literature/settings/ResourcesPluginConfig.tsx
  - frontend/src/features/reader/zotero/ZoteroReaderTab.ts
tests:
  - backend/tests/test_reader_analysis_domain.py
  - backend/tests/test_pr6_domain_facades.py
  - backend/tests/test_vault_export_domain_contract.py
  - backend/tests/test_citation_key_and_pubmed.py
  - backend/tests/test_references_io.py
  - backend/tests/test_import_dedup.py
  - backend/tests/test_llm_wiki_pdf_annotations.py
  - backend/tests/test_e2e_import_references_item_type.py
  - backend/tests/test_literature_models.py
  - backend/tests/test_academic_connectors.py
  - backend/tests/test_academic_connectors_domain_contract.py
  - backend/tests/test_lookup_normalizers.py
  - backend/tests/test_html_meta_attr_order.py
  - backend/tests/test_literature_service.py
  - backend/tests/test_literature_import_service.py
  - backend/tests/test_literature_review_service.py
  - frontend/src/features/reader/ReaderDashboard.test.tsx
  - frontend/src/features/reader/public-entry.test.ts
  - frontend/src/features/literature/LiteraturePage.test.tsx
  - frontend/src/features/literature/public-entry.test.ts
  - frontend/src/features/literature/settings/ResourcesPluginConfig.test.tsx
---

# Lector, referencias y citas

Los dominios del frontend `features/reader/` y `features/literature/`,
estrictamente tipados, gestionan sus respectivas páginas, componentes locales,
estado y pruebas. Cada uno expone una entrada pública de carga diferida para
cargar de forma independiente la lectura de feeds y la búsqueda bibliográfica.
Los estilos de Literatura conservan su orden de cascada dentro de la feature.
Los adaptadores compartidos de peticiones, la integración Zotero, la configuración
de proveedores y el renderizado de citas no se duplican en estos dominios.

Las rutas, el almacenamiento, el análisis y las fuentes del Reader viven ahora
en `backend/domains/reader/`; los repositorios, la búsqueda, la sincronización y
el almacenamiento bibliográfico, en `backend/domains/literature/`. Los módulos
anteriores permanecen como fachadas compatibles.

El análisis del Reader dependiente del vault, el acceso a resultados, la
reanudación, la cancelación, la recuperación de contenido de artículos y la
generación de pódcast pasan por un único control de vault activo. Si falta el
contexto, se devuelve una respuesta recuperable de servicio no disponible antes
de crear trabajos o hilos; las rutas válidas del vault y los payloads existentes
no cambian. La generación de pódcast consume directamente el generador canónico
tipado de sesiones de base de datos y lo cierra en el bloque `finally` existente;
no hay conversiones de tipos ni factorías de sesiones duplicadas entre la
orquestación del Reader y la persistencia.

Las rutas HTTP, los modelos canónicos y los servicios de revisión sistemática
están tipados estrictamente. El recuento PRISMA, las transiciones de cribado, la
evidencia de acceso abierto y las exportaciones CSV/JSON/Markdown/SVG viven en
el dominio puro `review_logic.py`; las funciones históricas siguen como fachadas.

## Responsabilidad

Este dominio combina la lectura de feeds y boletines con un gestor de referencias compatible con Zotero, renderizado de citas CSL, importación por identificador o desde la web, lectura de PDF/EPUB y anotaciones que pueden convertirse en evidencia citable.

## Ingesta de referencias

Crossref, Open Library, arXiv, PubMed y los metadatos HTML tienen normalizadores
tipados separados en `backend/domains/vault/citations/normalizers/`. Conservan
los payloads canónicos de Zotero y el comportamiento de función pura, mientras
`backend/services/lookup_normalizers.py` sigue siendo la fachada compatible.

Las referencias se incorporan mediante DOI, ISBN, arXiv, PMID, BibTeX, RIS, archivos o URL web. Los resolutores de identificadores y el servidor de traducción de Zotero producen metadatos específicos del proveedor. Los normalizadores los mapean al esquema de referencias configurado, generan una clave de cita estable, deduplican candidatos y escriben un registro del vault.

`backend/services/references_io.py` es el límite tipado y determinista de
BibTeX/RIS. Sus pequeños ayudantes de análisis, normalización, mapeo de campos y
serialización preservan el orden, el escape, la resolución del tipo y el contrato
público de importación/exportación, sin persistencia ni red ocultas.
El deduplicador puro de importaciones utiliza estructuras explícitas de metadatos
e índices de identificadores; conserva la prioridad clave de cita, DOI, ISBN y
título normalizado. Las entradas creadas antes en la misma importación se añaden
de forma idempotente a esos mismos índices. Las entradas del catálogo CSL y el
mapeador declarativo de Zotero a Recursos exponen contratos serializables
explícitos y conservan los campos adicionales arbitrarios del proveedor en la
frontera JSON externa. Los resaltados de citas gestionados de Brain utilizan el
mapeo tipado de SQLAlchemy; la única excepción sin tipado está localizada en el
adaptador opcional `pypdfium2`, que no publica un marcador `py.typed`.

La orquestación de consulta, que es solo de lectura, reside en el dominio de citas,
mantiene la prioridad DOI → arXiv → PMID → ISBN → URL y hace pasar las URL del
usuario por el descargador protegido contra SSRF antes de sugerir cualquier campo.
La tabla de Recursos designada se lee desde una única configuración canónica;
solo los vaults heredados que nunca se hayan configurado pueden adoptar
automáticamente la primera tabla con Citation Key, bajo el mismo bloqueo que Ajustes.

Translation-server es un sidecar opcional. La ejecución nativa puede funcionar sin él; los resolutores específicos de identificadores y las referencias existentes siguen funcionando. Los fallos de traducción web devuelven errores que permiten actuar, no un registro vacío presentado como correcto.

`citations/pdf_fallback.py` deriva un registro citable de los metadatos PDF cuando
falla la resolución de identificadores. `citations/web_capture.py` selecciona y
mapea resultados Zotero, y `platform/translation_server.py` gestiona el transporte HTTP.

## Descubrimiento académico federado

El plugin integrado de Recursos gestiona la configuración de repositorios, mientras `/api/vault/reference-table` sigue siendo la única fuente de verdad de la tabla de Recursos de destino. `/literature` ejecuta cada conector seleccionado de forma independiente y transmite resultados parciales; los límites de cuota y los fallos de proveedor se atribuyen a su fuente sin descartar los resultados válidos de las demás.

`backend/domains/literature/connectors/` gestiona el transporte HTTPS acotado,
la auditoría de solicitudes, la normalización canónica, OAI-PMH y JSON
personalizado, los grafos de citas y los adaptadores por familia de proveedores.
`backend/services/academic_connectors.py` es solo una fachada de compatibilidad.
El puerto tipado resuelve los colaboradores de la fachada en cada llamada para
que pruebas e integraciones puedan sustituir transporte, validación, parsers y
dispatch sin duplicar estado mutable.

`AcademicWork` es el contrato canónico de los conectores. Las fusiones deterministas utilizan, por orden, DOI normalizado, PMID o PMCID, identificador arXiv sin versión, ISBN-13 y título normalizado junto con el año y el apellido del primer autor. Una coincidencia aproximada de títulos solo genera un aviso. Los trabajos fusionados conservan cada aparición en las fuentes, las ubicaciones de acceso abierto, los recuentos de citas de cada proveedor, la procedencia de campos y las variantes en conflicto.

La vista previa es de solo lectura. Adjuntar el texto completo es una acción manual independiente, ofrecida únicamente para ubicaciones de acceso abierto verificadas. La importación convierte el trabajo fusionado mediante el mapeador compartido de Recursos compatible con Zotero y repite la comprobación de identidad dentro de un bloqueo atómico. Si ya existe un registro de Recursos coincidente, la API lo devuelve en lugar de crear un duplicado.

El adaptador de importación restringe todos los objetos anidados del proveedor
—publicación, identificadores, fechas, ubicaciones de acceso abierto y campos
adicionales de Zotero— mediante un único límite de mapeo antes de convertirlos.
Los payloads de autores siguen siendo intencionalmente heterogéneos solo en el
punto de integración con Zotero; las claves deterministas de trabajos, la inyección
de claves de cita, la pertenencia a cuadernos y la reutilización de duplicados
conservan su comportamiento.

## Revisiones bibliográficas

El estado de las revisiones sistemáticas se almacena en cuatro tablas del vault gestionadas de forma idempotente: `Literature Reviews`, `Literature Activities`, `Literature Candidates` y `Literature Decisions`, esta última solo admite adiciones. Las estrategias de búsqueda, las consultas exactas a proveedores, los errores parciales, las operaciones de IA, las decisiones de cribado y las exportaciones siguen siendo auditables y se sincronizan con el vault principal.

El cribado por un único revisor y el cribado ciego con dos revisores comparten el mismo modelo de fases. En modo ciego, la decisión de cada revisor se oculta hasta que ambos la envían; los conflictos pasan a un consenso explícito. La IA puede proponer consultas editables, reordenar, cribar o sintetizar los metadatos recuperados, pero no puede excluir candidatos ni atribuir evidencia más allá del título, resumen o texto completo realmente proporcionados.
La alternativa basada en solapamiento de tokens y el reordenador opcional con
embeddings locales utilizan la misma estructura tipada de clasificación,
conservando la puntuación y el orden por posición original en ambas implementaciones.

Los índices OAI y el estado temporal de búsqueda pueden reconstruirse y residen bajo `LOCAL_DATA`; los protocolos, historiales, candidatos, decisiones y artefactos de auditoría permanecen en el vault principal. Las credenciales de repositorios utilizan el Keychain nativo o el entorno de despliegue y nunca se escriben en el vault ni en el estado de plugins.
Las filas OAI filtradas conservan la lista canónica tipada de trabajos del conector
sin conversiones de tipos posteriores. El OCR opcional de PDF y el análisis de
EPUB limitan sus únicas excepciones de tipado a los imports concretos de
`pypdfium2` y `ebooklib`, cuyos paquetes no publican `py.typed`; los objetos dinámicos
no salen del adaptador de documentos.

## Ruta de citación

```mermaid
flowchart LR
    Record["Página de referencia"] --> CSL["Normalización de elementos CSL"]
    CSL --> Citeproc["Motor citeproc + estilo seleccionado"]
    Citeproc --> Text["Citación en texto"]
    Citeproc --> Bibliography["Bibliografía"]
    Annotation["Anotación PDF"] --> Evidence["Cita/evidencia persistente"]
    Evidence --> Record
```

Los valores CSL se derivan del frontmatter de las referencias mediante mapeos de campos explícitos. Las listas de nombres, fechas, tipos de elementos, escapes de BibTeX/LaTeX y metadatos `extra` de Zotero requieren normalización. El esquema fijado protege los tipos y campos compatibles frente a cambios del proyecto de origen.

`backend/domains/vault/citations/exporting.py` gestiona la limpieza del Markdown,
el subconjunto de citas, los marcadores de bibliografía, la ejecución de Pandoc
y el empaquetado de la descarga. La ruta de compatibilidad conserva su firma
pública e inyecta los puertos de archivos, CSL y procesos.

## Lector y anotaciones

El lector Zotero incluido muestra contenido PDF y EPUB. Gnosi posee el puente que localiza archivos, sirve rangos de bytes seguros, recibe anotaciones y enlaza la evidencia seleccionada de nuevo a registros de Vault. Las filas de anotación incluyen URI de origen, página, tipo, geometría, texto, comentario, etiquetas, clave administrada estable y marcas de tiempo.

Los endpoints de archivos validan el confinamiento de rutas y gestionan la hidratación de archivos en la nube. Los identificadores persistentes de anotaciones evitan duplicar una cita generada cada vez que se reabre un documento.

## Fuentes y boletines informativos

Los modelos del Reader almacenan fuentes, artículos, estado de lectura, contenido completo extraído y una cuenta de boletines. La ingesta de feeds utiliza savepoints de transacción para que una entrada malformada no revierta todo el lote. Los extractos y la extracción del texto completo son procesos separados; truncar durante la ingesta no debe descartar permanentemente contenido recuperable de la fuente.

## Invariantes

- Las claves de citación permanecen estables a menos que el usuario cambie explícitamente los datos de identidad.
- La importación se deduplica mediante identificadores autoritativos y metadatos normalizados.
- Un fallo de fuente federada no puede invalidar los resultados ya devueltos por otras fuentes.
- La similitud difusa nunca fusiona las obras académicas automáticamente.
- Las métricas de citas permanecen separadas por proveedor y nunca se suman.
- Las sugerencias de IA nunca se convierten en decisiones finales de cribado sin una acción humana.
- Las rutas de archivos del lector no pueden escapar de las raíces permitidas.
- La identidad del documento y la geometría de página de una anotación sobreviven a los reinicios.
- El código interno del lector incluido como dependencia se considera código del
  proyecto de origen; las modificaciones locales de integración son explícitas y reproducibles.
- Las contraseñas de configuraciones heredadas de boletines se tratan como secretos
  incluso si un modelo antiguo sigue exponiendo un campo de compatibilidad.

## Enfoque de verificación

Ejecute las pruebas de claves de cita, PubMed, tipos de elementos, estilos CSL, escapes BibTeX, entrada y salida de referencias, anotaciones, confinamiento de rutas, deduplicación de importaciones y savepoints de feeds. Añada pruebas de normalización de conectores, tokens y marcas de eliminación OAI, SSRF/XML, errores parciales, ocultación de decisiones entre revisores, importación concurrente y recuentos PRISMA. La validación en el navegador debe abrir un documento de prueba real y completar un ciclo de creación y lectura de una cita o anotación; después debe realizar una búsqueda bibliográfica progresiva, inspeccionar la procedencia e importar un resultado deduplicado.
