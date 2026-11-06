import type { JamErrorCode } from './types';

/** Texto en voseo para cada error del jam; sin código = no se pudo conectar o se perdió la conexión. */
export function jamErrorMessage(code?: JamErrorCode): string {
  switch (code) {
    case 'bad_request':
      return 'Algo salió mal con ese pedido. Probá de nuevo.';
    case 'protocol':
      return 'Actualizá Spotaple para unirte.';
    case 'room_full':
      return 'La sala está llena.';
    case 'queue_full':
      return 'La cola de la sala está llena.';
    case 'duplicate':
      return 'Ya está en la cola.';
    case 'forbidden':
      return 'No tenés permiso para hacer eso en esta sala.';
    case 'not_found':
      return 'Eso ya no está en la sala.';
    case 'no_room':
      return 'No existe una sala con ese código.';
    case 'code_taken':
      return 'Ese código ya está en uso. Probá de nuevo.';
    case 'closed':
      return 'La sala terminó.';
    case 'rate_limited':
      return 'Estás enviando demasiado rápido. Esperá un momento.';
    default:
      return 'No se pudo conectar. Revisá tu conexión y probá de nuevo.';
  }
}
