# Utiliza correo, calendario y contactos

Conecta las cuentas necesarias e identifica qué fuente es propietaria de cada mensaje, evento o contacto.

## Antes de empezar {#before-you-begin}

Activa Correo, Calendario y Contactos según necesites. Las cuentas externas requieren credenciales o autorización; los eventos y contactos locales no requieren nube.

## Pasos {#steps}

1. En Integraciones, añade la cuenta y prueba la conexión. El correo utiliza IMAP/SMTP; los calendarios admiten Google Calendar o CalDAV; los contactos Google o CardDAV, además de entradas locales.

2. Abre Correo y elige cuenta y carpeta. Lee un mensaje y prepara un borrador; revisa destinatarios y adjuntos antes de enviarlo.

3. Abre Calendario y selecciona las fuentes visibles. Crea un evento en el calendario local o externo previsto y comprueba zona horaria, inicio, final y repetición.

4. Abre Contactos y crea uno local ficticio o sincroniza una fuente autorizada. Comprueba el origen antes de editar datos del proveedor.

5. Utiliza una sugerencia de contacto en un borrador o campo de asistentes y verifica la dirección: nombres parecidos pueden ser personas distintas.

6. Para grabar reuniones, activa la función correspondiente y concede permisos del dispositivo. La transcripción y las notas generadas necesitan sus servicios configurados.

## Resultado esperado {#expected-result}

Puedes encontrar correo de una cuenta, un evento en el calendario previsto y un contacto de origen conocido.

## Si algo falla {#troubleshooting}

Si faltan datos, revisa autorización y filtros. Ocultar un evento no lo elimina del proveedor. Evita reconectar cuentas o reenviar mensajes mientras la operación anterior siga sin resolverse.

## Guías relacionadas {#related-guides}

- [Activa complementos, conecta servicios y automatiza](integrations-automations.md)
- [Preguntas frecuentes y recuperación](troubleshooting.md)

## Escritura CalDAV y videollamadas

Los calendarios CalDAV con permiso de escritura, incluido iCloud, permiten crear, editar y eliminar eventos individuales. Las modificaciones conservan el UID, las zonas horarias, las fechas de día completo y las propiedades iCalendar no modificadas. El ETag del proveedor evita sobrescribir cambios simultáneos; actualiza el evento antes de volver a editarlo si hay un conflicto. Las series recurrentes CalDAV siguen siendo de solo lectura en Gnosi.

Si el proveedor ofrece un enlace de vídeo, abre la cita y pulsa **Entrar en la videollamada**. El enlace se abre en el navegador.

## Disponibilidad y reservas públicas

Abre **Disponibilidad** en el panel lateral del calendario. Selecciona todos los calendarios que deben bloquear reservas, incluidos los eventos locales de Gnosi y calendarios de varias cuentas. Configura zona horaria, días y horas laborables, duración, margen, antelación y horizonte de reserva. Consulta las franjas, elige un destino entre los calendarios seleccionados y crea un enlace. Puedes copiar y revocar los enlaces publicados.

Los visitantes eligen una franja e indican su nombre y correo. Gnosi vuelve a comprobar la disponibilidad antes de crear la cita. Si no puede consultar algún calendario, las reservas se detienen. Si el resultado de una escritura es incierto, la franja sigue bloqueada y la reserva queda pendiente; verifica el calendario de destino antes de crear otra. Las cuentas externas solo están disponibles para reservas públicas del propietario del espacio personal.

El enlace público requiere que sus destinatarios puedan acceder al servidor web de Gnosi. Una dirección localhost o de escritorio solo funciona en ese dispositivo; crear el enlace no publica ni expone la instalación.
