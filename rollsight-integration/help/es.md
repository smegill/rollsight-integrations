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

## Escenas de combate opcionales de OBS

En Ajustes del juego → RollSight, elige **Configurar escenas de OBS por turno**. Selecciona el usuario de Foundry que inició sesión en la fuente de navegador OBS Utils `/stream`. Asigna los actores a nombres exactos de escenas de OBS existentes y, si quieres, elige escenas para turnos de PNJ sin asignación y para el final del combate. Los turnos de jugadores sin asignación dejan la escena como está. Guarda y activa **Cambiar las escenas de OBS en cada turno de combate**. Usa **Pausar el cambio automático de escenas de OBS** para tomar el control manual; guarda para reanudar desde el turno actual.

La función usa la conexión existente de OBS Utils o el permiso de control de escenas de la fuente de navegador de OBS. No hace falta otra contraseña de OBS ni actualizar la aplicación de escritorio. Usa una sola fuente controladora y una URL segura de Foundry (HTTPS o localhost). Mantén esa fuente cargada al cambiar escenas de OBS para que pueda seguir recibiendo los turnos. Si OBS Utils no ofrece la API necesaria, actualízalo antes de activar esta función. Si falta una escena o se desconecta OBS, se mantiene la escena actual; comprueba cómo está escrito el nombre y la conexión de OBS Utils. Pruébalo en tu colección de escenas antes de transmitir en directo.
