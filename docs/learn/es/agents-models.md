# Configura un agente y un modelo

El modelo genera respuestas. El agente combina modelo, instrucciones y habilidades; las herramientas permiten ejecutar acciones concretas.

## Antes de empezar {#before-you-begin}

Activa la función de IA. Un proveedor en la nube necesita credenciales válidas y puede cobrar; un modelo local necesita su servicio en funcionamiento.

## Pasos {#steps}

1. Abre los ajustes de modelos y proveedores y configura uno compatible o un servicio local. Guarda las credenciales en Configuración y selecciona un modelo disponible.

2. Abre los ajustes de agentes, elige uno o créalo y asígnale el modelo. Selecciona las habilidades necesarias.

3. Abre el chat y comprueba agente y modelo. Haz una pregunta corta para verificar la conexión.

4. Añade la página, tabla o archivo concreto como contexto. Pide una tarea acotada, como “Resume las preguntas de esta página”.

5. Si quieres que actúe, comprueba que el modelo admite herramientas y que las habilidades necesarias están disponibles. Revisa las peticiones de confirmación antes de aceptarlas.

6. Inspecciona resultado y fuentes. Guarda conclusiones útiles en una página y distingue tu interpretación del texto generado.

### Elige un modelo según la tarea

La configuración del asistente ofrece tres opciones:

- **Modelo fijo:** utiliza siempre el modelo principal.
- **Alternativas si falla:** conserva el principal y permite alternativas ante errores temporales o si el principal no está disponible.
- **Selección automática:** elige un modelo para cada petición según la tarea, las capacidades, la disponibilidad y el presupuesto.

Activa explícitamente los modelos alternativos que quieras permitir. Deben estar habilitados y ser compatibles; un asistente local solo puede usar alternativas locales. Las instrucciones, la memoria y las habilidades siguen perteneciendo al mismo asistente.

La selección automática puede utilizar el selector interno de Gnosi o **Jev (TypeSafe)**. Para activar Jev, guarda la clave de TypeSafe en el campo correspondiente. Cuando haga falta elegir entre modelos, se enviará el texto de la petición actual; no se añaden automáticamente la memoria ni las fuentes adjuntas. Las consultas cuentan en el gasto. Si falta la clave, el servicio falla o la decisión es incierta, Gnosi hace la selección interna. Los detalles de la respuesta indican qué selector se ha utilizado.

## Resultado esperado {#expected-result}

El agente responde con el contexto previsto y muestra las capacidades disponibles.

## Si algo falla {#troubleshooting}

Un modelo puede conversar sin admitir herramientas. Ante errores de autenticación, espera o herramientas ausentes, revisa proveedor, modelo y habilidades por separado. Comprueba el resultado de una acción antes de darla por realizada.

## Guías relacionadas {#related-guides}

- [Pregunta sobre las fuentes seleccionadas](notebooks.md)
- [Preguntas frecuentes y recuperación](troubleshooting.md)
