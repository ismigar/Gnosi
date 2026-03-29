# Protocolo: Poblar BD Notion Cinema desde PDFs Locales

## 1. Contexto
El objetivo es mantener sincronizada la base de datos "Cinema" en Notion con una carpeta local de PDFs (`.../Documents/Cine`).
Cada PDF representa una película. Si la película no existe en Notion, se debe crear.

## 2. Recursos
- **Carpeta Origen**: `/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Documents/Cine/`
- **Base de Datos Notion**: "Cinema"
- **ID BD**: `1dd268e5271480108b93efdb677bf55f`
- **Librería Helper**: `monorepo/apps/digital-brain/pipeline/notion_api.py`

## 3. Pasos del Proceso (SOP)

### A. Preparación del Entorno
- Utilizar `monorepo/apps/digital-brain/pipeline/sandbox/` para el script.
- Asegurar acceso a `notion_api` (ajustar `sys.path`).
- Cargar variables de entorno (`.env`, `.env_shared`).

### B. Análisis de Archivos
1. Escanear recursivamente la carpeta de origen.
2. Filtrar archivos con extensión `.pdf`.
3. Normalizar nombres de archivo para obtener el "Título" (eliminar extensión, limpiar caracteres extraños).
4. **Opcional**: Intentar limpiar prefijos comunes si los hay (e.g. "CineBaix - ", "fitxa_").

### C. Sincronización con Notion
1. **Consultar Existentes**: Obtener todas las páginas de la BD Cinema para evitar duplicados. Usar el "Título" como clave única.
2. **Iterar PDFs**:
    - Si el título YA existe -> Omitir (o actualizar si se define lógica de actualización).
    - Si NO existe -> Crear nueva página.
3. **Mapeo de Propiedades**:
    - `Títol`: Nombre del archivo limpio.
    - `Adjunts`: **Limitación API**. No se pueden subir archivos locales directamente sin un enlace público. Dejar vacío o poner ruta local en campo de texto si se crea uno. *Decisión: Solo Título por ahora.*
    - Otros campos (`Any`, `Director`, etc.): Dejar vacíos.

### D. Restricciones y Errores Conocidos
- **Archivos Adjuntos**: La API de Notion requiere URLs públicas para la propiedad `files`. No intentar subir el blob local.
- **Duplicados**: La API de búsqueda de Notion puede tener latencia. Mejor descargar todos los títulos primero y comprobar en memoria local.
- **Rate Limits**: Respetar `notion_api` que ya maneja reintentos.

## 4. Validación
- Verificar en Notion que aparezcan las nuevas entradas.
- Comprobar que no se crean duplicados al correr el script 2 veces.
