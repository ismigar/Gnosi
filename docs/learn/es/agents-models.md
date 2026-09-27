# Configura los bots y perfiles

Todos los bots y perfiles aparecen en una sola lista. Solo uno es el principal: se utiliza por defecto en conversaciones nuevas y coordina al equipo. Las acciones de los plugins siguen utilizando sus propios perfiles.

## Antes de empezar {#before-you-begin}

Activa la función de IA. Un proveedor en la nube necesita credenciales válidas y puede cobrar; un modelo local necesita su servicio en funcionamiento.

## Pasos {#steps}

1. Abre los ajustes de modelos y proveedores y configura uno compatible o un servicio local. Guarda las credenciales en Configuración y selecciona un modelo disponible.

2. Abre Configuración → Plugins → IA → Asistentes. Pulsa **Crear el primer asistente** si la lista está vacía, o **Crear perfil** para añadir uno. Elige el modelo, pon nombre al perfil y asigna las habilidades necesarias.

3. Abre el chat y comprueba agente y modelo. Haz una pregunta corta para verificar la conexión.

4. Añade la página, tabla o archivo concreto como contexto. Pide una tarea acotada, como “Resume las preguntas de esta página”.

5. Si quieres que actúe, comprueba que el modelo admite herramientas y que las habilidades necesarias están disponibles. Revisa las peticiones de confirmación antes de aceptarlas.

6. Inspecciona resultado y fuentes. Guarda conclusiones útiles en una página y distingue tu interpretación del texto generado.

### Perfiles y conversaciones

Cada ficha tiene una rueda de configuración y, si no es el principal, **Hacer principal**. Elegir otro conserva los bots y sus configuraciones; el nuevo principal asume la coordinación del equipo. Las conversaciones existentes mantienen su perfil. En el chat, el selector **Perfil de la conversación** permite cambiarlo para las peticiones siguientes sin perder el historial ni afectar a otras conversaciones.

### Un único modelo por perfil

Cada perfil tiene un único LLM. Para usar otro modelo, elige otro perfil o edita su modelo. No hay selección automática ni modelos alternativos en caso de fallo. Si se elimina el perfil o el modelo no está disponible, elige otro perfil desde el chat. Para eliminar el predeterminado, establece otro primero. Desactiva el plugin de IA para desactivar la IA.

## Resultado esperado {#expected-result}

El agente responde con el contexto previsto y muestra las capacidades disponibles.

## Si algo falla {#troubleshooting}

Un modelo puede conversar sin admitir herramientas. Ante errores de autenticación, espera o herramientas ausentes, revisa proveedor, modelo y habilidades por separado. Comprueba el resultado de una acción antes de darla por realizada.

## Guías relacionadas {#related-guides}

- [Pregunta sobre las fuentes seleccionadas](notebooks.md)
- [Preguntas frecuentes y recuperación](troubleshooting.md)

## Perfiles de los plugins

Cada plugin de IA tiene un perfil editable en la misma lista que los personales, con el nombre del plugin que lo utiliza. Puedes editar el modelo, las instrucciones, las fuentes y las habilidades, y elegirlo explícitamente como principal. Esto no cambia qué perfil utilizan las acciones del plugin. Desactivar el plugin suspende su bot y conserva la configuración. Si falta el modelo o una habilidad necesaria, la acción lo indica sin sustituir el perfil. Las ejecuciones iniciadas mantienen la configuración con la que comenzaron.

## Principal y participación en el equipo

El principal forma parte de la misma lista y coordina al equipo cuando hay otros bots que reciben encargos. En la ficha de los demás bots, **Participación en el equipo** permite elegir:

- **Trabaja por su cuenta**: realiza sus tareas con su modelo y habilidades.
- **Recibe encargos del equipo**: el principal puede asignarle trabajo.
- **Pide ayuda al equipo**: puede pedir al principal que movilice al equipo.
- **Recibe encargos y pide ayuda**: combina ambas funciones.

La rueda de configuración de cada ficha abre el modelo, las instrucciones, las fuentes y las habilidades. Las especialidades se eligen en la misma ficha. Las asignaciones por tarea y los especialistas temporales son opcionales y se abren en el apartado avanzado.

Las selecciones completas se guardan automáticamente. Si faltan destinatarios o permisos de temporales, se indica qué queda pendiente; cerrar conserva la última configuración completa. Retirar al último bot que recibe encargos desactiva la colaboración. No hay que volver a activar los mismos bots en otro apartado. Solo se añade al principal la habilidad de coordinación cuando hay colaboración.

Abre un tipo de tarea y marca uno o varios bots. Sin selección, lo coordina el principal; si no hay destinatarios, se explica cómo añadirlos. Los modelos y habilidades de temporales también admiten varias selecciones, con un interruptor por opción. Son permisos disponibles, no tareas que se ejecuten todas a la vez.

Con el foco en el texto o en un interruptor, las flechas arriba/abajo y las teclas de página desplazan el formulario. Los campos de texto y desplegables conservan sus teclas de edición y selección.



Las rutas directas vinculan operaciones conocidas con ejecutores. El servidor comprueba disponibilidad, habilidades, contexto y límites antes de comparar el coste estimado del encargo. Un coste desconocido sigue siendo desconocido. Una ruta directa evita llamar al principal; una petición ambigua requiere un plan. Un resultado válido se entrega sin revisión automática del principal.

Se permiten cuatro encargos, dos especialistas temporales y dos trabajos de lectura simultáneos. Las modificaciones se ejecutan secuencialmente. Las operaciones estructuradas admiten ocho llamadas totales dentro del presupuesto original. La reparación de formato tiene un intento y no repite acciones. Solo el trabajo de lectura se replantea automáticamente; los efectos inciertos requieren revisión.

Autoriza los modelos y habilidades de los temporales. Crear uno no instala herramientas ni amplía permisos. Pertenece a una ejecución y no aparece en el selector general. En **Actividad**, revisa la propuesta de conservación, edita las instrucciones reutilizables y acepta o rechaza. Aceptar crea un perfil personal sin historial ni memorias; después puedes incorporarlo al equipo. Rechazar impide repetir la misma propuesta.

Las confirmaciones identifican al ejecutor y no autorizan acciones adicionales. Reanudar reutiliza el plan y los encargos completados; las acciones fallidas o de efecto incierto no se repiten automáticamente. Cancelar impide continuar a los descendientes. Los registros privados siguen la retención de la ejecución.

El catálogo muestra valoraciones independientes para Directivo, Todoterreno, Documentalista, Perito, Administrativo y Peón, con evidencias y pruebas pendientes. La compatibilidad declarada no certifica el catalán, las citas ni el coste de delegación. Las etiquetas antiguas se conservan por compatibilidad, sin decidir ejecutores. Las pruebas automáticas usan proveedores simulados y no realizan evaluaciones de pago. Compara calidad y coste total con los mismos casos antes de ampliar las rutas.

El campo opcional **Comando** de cada agente permite asignar un comando único, como `/traductor`. Escribe `/traductor Traduce este texto…` en el chat para enviar ese turno directamente al agente, con su modelo, instrucciones y habilidades, sin pasar por el principal. La selección habitual de la conversación no cambia. Los comandos no amplían los permisos y no permiten invocar agentes desactivados. Usa una letra inicial y hasta 32 letras sin acentos, dígitos, guiones o guiones bajos después de `/`; no se distinguen mayúsculas y minúsculas.

## Valoración de perfiles y datos pendientes

Orientación, no certificación: mínimo 60/100 y 60% de datos, con requisitos por rol. Inteligencia, código y capacidad agéntica se comparan con el catálogo actual; contexto y velocidad saturan en 200.000 tokens y 100 tokens/s. Latencia y precio puntúan con 1/(1+x/2). El precio usa una mezcla fija de 4 tokens de entrada por 1 de salida; no es el coste real de una tarea. No se deducen citas, catalán ni fiabilidad a partir del contexto.

Pulsa Actualizar para consultar los datos disponibles (se respeta la caché del proveedor). Si siguen ausentes, la fuente debe publicar el dato; no se inventa ni se deduce del nombre o tamaño del modelo.


Cómo verificarlo: ejecutar los mismos casos sintéticos con Todoterreno, Directivo siempre activo y Directivo con rutas; validar planes, ejecutores, llamadas evitables y coste total.

Cómo verificarlo: probar instrucciones en catalán y herramientas simuladas; puntuar calidad lingüística, seguimiento de instrucciones y resultado de cada acción.

Cómo verificarlo: preguntar sobre documentos sintéticos con fragmentos y respuestas conocidos; comprobar recuperación, citas exactas y cobertura de fuentes.

Cómo verificarlo: resolver problemas con solución conocida y casos sin información suficiente; medir aciertos, contraste y reconocimiento de incertidumbre.

Cómo verificarlo: extraer datos sintéticos con resultado esperado y validar contenido y esquema; ejecutar procedimientos con pasos verificables.

Cómo verificarlo: repetir transformaciones con salida esperada y registrar aciertos, tiempo y tokens; calcular el coste por tarea correcta, incluidos reintentos.

La columna Uso muestra solo el perfil seleccionado y su porcentaje; ordenarla compara esa puntuación, con valores desconocidos al final. Coste estimado y Proveedor aparecen después. Sin filtro, ordenar Uso compara la mejor puntuación disponible de cada modelo.

El panel Pruebas de perfiles y estrategias de la comparativa permite elegir agentes habilitados y autorizar cada ejecución con consumo real. Las pruebas por rol usan 2–3 casos sintéticos con validadores deterministas. La comparación aplica los mismos tres casos a Todoterreno, Directivo siempre activo y Directivo con rutas; incluye dos rutas conocidas y la resolución de fuentes contradictorias con dependencias. Compara aciertos, llamadas, intervenciones evitables y coste; los datos ausentes no cuentan como cero. Es un laboratorio aislado que reutiliza la selección económica, sin herramientas de negocio. No certifica completamente el idioma, la recuperación extensa ni el uso real de herramientas.

Cada resultado conserva versión, fecha, modelo, proveedor y comprobaciones por caso dentro del usuario y Vault originales. Las valoraciones con datos suficientes combinan 50% catálogo y 50% prueba sintética; las limitaciones y carencias generales siguen visibles. Refresca la comparativa después de consultar los resultados. La prueba tiene un límite global de 24 llamadas y hasta 512 tokens de salida por llamada; comparar las tres estrategias hace 17 llamadas. Las trazas de estas pruebas guardan solo metadatos. Cancélalas desde Actividad. No cambian los modelos asignados.

Las propuestas de conservación muestran habilidades reutilizables, diferencias de cobertura y modelo respecto a agentes existentes y ejecuciones completadas. No confunden completar una ejecución con verificar todos los criterios particulares. Las instrucciones permanentes parten de una plantilla de habilidades registradas, sin copiar el encargo; el usuario puede revisarlas. Aceptar permite incorporar el nuevo perfil personal al equipo. Una configuración equivalente existente evita una propuesta duplicada. Rechazar impide repetir la misma propuesta.

Para resolver un tamaño desconocido, selecciona **Pendiente de verificar** en la columna Parámetros. **Consulta la fuente oficial** busca una coincidencia de versión exacta en las fichas de los fabricantes compatibles. Si la fuente no responde o no hay coincidencia, el dato sigue pendiente. También puedes registrar los miles de millones totales y activos, o una ausencia de publicación revisada, con una fuente HTTPS y la confirmación explícita de haber comprobado el modelo exacto. Los datos revisados manualmente conservan su procedencia y fecha; no encontrar una cifra no demuestra que no esté publicada. El servidor no visita los enlaces introducidos.
