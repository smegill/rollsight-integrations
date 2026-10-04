# Dados físicos de RollSight

En Foundry, abre los ajustes de RollSight y copia tu código de jugador. En Ajustes del juego → Principal → Dados, establece el método predeterminado en dados físicos de RollSight y guarda. Revisa las excepciones para cada dado. Inicia la tirada en Foundry y espera a que aparezca el aviso de RollSight antes de tirar los dados físicos.

## Vincular este mundo (GM)

El GM debe vincular este mundo antes de que puedas actualizar tu código de jugador.

Copia este código personal en la app de escritorio. Selecciona RollSight o Manual en la configuración de dados de Foundry y luego inicia una tirada en Foundry.

Inicia la tirada en Foundry y envía dados físicos desde la app de escritorio. No se admiten solicitudes remotas de tirada al escritorio.

## Aceptar dados para tiradas manuales

También rellena las solicitudes manuales nativas. Foundry conserva sus controles y calcula los modificadores.

Las nuevas solicitudes reciben dados automáticamente. Si hay varias abiertas, la más reciente recibe primero; las anteriores se reanudan cuando se cierra.

## Recibir dados de RollSight

Desactiva para salir de esta sesión. Las tiradas pendientes siguen disponibles en Foundry para completarlas manualmente.

## Usar la extensión del navegador

Recibe resultados locales mediante la extensión de RollSight. La recepción en la nube se desactiva en este modo.

Este navegador no puede coordinar pestañas. Usa una sola pestaña de Foundry por jugador de RollSight.

## Publicar dados si no hay tiradas pendientes

Publica dados físicos simples con la visibilidad actual del chat. Inicia primero la iniciativa, los ataques y la ventaja en Foundry.

## Repetición de RollSight

Abre la repetición; selecciona la imagen para verla a tamaño completo.

## Actualizar conexión

RollSight no pudo conectarse. Comprueba el vínculo del mundo y actualiza tu código de jugador en los ajustes del módulo.

Otra pestaña recibe los dados de RollSight para este jugador. Ciérrala y actualiza esta conexión.

No se aceptaron los dados. Envía valores enteros dentro del rango de cada dado.

RollSight no pudo aplicar este envío. Revisa la tirada pendiente antes de volver a enviar.

## Escenas automáticas de OBS en los turnos de combate

Usa el módulo RollSight para Foundry 1.1.91 o posterior y activa OBS Utils en el mismo mundo. Estos controles son independientes de las superposiciones de replays.

En OBS, crea las fuentes de navegador de Foundry con la dirección del servidor que facilite el DJ: /game para la vista de juego y /stream para el usuario Stream. Inicia sesión en /stream con el usuario que elegirás como operador de OBS.

En cada fuente de navegador de Foundry, abre Propiedades y establece los permisos de página en acceso avanzado o completo. /game y /stream tienen permisos separados. Actualiza cada fuente tras cambiarlos. Los enlaces solo de replays no necesitan permisos para controlar escenas.

Mantén cargado el controlador /stream al cambiar de escena. Desactiva el cierre de la fuente cuando no sea visible y reutiliza la misma fuente en tus escenas. Esta conexión por fuente de navegador no requiere WebSocket ni acceso API de OBS Utils.

Como DJ, abre Ajustes del juego → RollSight → Configurar escenas de OBS por turno. Selecciona al usuario Stream como operador de OBS y actualiza las escenas de OBS. Elige cada actor y su escena en las listas. Opcionalmente, elige escenas para PNJ sin asignación y para el final del combate.

Guarda las escenas de OBS, activa el cambio de escenas en los turnos de combate y deja desmarcada la pausa del cambio automático. Los turnos de jugadores sin asignación mantienen la escena actual.

Las asignaciones, el operador y los ajustes de activación y pausa se guardan en este mundo de Foundry. Stream puede conectarse después de iniciar el servidor. Al conectarse, comprueba el turno actual. La fuente debe seguir conectada mientras se necesite el cambio automático.

Antes de emitir, avanza un turno de combate de prueba y comprueba la escena; luego prueba la pausa y la reanudación. Si faltan escenas, revisa los permisos de /stream, actualiza su caché del navegador y la lista. Tras renombrar escenas de OBS, selecciona los nuevos nombres y vuelve a guardar.
