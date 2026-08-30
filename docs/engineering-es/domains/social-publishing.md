---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/api/social_routes.py
  - backend/services/social_clients.py
  - frontend/src/features/social
  - frontend/src/features/media
  - pipeline/skills/publisher
tests:
  - backend/tests/test_social_clients_contract.py
  - backend/tests/test_media_upload.py
  - backend/tests/test_connection_scheduler_alignment.py
  - frontend/src/features/social/SocialDashboard.test.tsx
  - frontend/src/features/social/ContentCalendar.test.tsx
  - frontend/src/features/social/components/socialComponents.test.tsx
  - frontend/src/features/media/browser/MediaCenter.test.tsx
---

# Publicaciones y medios de comunicación sociales

## Responsabilidad

Este dominio prepara, programa, publica y observa contenidos en redes sociales configuradas. El centro de medios proporciona activos visuales y metadatos reutilizables. La publicación siempre es un efecto externo.

## Adaptadores de red

Los clientes de servicio aíslan a Mastodon, Bluesky, Telegram y otras semánticas de red configuradas: autenticación, límites de texto, carga de medios, identificadores de correos, hilos, normalización de respuestas y reportes de errores.

La API expone redes configuradas, flujos, acciones de publicación y configuraciones relacionadas. Las pestañas de interfaz de usuario están keyed por identificadores de red estables mientras que los nombres y etiquetas de visualización utilizan cadenas localizadas.

El JSON de proveedores se valida y normaliza en la frontera del adaptador. Las
rutas HTTP están tipadas estrictamente y conservan el contrato OpenAPI
existente; el JSON de mensajes almacenado se decodifica con helpers tipados
antes de usar vistas previas, URL o publicaciones programadas.

## Publicar flujo

```mermaid
flowchart LR
    Source["Página de la bóveda o contenido compuesto"] --> Prepare["Preparación de sistemas de redes"]
    Media["Activo seleccionado para los medios de comunicación"] --> Prepare
    Prepare --> Validate["Límites, credenciales y validación de objetivos"]
    Validate --> Confirm["Publicación explícita o calendario aprobado"]
    Confirm --> Adapter["Cliente de red"]
    Adapter --> Result["Id. remoto, URL, estado y diagnósticos"]
```

La preparación puede traducir o remodelar el contenido pero no lo publica por sí sola. La publicación inmediata requiere una acción explícita del usuario; la publicación programada requiere un calendario almacenado cuya política de ejecución autoriza el mismo objetivo.

## Manejo de medios de comunicación

Carga valida el tipo de archivo, tamaño, raíces permitidas y nombres generados. Los medios de comunicación ven los activos de índice sin tratar cachés o miniaturas como originales. Una miniatura faltante puede regenerarse; perder el activo fuente no puede.

## Invariantes

- Una credencial de red se resuelve sólo en el motor en el momento de la ejecución.
- La vista previa/preparación y publicación son estados distintos.
- Los límites de texto y medios se validan por objetivo antes de la llamada externa.
- Un fallo parcial de múltiples redes informa de cada resultado y no reclama global
éxito.
- La publicación programada e interactiva utiliza el mismo contrato de adaptador.
- Los identificadores de post remotos y URLs se almacenan para las acciones de auditoría y seguimiento.

## Enfoque de verificación

Prueba la contención de carga de medios, alineación de programación/conexión, normalización de la respuesta de red, límites de reintento, fallo parcial multi-objetivo y publicación de un arenero o tablón.
