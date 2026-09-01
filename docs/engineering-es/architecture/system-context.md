---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/server.py
  - frontend/src/app/App.tsx
  - frontend/src/app/routes.tsx
  - frontend/src/app/bootstrap.tsx
  - frontend/src/app/AppProviders.tsx
  - frontend/src/app/navigation
  - frontend/src/app/integration
  - frontend/src/shared/ui
  - frontend/src/shared/hooks
  - frontend/src/features
  - frontend/src/shared/auth
  - frontend/src/shared/routing
  - frontend/src/generated
  - frontend/src/app/main.tsx
  - frontend/src/app/styles/index.css
  - frontend/feature-public-entries.json
  - frontend/vite.config.js
  - docker-compose.yml
  - desktop/main.js
tests:
  - backend/tests
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Contexto del sistema

## Vista de contenedores

```mermaid
flowchart LR
    User["Usuario o miembro del equipo"] --> UI["Frontend React y Vite"]
    UI -->|HTTP /api and WebSocket| API["Backend FastAPI"]
    API --> Vault["Vault Markdown y recursos"]
    API --> Local["SQLite, índices, cachés y secretos exclusivamente locales"]
    API --> MCP["Servidores MCP y proveedores de IA"]
    API --> Comms["Proveedores de correo, calendarios y contactos"]
    API --> Zotero["Servidor de traducción de Zotero"]
    API --> Publish["Notion, Drupal y servicios de redes sociales"]
    Desktop["Shell de escritorio Electron"] --> UI
    Desktop --> API
    Office["Complementos de oficina y clipper web"] --> API
```

## Límite del frontend

El frontend es una aplicación React de una sola página. `app/App.tsx` gestiona
la autenticación y el shell global; `app/routes.tsx` compone rutas, ámbito del
Vault, redirecciones y carga diferida de páginas, mientras Home se carga al inicio.
`app/bootstrap.tsx` prepara el enrutamiento y el idioma;
`app/AppProviders.tsx` conserva el orden StrictMode → API → router → autenticación.
El traslado sitúa la entrada CSS y la llamada a bootstrap en `app/main.tsx`,
con estilos ordenados en `app/styles/index.css`. Vite actúa como proxy de `/api`
y WebSocket durante el desarrollo nativo.

### Organización de los módulos

El traslado revisado asigna composición, navegación e integración global a
`app/`; dominios de producto a `features/`; infraestructura, UI, registros,
enrutamiento y adaptadores API reutilizables a `shared/`; y contratos generados
a `generated/`. Los contratos generados se regeneran, nunca se editan a mano.
El proveedor de autenticación pertenece a `features/auth/context/AuthProvider.tsx`
y su contexto reutilizable a `shared/auth/auth-context.ts`.

El manifiesto `frontend/feature-public-entries.json` recoge rutas
públicas exactas revisadas y sus motivos. Las entradas `index` de la raíz de
cada feature siguen admitidas; un módulo vecino no listado sigue siendo privado.
Los consumidores acceden directamente a una entrada raíz o explícitamente
revisada, incluidos imports diferidos separados, sin introducir un agregador de
carga inmediata. El manifiesto describe el acceso; no importa módulos.

Las dependencias pueden ir de `app` hacia las features y la infraestructura
compartida. Las features no dependen de `app`; `shared` no depende de features
ni de `app`, tampoco en imports solo de tipos. Trasladar la previsualización
Markdown/wikilink a la infraestructura compartida no resuelve su ciclo interno.
El traslado debe conservar carga diferida, estilos, rutas y payloads; la
estructura por sí sola no acredita una integración ni una release completas.

Los componentes llaman al backend mediante adaptadores API tipados en `shared/api/`.
El backend sigue autorizando usuarios, workspaces, vaults y operaciones destructivas.

## Límite del backend

`backend/server.py` crea la aplicación FastAPI y registra los routers de dominio. Los módulos de rutas convierten los contratos HTTP en llamadas a servicios. La lógica de negocio reside en `backend/services/`; las entidades relacionales persistidas, en `backend/models/`; la orquestación de IA, en `backend/agent/`; y el trabajo programado, en `backend/scheduler/` y las habilidades de ejecución.

El ciclo de vida de la aplicación inicia la infraestructura compartida, construye las capacidades del agente, precarga los índices que pueden prepararse de forma segura e inicia los workers IDLE de correo; al finalizar, cierra esos recursos. El arranque de las integraciones opcionales está aislado para que la indisponibilidad de un proveedor no aborte todo el servidor.

## Límites de almacenamiento

El vault y los datos locales tienen deliberadamente propiedades distintas de durabilidad y sincronización:

- Vault: contenido portátil del usuario; puede residir en un disco local o en un
  proveedor de archivos respaldado por la nube.
- Datos locales: SQLite, índices, cachés, secretos, registros, puntos de control y salidas;
  nunca se sincronizan con la nube.
- Configuración: combina valores predeterminados de la aplicación, parámetros del usuario o del vault,
  valores sobrescritos por el entorno y almacenes locales de credenciales.

Consulte [datos y almacenamiento](data-and-storage.md) para conocer las responsabilidades y las reglas de reconstrucción.

## Sistemas externos

Todos los servicios externos son dependencias opcionales de dominio. OAuth y credenciales se gestionan localmente. Los adaptadores normalizan el comportamiento específico del proveedor para Google, Microsoft, IMAP/SMTP, CalDAV, Notion, Drupal, proveedores de IA, redes sociales, proveedores de archivos y traducción Zotero.

## Navegación hasta la implementación

- [Catálogo API](../generated/api-catalog.md)
- [Catálogo del frontend](../generated/frontend-catalog.md)
- [Catálogo de módulos del backend](../generated/backend-modules.md)
- [Catálogo de configuración](../generated/configuration.md)
