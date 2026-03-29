# Directive: Solucionar Avisos en Entorno OneDrive/Symlink

## Problema
Al trabajar con el proyecto ubicado en OneDrive (`/Users/.../OneDrive-UNED/Projectes`) y accedido posiblemente a través de enlaces simbólicos, el IDE (Cursor/VS Code) o git pueden mostrar avisos recurrentes preguntando por "Confianza" (Trust) o "Permisos".

## Causas Comunes

1.  **Git Safe Directory**: OneDrive a menudo cambia el propietario de los archivos al sincronizar, lo que hace que Git desconfíe de la carpeta.
2.  **Workspace Trust (IDE)**: Al abrir el proyecto a través de un enlace simbólico, el IDE puede detectar que la ruta real (`/Users/.../OneDrive...`) no está en la lista de carpetas de confianza explicitamente.

## Soluciones

### 1. Marcar Directorio como Seguro en Git
Ejecutar el siguiente comando en la terminal para añadir la ruta real Y el enlace simbólico a la lista segura de Git:

```bash
# Ruta Real
git config --global --add safe.directory /Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Projectes
# Ruta Enlace Simbólico (Muy Importante)
git config --global --add safe.directory /Users/ismaelgarciafernandez/Projectes
```

> **Nota Crítica**: Si abriste el proyecto usando `/Users/ismaelgarciafernandez/Projectes`, el Agente/IDE puede pensar que cualquier edición en la ruta real de OneDrive es una edición "fuera del espacio de trabajo", provocando avisos de seguridad constantes.

### 2. Solución Definitiva (Recomendada)
**Abrir la carpeta real directamente.**
En lugar de abrir `~/Projectes`, navega y abre `/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Projectes` directamente en el editor. Esto elimina la discrepancia de rutas.

### 2. Configurar "Workspace Trust" en Cursor/VS Code
Si el aviso es "¿Confías en los autores de los archivos de esta carpeta?":

1.  Abrir la Paleta de Comandos (`Cmd+Shift+P`).
2.  Escribir `Workspaces: Manage Workspace Trust`.
3.  Añadir la ruta **base** de tus proyectos (`/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Projectes` o la carpeta padre) a la lista de "Trusted Folders & Workspaces".
4.  Asegurarse de marcar "Trust authors".

### 3. Avisos de Ejecución de Antigravity (Agent)
Si "Antigravity" pregunta permiso para ejecutar comandos:
-   Marcar la casilla "Always allow commands in this session" o "Trust this workspace" en el popup del agente si está disponible.
-   Nota: Por seguridad, el agente siempre requiere aprobación para comandos "peligrosos" si no se ha establecido una política de auto-aprobación global (que no se recomienda).

## Verificación
1. Abrir una nueva terminal.
2. Ejecutar `git status`. No debería dar error de "dubious ownership".
3. Reiniciar el IDE y verificar que no aparece el popup de Trust.
