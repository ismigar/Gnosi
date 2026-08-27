---
status: implemented
last_verified: 2026-08-02
source_paths:
  - scripts/runtime/run_native_dev.sh
  - scripts/runtime/run_native_frontend.sh
  - scripts/runtime/native_watchdog.sh
  - docker-compose.yml
  - backend/config/paths_config.py
tests:
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Manual de operaciones

## Base de referencia para el desarrollo de los nativos

La máquina normal ejecuta backend y frontend a través de LaunchAgents. Antes de iniciar otro proceso, determine qué proceso posee cada puerto e inspeccione los registros nativos. No deje que Vite seleccione un puerto de reserva.

Parámetros de valoración previstos:

| Servicio | Dirección | Comprobación significativa |
| --- | --- | --- |
| Interfaz | `https://localhost:5173` | La shell de aplicación renderiza y puede navegar. |
| Motor | `http://127.0.0.1:5002` | `/api/health`, `/api/config`, `/api/vault/pages`. |
| Ayudante de recuperación de OneDrive | `http://127.0.0.1:5009` | Sólo se requiere para vías de hidratación/recuperación. |

Los cambios de dependencia requieren un reinicio de backend LaunchAgent. Fuente de recargas en caliente vite; valores de inicio inyectados como la versión de la aplicación requieren un reinicio de frontend.

## Primera secuencia diagnóstica

1. Confirme que hay exactamente un oyente en cada puerto de aplicación.
2. Lea los registros de errores nativos de backend y frontend.
3. Solicitud `/api/health`; registro de modo efectivo y estado de bóveda.
4. Solicitud `/api/config`; verificar la bóveda seleccionada sin revelar secretos.
5. Solicitud `/api/vault/pages`; distinguir el contenido vacío de un error de E/S.
6. Reproducir la acción de interfaz afectada mientras se mira la consola del navegador y
registros de backend.
7. Ejecute la prueba automatizada más estrecha antes de reiniciar servicios amplios.

## Síntomas de OneDrive y de los archivos de la nube

`EDEADLK` o `EAGAIN` en una solicitud de página/index indica un problema de disponibilidad del proveedor de archivos, no un fallo del analizador de Markdown. Compruebe las banderas de archivo y la materialización de bloques. Hidrate el directorio relevante más pequeño a través del mecanismo de calentamiento.

El motor debe continuar con resultados parciales cuando el contrato lo permita. Nunca guarde un escaneo parcial como un índice completo. La mitigación duradera por dispositivo está manteniendo directorios críticos descargados localmente.

## Datos y secretos locales

El estado nativo está bajo `local_data`; Docker está en el estado `gnosi_local_data` volumen. Antes de la migración o reinstalar, preservar SQLite de gestión, secretos, registro de herramientas, puntos de control cuando sea necesario, y estado del sistema.

No copie SQLite en vivo en una bóveda sincronizada ni inicie dos escritores contra la misma base de datos. Se espera que vuelva a conectar OAuth en otra máquina porque los secretos son intencionadamente por dispositivo.

## Docker auto-anfitrión

Docker se utiliza sólo cuando se selecciona deliberadamente. Validar la configuración de Componer, construir ambas imágenes y ejecutar la prueba de humo de salud backend con un proveedor de archivos local. Backend source bind monta recargar Python; dependencia o cambios Dockerfile reconstruyen la imagen backend.

La interfaz utiliza un anónimo `node_modules` volumen. Un cambio de archivo de bloqueo puede ser ocultado por el volumen antiguo; recrear sólo el servicio de interfaz y su volumen anónimo. Nunca ejecutar `docker compose down -v` como una reparación de rutina porque puede eliminar los datos locales nombrados.

## Mapa de síntomas común

| Síntoma | Límite probable | Siguientes pruebas |
| --- | --- | --- |
| Pantalla blanca de la interfaz | JS tiempo de ejecución, trozo rancio, auth bootstrap fallado | Consola del navegador, registro de Vite, construcción de producción. |
| Trabajo en salud, falla Vault | Configuración de ruta, contexto, hidratación del proveedor | `/api/config`, registros de la bóveda, disponibilidad de archivos. |
| Preferencias revertir | Objetivo de parámetros equivocados, escritura atómica fallida, migración de legado | El contexto de bóveda activa y la fuente de params. |
| La integración parece desconectada | Secreto local faltante o rancio de puntero predeterminado | Directorio secreto de integración encubierta. |
| El agente no tiene herramientas. | Conexión MCP, validación de catálogo, asignación de habilidades | Registros de descubrimiento de inicio y puntos finales de habilidad de IA. |
| El correo deja de actualizar | Trabajador/error de cuenta o proveedor de IDLE | Estado trabajador por cuenta y sincronización incremental. |
| Escritorio muestra la versión antigua | Renderizador/servidor no reiniciado o manifiestos difieren | Versiones de paquetes Frontend y Electron. |

## Operaciones de documentación

Ejecute el generador, validador y la estricta compilación de MkDocs desde la raíz de la aplicación. Las diferencias generadas se revisan y se comprometen. `site/engineering` es una producción de construcción desechable y no debe ser comprometida.

Después de un cambio de documentación llega al repositorio público `main` , el flujo de trabajo de Pages publica el portal en `https://gnosi.temenosismael.org/engineering/`Si la implementación falla, compruebe los pasos de referencia generada y validador antes del artefacto Páginas. Confirme que Pages repositorio utiliza las acciones GitHub como su fuente de publicación y que el `github-pages` medio ambiente permite despliegues desde `main`.

## Aprendizaje de incidentes

Después de diagnosticar un nuevo fallo, arregle la implementación, agregue una prueba de regresión, registre la restricción en la directiva correspondiente y promueva un conocimiento estable en este portal. Una recuperación indocumentada realizada sólo en una terminal no es una solución operativa completada.
