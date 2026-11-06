import { useState, type DragEvent } from 'react';

export interface ReorderItem {
  props: {
    draggable: true;
    onDragStart: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
    onDragEnd: () => void;
  };
  dragging: boolean;
  /** Línea indicadora antes / después de esta fila. */
  dropBefore: boolean;
  dropAfter: boolean;
}

/**
 * Reordenar por arrastre con HTML5 DnD. `onMove(from, to)` recibe índices finales (ya compensados).
 * La alternativa por teclado ("Mover arriba/abajo") vive en el menú contextual de cada lista.
 */
export function useReorder(length: number, onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);

  return (index: number): ReorderItem => {
    // `over` es un hueco (0..length): arrastrar junto a su propia posición no cambia nada.
    const noop = drag ? drag.over === drag.from || drag.over === drag.from + 1 : true;
    return {
      props: {
        draggable: true,
        onDragStart: (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(index));
          setDrag({ from: index, over: index });
        },
        onDragOver: (e) => {
          if (!drag) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const over = e.clientY > r.top + r.height / 2 ? index + 1 : index;
          if (over !== drag.over) setDrag({ ...drag, over });
        },
        onDrop: (e) => {
          e.preventDefault();
          if (!drag) return;
          const to = drag.over > drag.from ? drag.over - 1 : drag.over;
          setDrag(null);
          if (to !== drag.from) onMove(drag.from, to);
        },
        onDragEnd: () => setDrag(null),
      },
      dragging: drag?.from === index,
      dropBefore: !!drag && !noop && drag.over === index,
      dropAfter: !!drag && !noop && drag.over === length && index === length - 1,
    };
  };
}
