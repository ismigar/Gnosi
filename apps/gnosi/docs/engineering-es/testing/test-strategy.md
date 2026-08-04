---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/tests
  - frontend/src
  - e2e
  - requirements.txt
  - frontend/package.json
tests: []
---

# Estrategia de ensayo

## Capas de calidad

```mermaid
flowchart TB
    Static["Comprobaciones estáticas\nSintaxis de Python, ESLint, i18n"] --> Unit["Pruebas de unidad\nnormalizadores, políticas, algoritmos"]
    Unit --> Integration["Pruebas de integración\nroutes, almacenamiento, adaptadores"]
    Integration --> E2E["Navegador de reproducción y servicios de ejecución"]
    E2E --> Visual["Inspecciones visuales y instantáneas de regresión"]
    Integration --> Deploy["Pruebas de humo de contenedores y embalajes"]
```

Una compilación de frontend captura importaciones y sintaxis pero no una interacción rota. Una prueba de unidad de ruta no prueba la integración del navegador. Una captura de pantalla no prueba persistencia o autorización.

## Ensayos de motor

Pytest cubre servicios, dependencias de rutas, normalización, almacenamiento, seguridad, concurrencia y casos de regresión. Las pruebas utilizan directorios de almacén temporal y de datos locales. Los proveedores externos son anodados a menos que una prueba esté marcada explícitamente como live/E2E.

Las suites importantes incluyen:

- Auth, PAT, bootstrap de espacio de trabajo, roles y superficies públicas.
- Contención de caminos, escrituras seguras, Etags, razas, registro y comportamiento de sidecar.
- Fórmulas, rollups, filtros mecanografiados, relaciones, planificación y programación.
- Enviar MIME/CID, contactos fusionar/vCard, contención de calendario y recordatorios.
- Enrutamiento de IA, habilidades, resiliencia MCP, confirmaciones y herramientas generadas.
- Complementos, importaciones, citas, normalización de lectores, XSS y SSRF.

## Ensayos de la interfaz

Vitest cubre componentes, ganchos, registros, formatos de utilidades, lógica de vista tecleada y comportamiento de estado. ESLint y la producción Vite build son obligatorios. `check:i18n` verifica que las claves referenciadas orientadas al usuario existen en cada localización.

La compilación debe terminar con cero errores. Las advertencias existentes no son permiso para añadir nuevas advertencias sin revisión.

## Pruebas visuales y de extremo a extremo

Playwright se ejecuta como un proyecto a nivel de host contra la aplicación nativa. Una configuración anónima cubre el arranque y el comportamiento público; la configuración autenticada cubre la funcionalidad del espacio de trabajo.

Las instantáneas visuales cubren páginas de escritorio y móviles representativas. Para un cambio de interfaz de usuario, inspeccione la página real renderizada, haga clic en el control cambiado, vea la consola y tome una captura de pantalla. Confirme que los modos, superposiciones, tostadas y menús utilizan el sistema registrado de índice z y no atrapan la interacción.

## Ensayos de despliegue

Docker CI construye imágenes de backend y frontend, valida Composi, y ejerce el punto final de salud con almacenamiento local. Elecron release CI posee un paquete multiplataforma; una compilación local de macOS no puede validar artefactos de Windows y Linux.

## Mapeo de cambio a ensayo

| Cambio | Pruebas mínimas |
| --- | --- |
| Documentación revisada pura | Verificación del generador, validador, construcción de documentos estrictos, humo de documentos del navegador. |
| Lógica de catálogo generada | Pruebas de unidades generadoras, determinismo de dos carreras, validador, construcción de documentos estrictos. |
| Comportamiento del motor | Regresión de pisteles estrecha más suite de integración afectada. |
| Comportamiento de la interfaz | Vitest cuando sea posible, comprobación i18n, producción, acción del navegador y captura de pantalla. |
| Auth/seguridad/comportamiento de la ruta | Pruebas negativas e intentos de alcance cruzado, no sólo el camino dorado. |
| Despliegue/dependencia | Verificación nativa más Docker o paquete CI según proceda. |

## Catálogo de pruebas

Los generados [catálogo de pruebas](../generated/tests.md) lista archivos de prueba y señales de navegación. La colección Runner sigue siendo autorizada para los recuentos de pruebas ejecutables.
