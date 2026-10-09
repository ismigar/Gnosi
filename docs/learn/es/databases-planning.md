# Organiza registros y planifica el trabajo

Una base de datos agrupa tablas. Una tabla define propiedades de registros que son páginas; sus vistas muestran los mismos registros de distintas formas.

## Antes de empezar {#before-you-begin}

Un Vault con escritura. Las vistas generales forman parte del conocimiento; la programación avanzada de proyectos requiere Planificación.

## Pasos {#steps}

1. En Conocimiento, elige **Crear una BD** o **Añadir base de datos** y llámala “Proyecto de lectura”. Dentro crea la tabla “Fuentes”: crear el grupo no crea una tabla.

2. Añade propiedades como estado y fecha. Utiliza estados coherentes, por ejemplo “Por leer”, “Leyendo” y “Leído”.

3. Crea dos registros y completa sus propiedades. Despliega **Contenido** bajo la tabla para abrir las páginas y **Vistas** para encontrar las vistas guardadas.

4. Crea una vista filtrada de fuentes pendientes. Elige tablero o calendario cuando los campos de estado o fecha lo permitan y comprueba qué registros coinciden con el filtro.

5. Para programar tareas, activa Planificación y configura semana laboral y festivos. Prueba inicio, duración y dependencias en un ejemplo pequeño antes de aplicarlo a un proyecto real.

6. Consulta la ayuda junto a la restricción de fecha para entender la regla. Comprueba el final calculado según los días laborables.

Para leer las notas seguidas, abre la configuración de la galería y elige **Tamaño de las tarjetas → Ancho completo** y **Vista previa → Contenido**. Las tarjetas ocupan todo el ancho de la vista, quedan una debajo de otra y crecen según el texto. En una galería agrupada, **Espacio** despliega el grupo enfocado y entra en la primera nota; **Esc** desde una nota vuelve a la cabecera del grupo y lo pliega. Un segundo **Esc** vuelve a la vista. El clic en la cabecera sigue plegando y desplegando el grupo.

En el **cronograma**, elige **Día**, **Semana**, **Mes**, **Año**, **Hoy** o **Encuadra el proyecto**. Ajusta el ancho de los títulos y contrae las fases. Con un período o campos de inicio y final editables, arrastra una barra para mover la tarea y sus extremos para alargarla o acortarla. Arrastra el punto de conexión del final de una tarea hasta la barra de una sucesora para añadir una dependencia de final a inicio. Los cambios se guardan en los registros compartidos con la tabla; las sucesoras afectadas se recalculan aunque estén ocultas por filtros. Se rechazan los ciclos. **Deshacer el cambio del cronograma** restaura la última operación durante la sesión de la vista. **Esc** cancela un arrastre. Con una barra enfocada, las flechas la mueven y **Mayúsculas + flecha** ajusta el final. Los registros sin fechas muestran **Define las fechas**; los hitos tienen forma de rombo.

Para eliminar una dependencia, haz clic en la línea que conecta las tareas y confirma **Eliminar dependencia**. Se conservan las fechas y puedes deshacer el cambio.

## Resultado esperado {#expected-result}

Puedes consultar registros en distintas vistas y explicar la fecha calculada de una tarea.

## Si algo falla {#troubleshooting}

Una vista vacía puede tener un filtro restrictivo. Revisa fechas, estados y dependencias antes de recrear registros. Gnosi mantiene las fechas de creación y modificación; no son fechas de planificación editables.

## Guías relacionadas {#related-guides}

- [Crea páginas, enlaces y adjuntos](pages-files.md)
- [Activa complementos, conecta servicios y automatiza](integrations-automations.md)
