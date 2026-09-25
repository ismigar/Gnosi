# Configura el asistente y sus perfiles

El perfil predeterminado se usa en conversaciones nuevas y acciones de la app. Cada conversación puede elegir otro perfil sin afectar a las demás.

## Antes de empezar {#before-you-begin}

Activa la función de IA. Un proveedor en la nube necesita credenciales válidas y puede cobrar; un modelo local necesita su servicio en funcionamiento.

## Pasos {#steps}

1. Abre los ajustes de modelos y proveedores y configura uno compatible o un servicio local. Guarda las credenciales en Configuración y selecciona un modelo disponible.

2. Abre Configuración → Plugins → IA → Asistente y pulsa **Configurar asistente**. Elige el modelo, pon nombre al perfil y asígnale las habilidades necesarias.

3. Abre el chat y comprueba agente y modelo. Haz una pregunta corta para verificar la conexión.

4. Añade la página, tabla o archivo concreto como contexto. Pide una tarea acotada, como “Resume las preguntas de esta página”.

5. Si quieres que actúe, comprueba que el modelo admite herramientas y que las habilidades necesarias están disponibles. Revisa las peticiones de confirmación antes de aceptarlas.

6. Inspecciona resultado y fuentes. Guarda conclusiones útiles en una página y distingue tu interpretación del texto generado.

### Perfiles y conversaciones

Crea perfiles en **Perfiles adicionales (avanzado)**. En el chat, abre el selector junto al nombre del asistente y elige el **Perfil de la conversación**. El cambio se aplica a las peticiones siguientes y conserva el historial. Cada conversación recuerda su perfil. **Usar por defecto**, en Configuración, establece el perfil para conversaciones nuevas y acciones de la app; no cambia los chats existentes.

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

Cada plugin de IA declara un perfil editable y las habilidades que utilizan sus acciones. Configuración → IA → Asistente muestra los perfiles de plugins separados de los personales. Puedes editar el único modelo, las instrucciones, las fuentes y las habilidades asignadas. Los perfiles iniciales copian solo el modelo predeterminado actual; las actualizaciones preservan las ediciones. Desactivar un plugin suspende su perfil sin eliminar la configuración. Si falta el modelo o una habilidad necesaria, la acción falla explícitamente sin recurrir al perfil personal. Las acciones independientes nuevas y las habilidades programadas utilizan el perfil del plugin; los trabajos iniciados conservan su instantánea. El perfil elegido manualmente en una conversación sigue gobernando esa conversación.
