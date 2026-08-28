---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/server.py
  - backend/app/lifespan.py
  - backend/config/app_config.py
  - backend/config/env_config.py
  - backend/config/paths_config.py
  - backend/services/data_dir_migration.py
  - frontend/src/App.jsx
tests:
  - backend/tests/test_app_lifespan.py
  - backend/tests/test_app_config_resolution.py
  - backend/tests/test_app_config_language.py
  - backend/tests/test_host_helper_url.py
  - backend/tests/test_data_dir_migration.py
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Fundación y duración de la plataforma

## Responsabilidad

La fundación ensambla cada dominio en un proceso, resuelve la configuración y rutas portátiles, posee el inicio y apagado, aplica middleware compartido y expone el frontend de nivel superior. Debe permanecer útil cuando no haya integraciones opcionales.

## Montaje del motor

`backend/server.py` construye la instancia FastAPI, middleware, manejo de excepciones, montaje del lector estático, vida útil y routers. El orden del router es explícito porque el contexto del espacio de trabajo y los prefijos amplios pueden superponerse. [Catálogo API](../generated/api-catalog.md) registra cada montaje y ruta estática.

Lifespan startup realiza estas clases de trabajo:

El módulo de ciclo de vida mantiene `lifespan` como orquestador lineal. Funciones
acotadas gestionan plugins, agente, índices, reparación de tablas, correo y
apagado sin alterar el orden ni el aislamiento de errores.

1. Afirmar que un despliegue expuesto no está utilizando un desarrollo público JWT
secreto.
2. Comience el programador y el mantenimiento de confirmación-retención.
3. Reconcile las contribuciones de plugin antes de crear capacidades de agente.
4. Conectar clientes MCP, descubrir herramientas y compilar el gráfico de agente predeterminado.
5. Precarga persistía los índices de bóveda sincrónicamente, luego refrescalos en el
antecedentes donde la política de proveedor de archivos lo permite.
6. Cargar cachés derivados antes de que cualquier ahorro pueda truncarlos.
7. Comiencen a trabajar por cuenta IMAP IDLE.

Los fallos en el inicio opcional de IA o integración se registran y se aíslan. Los fallos de inicialización de datos de seguridad y núcleo no se convierten silenciosamente en un comportamiento saludable.

## Combinación de configuración

`load_params()` combina la aplicación YAML con el usuario actual o configuración de la válvula activa. Los valores del diccionario se fusionan recursivamente. `.gnosi/params.yaml` se convierte en el objetivo de persistencia para la configuración de bóvedas. La resolución de trayectoria aplica valores de entorno de implementación explícitos.

Una credencial de entorno legado puede crear un proveedor una vez, pero una lápida de desconexión persistente impide que reaparezca después de la eliminación deliberada.

La migración de datos locales es una máquina de estados con diario. La
verificación del origen, el movimiento atómico en el mismo volumen, el staging
entre volúmenes, la verificación del destino y el rollback automático son fases
separadas. Cada base SQLite pasa checkpoint e `integrity_check`, y las copias
se comparan con un inventario con hash antes de sustituir una estructura vacía.

## Carcasa de la interfaz

`App.jsx` espera a que se inicie la autenticación antes de seleccionar el shell de uso compartido, de acceso público o de aplicación. Las páginas pesadas están cargadas de páginas sueltas. El shell global posee superficies de navegación y de interacción disponibles a nivel mundial; las páginas de ruta poseen contenido de dominio. `/s/:token` Renders fuera de la cáscara autenticada por diseño.

## Invariantes

- Puerto `5002` es el contrato de motor; `5173` es el contrato de frontend.
- El código de aplicación utiliza el autoritativo `Gnosi/` árbol.
- Las cadenas visibles de Frontend usan todos los catálogos locales.
- Las importaciones en tiempo de ejecución no deben utilizarse para la generación de documentación.
- Una bóveda no disponible está representada explícitamente; una ruta segura temporal puede
evitar fallos en el tiempo de importación, pero no debe presentarse como contenido configurado.
- El calentamiento de caché derivado no puede retrasar la primera respuesta útil cuando un disco seguro
La instantánea existe.

## Diagnóstico de fallo

Comprobar la propiedad del proceso, `/api/health`, `/api/config`, y `/api/vault/pages` Una respuesta de salud exitosa con una petición de almacén vacía o fallida indica problemas de configuración o de proveedor de archivos en lugar de un servidor muerto. Vea el [Manual de operaciones](../operations/runbook.md).
