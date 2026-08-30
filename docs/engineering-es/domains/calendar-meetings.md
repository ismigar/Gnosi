---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/api/calendar_routes.py
  - backend/domains/calendar/geocoding.py
  - backend/api/meeting_routes.py
  - backend/models/calendar.py
  - backend/services/google_calendar_service.py
  - backend/services/hybrid_calendar_service.py
  - frontend/src/features/calendar
  - frontend/src/features/meetings
tests:
  - backend/tests/test_calendar_geocoding_domain.py
  - backend/tests/test_hybrid_calendar_service.py
  - backend/tests/test_calendar_path_containment.py
  - backend/tests/test_meeting_reminders_race.py
  - tests/e2e/tests/e2e/calendar.spec.ts
  - frontend/src/features/meetings/MeetingControls.test.tsx
  - frontend/src/features/meetings/public-entry.test.ts
  - frontend/src/features/calendar/page/CalendarPage.test.tsx
  - frontend/src/features/calendar/public-entry.test.ts
---

# Calendario y reuniones

## Responsabilidad

El calendario agrega eventos locales de Vault con cuentas conectadas de Google Calendar y CalDAV. Soporta selección de calendario, CRUD de eventos, invitaciones, RSVPs, consultas libres/ocupadas, geocodificación, recordatorios, estado de evento oculto, exportación de ICS, grabación de reuniones, transcripción y notas generadas por IA.

La frontera HTTP está tipada estrictamente y conserva el contrato de respuesta
existente. La normalización de etiquetas de Photon, el rechazo de URL, la
validación de resultados y la deduplicación pertenecen al dominio de
geocodificación de Calendar, no al módulo de rutas; los payloads de proveedores
se validan en esa frontera de adaptación.

El servicio híbrido de proveedores está estrictamente tipado y mantiene Google
como un adaptador junto al CalDAV genérico. La detección de cuentas CalDAV admite
Nextcloud, iCloud, Fastmail, Radicale y servidores compatibles mediante URL
configuradas, sin comportamiento ligado al proveedor de almacenamiento.

## Agregación de eventos

La capa de ruta resuelve el contexto del espacio de trabajo y las integraciones seleccionadas, luego normaliza los eventos del proveedor y los eventos locales de Markdown en una respuesta compartida. Los identificadores del proveedor permanecen emparejados con su origen de cuenta/calendario; un ID por sí solo no es lo suficientemente único a nivel mundial para la mutación.

Los eventos ocultos son registros de superposición local. Ocultar no elimina un evento del proveedor. Desobstruir elimina la superposición para que la siguiente agregación lo incluya de nuevo.

## Flujo de mutación

```mermaid
sequenceDiagram
    participant UI as Calendar UI
    participant API as Calendar routes
    participant Resolver as Integration resolver
    participant Provider as Google or CalDAV
    participant Vault as Local event page
    UI->>API: Create, patch, delete, RSVP, or invite
    API->>Resolver: Resolve account and enforce editor role
    alt Remote event
        Resolver->>Provider: Provider-specific operation
        Provider-->>API: Normalized event or error
    else Vault event
        Resolver->>Vault: Contained Markdown operation
        Vault-->>API: Updated local event
    end
    API-->>UI: Unified response
```

## Recordatorios y notas de reunión

Los ajustes de recordatorio seleccionan el tiempo de entrega y el comportamiento. La colección combina los eventos próximos y deduplica las solicitudes concurrentes para que no se creen recordatorios duplicados. El frontend watcher muestra recordatorios activos y puede navegar al calendario o descartarlos.

La grabación de reuniones se carga en un flujo de trabajo de fondo. Las encuestas de estado separan la grabación, transcripción, resumen, creación de notas, finalización y fallo. Las notas generadas se escriben a través de operaciones seguras de la bóveda y conservan el contexto de evento/fuente.

## Invariantes

- La identidad del evento del proveedor incluye el contexto de cuenta y calendario.
- Calendar escribe requiere un contexto con capacidad de editor.
- Los eventos locales basados en el sendero permanecen dentro de la bóveda activa.
- La ocultación es local y reversible; la eliminación utiliza el proveedor autorizado.
- Los recordatorios son seguros para la carrera y no se duplican para la misma ventana/evento.
- Falta transcripción o proveedores de IA fallan el trabajo de reunión, no el calendario.
- La salida del ICS utiliza zonas horarias normalizadas y no expone credenciales privadas.

## Enfoque de verificación

Prueba la contención de rutas locales, normalización de eventos, recurrencia, estado oculto, carreras de recordatorios, selección de cuentas, zonas horarias y Playwright crea/editar/eliminar flujos. Meeting QA debe grabar o subir un dispositivo, observar el estado de fondo y verificar la página de Vault resultante.
