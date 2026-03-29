# Directiva: Corrección de Errores de Referencia en Componentes React

## Contexto
Este error ocurre cuando se intenta utilizar un componente o variable que no ha sido importado, definido o correctamente desestructurado en el ámbito actual.

## Pasos para el Diagnóstico
1. Identificar el archivo y la línea reportada en la traza del error (ej. `AppSidebar.jsx:90`).
2. Verificar si el nombre (ej. `Icon`) está siendo importado al inicio del archivo.
3. Si el nombre se usa dentro de un `map` o una desestructuración de props, verificar que el nombre esté incluido en el objeto de origen.
4. En React, recordar que los componentes dinámicos deben empezar con mayúscula (ej. `{ icon: Icon }`).

## Procedimiento de Corrección
1. Añadir el componente faltante a la desestructuración.
2. Si es un componente pasado como prop, asegurar el renombre a PascalCase si es necesario.
3. Verificar que no haya otros usos similares con el mismo error en el archivo.

## Advertencias y Restricciones
- **No** usar placeholders si el icono no existe; buscar el icono adecuado en `lucide-react` o la librería usada.
- **Siempre** realizar un build (`npm run build`) o verificación de tipos para asegurar que no hay más errores de referencia.
- **Validación Visual:** Comprobar en el navegador que el icono se renderiza correctamente después del hot reload o reinicio del contenedor.
